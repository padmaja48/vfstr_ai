import { JobsOptions, Queue, Worker } from 'bullmq';
import mongoose from 'mongoose';

import { env } from '../config/env';
import { getQueueRedis, isMemoryRedis } from '../config/redis';
import {
  ConceptGenerationBatch,
  type ConceptBatchFailure,
  type ConceptBatchStatus,
} from '../models/ConceptGenerationBatch';
import {
  getCatalogCompanies,
  getCatalogEntry,
  GENRE_LABELS,
  tierConceptTarget,
  type CompanyCatalogEntry,
} from '../data/companyConceptCatalog';
import {
  getRoleConceptEntry,
  ROLE_CONCEPT_KEYS,
  type RoleConceptCatalogEntry,
  type RoleConceptKey,
} from '../data/roleConceptCatalog';
import {
  generateAndSaveStarterConceptsForCompany,
  generateAndSaveStarterConceptsForRole,
  markBatchProgress,
} from './questionConcept.service';
import { logger } from '../utils/logger';

export type ConceptGenerationJob = {
  batchId: string;
  companySlug?: string;
  role?: RoleConceptKey;
  targetType?: 'company' | 'role';
  createdByUserId?: string;
};

const QUEUE_NAME = 'concept-generation';
const INTER_COMPANY_DELAY_MS = Number(process.env.CONCEPT_GEN_DELAY_MS || 12000);

let conceptGenerationQueue: Queue<ConceptGenerationJob, void, string> | null = null;
const memoryTimers = new Map<string, ReturnType<typeof setTimeout>>();
let memoryProcessing = false;
const memoryPendingJobs: ConceptGenerationJob[] = [];

export const getConceptGenerationQueue = () => {
  if (!conceptGenerationQueue) {
    conceptGenerationQueue = new Queue<ConceptGenerationJob, void, string>(QUEUE_NAME, {
      connection: getQueueRedis() as never,
      prefix: env.BULLMQ_PREFIX,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 8000 },
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    });
  }
  return conceptGenerationQueue;
};

const finalizeBatchIfDone = async (batchId: string) => {
  const batch = await ConceptGenerationBatch.findById(batchId);
  if (!batch) return;
  const done = batch.completedCompanies + batch.failedCompanies.length;
  if (done < batch.totalCompanies) return;

  const hasPartial = (batch.partialTargets?.length ?? 0) > 0;
  const hasFailures = batch.failedCompanies.length > 0;
  let status: ConceptBatchStatus = 'completed';
  if (hasFailures && batch.completedCompanies === 0) {
    status = 'failed';
  } else if (hasPartial || hasFailures) {
    status = 'partial';
  }

  batch.status = status;
  batch.completedAt = new Date();
  await batch.save();
};

export const processConceptGenerationJob = async (job: ConceptGenerationJob) => {
  const roleEntry = job.role ? getRoleConceptEntry(job.role) : undefined;
  const companyEntry = job.companySlug ? getCatalogEntry(job.companySlug) : undefined;
  if (!roleEntry && !companyEntry) {
    await markBatchProgress({
      batchId: job.batchId,
      companySlug: job.companySlug,
      role: job.role,
      targetLabel: job.role ?? job.companySlug,
      success: false,
      error: 'Company not found in catalog',
    });
    await finalizeBatchIfDone(job.batchId);
    return;
  }

  try {
    if (roleEntry) {
      const result = await generateAndSaveStarterConceptsForRole({
        entry: roleEntry,
        batchId: job.batchId,
        createdByUserId: job.createdByUserId,
      });
      await markBatchProgress({
        batchId: job.batchId,
        role: roleEntry.key,
        targetLabel: roleEntry.label,
        success: !result.isPartial,
        categoryShortfalls: result.isPartial ? result.categoryShortfalls : undefined,
      });
    } else {
      await generateAndSaveStarterConceptsForCompany({
        entry: companyEntry!,
        batchId: job.batchId,
        createdByUserId: job.createdByUserId,
      });
      await markBatchProgress({
        batchId: job.batchId,
        companySlug: companyEntry?.slug,
        companyLabel: companyEntry?.label,
        success: true,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    logger.warn(
      {
        batchId: job.batchId,
        company: companyEntry?.slug,
        role: roleEntry?.key,
        genre: companyEntry?.genre,
        tier: companyEntry?.tier,
        error: message,
        stack,
      },
      'Concept generation failed',
    );
    await markBatchProgress({
      batchId: job.batchId,
      companySlug: companyEntry?.slug,
      role: roleEntry?.key,
      companyLabel: companyEntry?.label,
      targetLabel: roleEntry?.label,
      success: false,
      error: message,
    });
  }

  await finalizeBatchIfDone(job.batchId);
};

const drainMemoryQueue = async () => {
  if (memoryProcessing) return;
  memoryProcessing = true;
  while (memoryPendingJobs.length) {
    const job = memoryPendingJobs.shift();
    if (!job) break;
    await processConceptGenerationJob(job);
    await new Promise((resolve) => setTimeout(resolve, INTER_COMPANY_DELAY_MS));
  }
  memoryProcessing = false;
};

const enqueueMemoryJob = (job: ConceptGenerationJob, delayMs = 0) => {
  const jobKey = `${job.batchId}:${job.role ?? job.companySlug}`;
  const timer = setTimeout(() => {
    memoryTimers.delete(jobKey);
    memoryPendingJobs.push(job);
    void drainMemoryQueue();
  }, delayMs);
  memoryTimers.set(jobKey, timer);
};

export const createConceptGenerationBatch = async (options: {
  scope: 'pilot' | 'full' | 'custom';
  slugs?: string[];
  targetType?: 'company' | 'role';
  roleKeys?: string[];
  createdByUserId?: string;
}) => {
  const companies = options.targetType === 'role' ? [] : getCatalogCompanies({
    scope: options.scope,
    slugs: options.slugs,
    limit: options.scope === 'full' ? 100 : undefined,
  });

  const roles: RoleConceptCatalogEntry[] = options.targetType === 'role'
    ? (options.roleKeys?.length ? options.roleKeys : [...ROLE_CONCEPT_KEYS])
      .map((role) => getRoleConceptEntry(role))
      .filter((entry): entry is RoleConceptCatalogEntry => Boolean(entry))
      .filter((entry, index, list) => list.findIndex((item) => item.key === entry.key) === index)
    : [];

  if (!companies.length && !roles.length) {
    throw new Error('No companies matched the requested generation scope.');
  }

  const batch = await ConceptGenerationBatch.create({
    scope: options.scope,
    targetType: options.targetType ?? 'company',
    status: 'queued',
    totalCompanies: options.targetType === 'role' ? roles.length : companies.length,
    completedCompanies: 0,
    failedCompanies: [],
    companySlugs: companies.map((entry) => entry.slug),
    roleKeys: roles.map((entry) => entry!.key),
    createdByUserId: options.createdByUserId,
  });

  const batchId = String(batch._id);
  let delayIndex = 0;

  const targets = options.targetType === 'role' ? roles : companies;
  for (const target of targets) {
    const payload: ConceptGenerationJob = {
      batchId,
      ...(options.targetType === 'role' ? { role: (target as RoleConceptCatalogEntry).key, targetType: 'role' as const } : { companySlug: (target as CompanyCatalogEntry).slug, targetType: 'company' as const }),
      createdByUserId: options.createdByUserId,
    };
    if (isMemoryRedis()) {
      if (process.env.NODE_ENV === 'test') {
        await processConceptGenerationJob(payload);
      } else {
        enqueueMemoryJob(payload, delayIndex * INTER_COMPANY_DELAY_MS);
      }
    } else {
      await getConceptGenerationQueue().add(
        options.targetType === 'role' ? 'generate-role-concepts' : 'generate-company-concepts',
        payload,
        { jobId: `${batchId}:${options.targetType === 'role' ? (target as RoleConceptCatalogEntry).key : (target as CompanyCatalogEntry).slug}`, delay: delayIndex * INTER_COMPANY_DELAY_MS } as JobsOptions,
      );
    }
    delayIndex += 1;
  }

  batch.status = 'running';
  batch.startedAt = new Date();
  await batch.save();

  return serializeBatch(batch.toJSON() as Record<string, unknown>, companies, roles as RoleConceptCatalogEntry[]);
};

const serializeBatch = (batch: Record<string, unknown>, companies?: CompanyCatalogEntry[], roles?: RoleConceptCatalogEntry[]) => ({
  id: String(batch._id),
  scope: batch.scope,
  targetType: batch.targetType ?? 'company',
  status: batch.status,
  totalCompanies: batch.totalCompanies,
  completedCompanies: batch.completedCompanies,
  failedCompanies: batch.failedCompanies ?? [],
  partialTargets: batch.partialTargets ?? [],
  companySlugs: batch.companySlugs ?? [],
  roleKeys: batch.roleKeys ?? [],
  companies: companies?.map((entry) => ({
    slug: entry.slug,
    label: entry.label,
    genre: entry.genre,
    genreLabel: GENRE_LABELS[entry.genre],
    tier: entry.tier,
    tierIsGuess: entry.tierIsGuess,
    conceptTarget: tierConceptTarget(entry.tier).target,
  })),
  roles: roles?.map((entry) => ({ key: entry.key, label: entry.label, conceptTarget: 50 })),
  startedAt: batch.startedAt ? new Date(batch.startedAt as Date).toISOString() : undefined,
  completedAt: batch.completedAt ? new Date(batch.completedAt as Date).toISOString() : undefined,
  createdAt: batch.createdAt ? new Date(batch.createdAt as Date).toISOString() : undefined,
  updatedAt: batch.updatedAt ? new Date(batch.updatedAt as Date).toISOString() : undefined,
});

export const getConceptGenerationBatch = async (batchId: string) => {
  if (!mongoose.Types.ObjectId.isValid(batchId)) return null;
  const batch = await ConceptGenerationBatch.findById(batchId).lean();
  if (!batch) return null;
  const companies = (batch.companySlugs ?? [])
    .map((slug) => getCatalogEntry(slug))
    .filter(Boolean) as CompanyCatalogEntry[];
  const roles = (batch.roleKeys ?? [])
    .map((key) => getRoleConceptEntry(String(key)))
    .filter(Boolean) as RoleConceptCatalogEntry[];
  return serializeBatch(batch as Record<string, unknown>, companies, roles);
};

export const listConceptGenerationBatches = async (limit = 20) => {
  const rows = await ConceptGenerationBatch.find().sort({ createdAt: -1 }).limit(limit).lean();
  return rows.map((row) => serializeBatch(row as Record<string, unknown>));
};

export const startConceptGenerationWorker = () => {
  if (isMemoryRedis()) {
    return { close: async () => undefined };
  }

  return new Worker<ConceptGenerationJob>(
    QUEUE_NAME,
    async (job) => {
      await processConceptGenerationJob(job.data);
    },
    {
      connection: getQueueRedis() as never,
      prefix: env.BULLMQ_PREFIX,
      concurrency: 1,
      limiter: {
        max: Number(process.env.CONCEPT_GEN_MAX_PER_MIN || 12),
        duration: 60_000,
      },
    },
  );
};

export const cancelConceptGenerationBatch = async (batchId: string) => {
  if (!mongoose.Types.ObjectId.isValid(batchId)) return null;
  const batch = await ConceptGenerationBatch.findByIdAndUpdate(
    batchId,
    { status: 'cancelled', completedAt: new Date() },
    { new: true },
  );
  if (!batch) return null;

  if (isMemoryRedis()) {
    for (const [key, timer] of memoryTimers.entries()) {
      if (key.startsWith(`${batchId}:`)) {
        clearTimeout(timer);
        memoryTimers.delete(key);
      }
    }
    for (let index = memoryPendingJobs.length - 1; index >= 0; index -= 1) {
      if (memoryPendingJobs[index]?.batchId === batchId) memoryPendingJobs.splice(index, 1);
    }
  } else {
    const queue = getConceptGenerationQueue();
    const jobs = await queue.getJobs(['delayed', 'waiting', 'paused']);
    await Promise.all(
      jobs
        .filter((job) => job.data.batchId === batchId)
        .map((job) => job.remove()),
    );
  }

  return serializeBatch(batch.toJSON() as Record<string, unknown>);
};

export type { ConceptBatchFailure };
