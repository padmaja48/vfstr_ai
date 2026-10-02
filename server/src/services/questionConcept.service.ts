import mongoose from 'mongoose';

import {
  CONCEPT_CATEGORIES,
  CONCEPT_TIERS,
  QuestionConcept,
  TIER_POOL_GUIDANCE,
  type ConceptCategory,
  type ConceptCreatedBy,
  type ConceptStatus,
  type ConceptTier,
  type IQuestionConcept,
} from '../models/QuestionConcept';
import { ConceptGenerationBatch } from '../models/ConceptGenerationBatch';
import {
  GENRE_LABELS,
  getCatalogEntry,
  tierConceptTarget,
  type CompanyCatalogEntry,
} from '../data/companyConceptCatalog';
import {
  buildRoleConceptGenerationPrompt,
  getRoleConceptEntry,
  isTemplatedRoleFallbackLabel,
  roleCategoryTargets,
  type RoleConceptCatalogEntry,
  type RoleConceptKey,
} from '../data/roleConceptCatalog';
import {
  buildCategoryMixGuidance,
  buildConceptPromptContext,
  buildGenreDifficultyGuidance,
  buildIndustryFallbackConceptSet,
  buildSpecificityRules,
  calibrateConceptSpecificity,
  isAdvancedItServicesCodingConcept,
  isBrokenFallbackConceptLabel,
  lookupItServicesCodingReplacement,
  sanitizeConceptsForGenre,
  resetItServicesReplacementPool,
  resetStrategyCasePool,
  sanitizeRoleConcepts,
} from './conceptGenreDifficulty';
import { isConceptAutoArchiveAtGenerationEnabled } from '../config/conceptAutoArchiveGuard';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';
import { slugifyCompanyName } from './companyQuestionBank';
import { logger } from '../utils/logger';
import type { ExperienceLevel } from './promptBuilder';
import type { GeneratedQuestion } from './ai.service';

export type ConceptRecord = {
  id: string;
  companySlug?: string;
  role?: RoleConceptKey;
  category: ConceptCategory;
  conceptLabel: string;
  tier: ConceptTier;
  status: ConceptStatus;
  createdBy: ConceptCreatedBy;
  createdByUserId?: string;
  usageCount: number;
  lastUsedAt?: string;
  batchId?: string;
  genre?: string;
  specificity?: 'company' | 'industry' | 'mixed';
  createdAt?: string;
  updatedAt?: string;
  manuallyEditedAt?: string;
  originalConceptLabel?: string;
  isTemplatedFallback?: boolean;
};

const serializeConcept = (doc: IQuestionConcept | Record<string, unknown>): ConceptRecord => {
  const row = typeof (doc as IQuestionConcept).toJSON === 'function'
    ? (doc as IQuestionConcept).toJSON()
    : doc;
  return {
    id: String((row as any)._id || (row as any).id),
    companySlug: (row as any).companySlug ? String((row as any).companySlug) : undefined,
    role: (row as any).role ? String((row as any).role) as RoleConceptKey : undefined,
    category: (row as any).category,
    conceptLabel: String((row as any).conceptLabel),
    tier: (row as any).tier,
    status: (row as any).status,
    createdBy: (row as any).createdBy,
    createdByUserId: (row as any).createdByUserId ? String((row as any).createdByUserId) : undefined,
    usageCount: Number((row as any).usageCount ?? 0),
    lastUsedAt: (row as any).lastUsedAt ? new Date((row as any).lastUsedAt).toISOString() : undefined,
    batchId: (row as any).batchId ? String((row as any).batchId) : undefined,
    genre: (row as any).genre ? String((row as any).genre) : undefined,
    specificity: (row as any).specificity,
    manuallyEditedAt: (row as any).manuallyEditedAt
      ? new Date((row as any).manuallyEditedAt).toISOString()
      : undefined,
    originalConceptLabel: (row as any).originalConceptLabel
      ? String((row as any).originalConceptLabel)
      : undefined,
    isTemplatedFallback: isTemplatedRoleFallbackLabel(String((row as any).conceptLabel || '')),
    createdAt: (row as any).createdAt ? new Date((row as any).createdAt).toISOString() : undefined,
    updatedAt: (row as any).updatedAt ? new Date((row as any).updatedAt).toISOString() : undefined,
  };
};

export type PriorBatchArchiveReport = {
  companySlug?: string;
  role?: RoleConceptKey;
  newBatchId: string;
  archivedCount: number;
  preservedCount: number;
  archivedBatchIds: string[];
  preservedConceptIds: string[];
  preservedConceptLabels: string[];
};

/** True when an admin intentionally changed content — skip auto-archive on regeneration. */
export const isManuallyEditedConcept = (row: {
  createdBy?: ConceptCreatedBy | string;
  manuallyEditedAt?: Date | string | null;
  originalConceptLabel?: string | null;
  conceptLabel?: string;
}) => {
  if (row.createdBy === 'admin') return true;
  if (row.manuallyEditedAt) return true;
  if (
    row.originalConceptLabel
    && String(row.conceptLabel || '').trim() !== String(row.originalConceptLabel).trim()
  ) {
    return true;
  }
  return false;
};

/**
 * Archive prior starter-batch concepts for a company before saving a new generation run.
 * Reuses the same soft-archive mechanism as cleanupPilotBatchSurplus.ts (status: archived).
 */
export const archivePriorStarterConceptsForCompany = async (input: {
  companySlug: string;
  newBatchId: string;
  /** When false (default), only stale pending_review rows are archived — never approved active pools. */
  archiveActive?: boolean;
}): Promise<PriorBatchArchiveReport> => {
  const companySlug = slugifyCompanyName(input.companySlug);
  const archiveActive = input.archiveActive ?? false;
  const statusFilter: ConceptStatus[] = archiveActive
    ? ['active', 'pending_review']
    : ['pending_review'];

  const priorRows = await QuestionConcept.find({
    companySlug,
    status: { $in: statusFilter },
  }).lean();

  const toArchive: string[] = [];
  const preservedConceptIds: string[] = [];
  const preservedConceptLabels: string[] = [];
  const archivedBatchIdSet = new Set<string>();

  for (const row of priorRows) {
    if (isManuallyEditedConcept(row)) {
      preservedConceptIds.push(String(row._id));
      preservedConceptLabels.push(String(row.conceptLabel));
      continue;
    }
    toArchive.push(String(row._id));
    if (row.batchId) archivedBatchIdSet.add(String(row.batchId));
  }

  if (toArchive.length) {
    await QuestionConcept.updateMany(
      { _id: { $in: toArchive } },
      { $set: { status: 'archived' } },
    );
  }

  const report: PriorBatchArchiveReport = {
    companySlug,
    newBatchId: input.newBatchId,
    archivedCount: toArchive.length,
    preservedCount: preservedConceptIds.length,
    archivedBatchIds: [...archivedBatchIdSet],
    preservedConceptIds,
    preservedConceptLabels,
  };

  if (report.archivedCount || report.preservedCount) {
    logger.info(
      {
        companySlug: report.companySlug,
        newBatchId: report.newBatchId,
        archivedCount: report.archivedCount,
        preservedCount: report.preservedCount,
        archivedBatchIds: report.archivedBatchIds,
        preservedConceptIds: report.preservedConceptIds,
      },
      'Auto-archived prior starter concept batch before saving new generation',
    );
  }

  return report;
};

export const archivePriorStarterConceptsForRole = async (input: {
  role: RoleConceptKey;
  newBatchId: string;
}): Promise<PriorBatchArchiveReport> => {
  const priorRows = await QuestionConcept.find({ role: input.role, status: 'pending_review' }).lean();
  const toArchive: string[] = [];
  const preservedConceptIds: string[] = [];
  const preservedConceptLabels: string[] = [];
  const archivedBatchIdSet = new Set<string>();

  for (const row of priorRows) {
    if (isManuallyEditedConcept(row)) {
      preservedConceptIds.push(String(row._id));
      preservedConceptLabels.push(String(row.conceptLabel));
      continue;
    }
    toArchive.push(String(row._id));
    if (row.batchId) archivedBatchIdSet.add(String(row.batchId));
  }

  if (toArchive.length) {
    await QuestionConcept.updateMany({ _id: { $in: toArchive } }, { $set: { status: 'archived' } });
  }

  return {
    role: input.role,
    newBatchId: input.newBatchId,
    archivedCount: toArchive.length,
    preservedCount: preservedConceptIds.length,
    archivedBatchIds: [...archivedBatchIdSet],
    preservedConceptIds,
    preservedConceptLabels,
  };
};

/** Weight for LRU-style global rotation — lower usage / older lastUsedAt ranks first. */
export const conceptGlobalRank = (concept: Pick<ConceptRecord, 'usageCount' | 'lastUsedAt'>) => {
  const usage = concept.usageCount ?? 0;
  const ageMs = concept.lastUsedAt
    ? Date.now() - new Date(concept.lastUsedAt).getTime()
    : Number.MAX_SAFE_INTEGER;
  return usage * 1_000_000 - Math.min(ageMs, 90 * 24 * 60 * 60 * 1000);
};

const categoryMatches = (concept: ConceptRecord, categories: ConceptCategory[]) =>
  categories.includes(concept.category);

/**
 * Select concepts: exclude student's recent ids first; prefer globally least-used;
 * if all excluded, fall back to student's least-recently-used among full pool.
 */
export const selectConceptsFromPool = (
  pool: ConceptRecord[],
  options: {
    categories: ConceptCategory[];
    count: number;
    excludedConceptIds?: string[];
    studentConceptHistory?: Array<{ conceptId: string; lastUsedAt?: string }>;
  },
): ConceptRecord[] => {
  const active = pool.filter((c) => c.status === 'active' && categoryMatches(c, options.categories));
  if (!active.length || options.count <= 0) return [];

  const excluded = new Set(options.excludedConceptIds ?? []);
  const exhaustedForStudent = !active.some((c) => !excluded.has(c.id));
  let eligible = active.filter((c) => !excluded.has(c.id));

  if (!eligible.length) {
    const repeatPool = active.filter((c) => excluded.has(c.id));
    eligible = repeatPool.length ? repeatPool : active;
    const historyTime = new Map<string, number>();
    (options.studentConceptHistory ?? []).forEach((entry) => {
      const ts = entry.lastUsedAt ? new Date(entry.lastUsedAt).getTime() : 0;
      const prev = historyTime.get(entry.conceptId);
      if (prev === undefined || ts < prev) historyTime.set(entry.conceptId, ts);
    });
    eligible = [...eligible].sort((left, right) => {
      const leftTs = historyTime.get(left.id);
      const rightTs = historyTime.get(right.id);
      const leftRank = leftTs ?? Number.MAX_SAFE_INTEGER;
      const rightRank = rightTs ?? Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return conceptGlobalRank(left) - conceptGlobalRank(right);
    });
  } else {
    eligible = [...eligible].sort((a, b) => conceptGlobalRank(a) - conceptGlobalRank(b));
  }

  const picked: ConceptRecord[] = [];
  const poolWindow = eligible.slice(0, Math.max(options.count * 3, 5));
  while (picked.length < options.count && poolWindow.length) {
    const remaining = poolWindow.filter((concept) => !picked.some((item) => item.id === concept.id));
    if (!remaining.length) break;
    remaining.sort((a, b) => {
      if (exhaustedForStudent) {
        return eligible.indexOf(a) - eligible.indexOf(b);
      }
      return conceptGlobalRank(a) - conceptGlobalRank(b);
    });
    const band = remaining.filter(
      (concept) => concept.usageCount === remaining[0].usageCount
        && (concept.lastUsedAt || '') === (remaining[0].lastUsedAt || ''),
    );
    const index = (picked.length + remaining[0].usageCount) % band.length;
    picked.push(band[index] ?? remaining[0]);
  }

  if (picked.length < options.count) {
    for (const concept of eligible) {
      if (picked.length >= options.count) break;
      if (!picked.some((p) => p.id === concept.id)) picked.push(concept);
    }
  }

  return picked.slice(0, options.count);
};

const OFFICIAL_CLAIM_BAN =
  'Do NOT claim this is an official, actual, verified, or guaranteed question asked by the company. '
  + 'Frame it as realistic practice based on the topic area only.';

let paraphraseFallbackNonce = 0;

const fallbackQuestionFromConcept = (input: {
  companyLabel?: string;
  conceptLabel: string;
  category: ConceptCategory;
  role: string;
}) => {
  const { companyLabel, conceptLabel, category, role } = input;
  const contextLabel = companyLabel ? companyLabel : `general ${role}`;
  const seed = Date.now() + conceptLabel.length + contextLabel.length + paraphraseFallbackNonce++;
  const pick = <T,>(items: T[]) => items[Math.abs(seed + items.length) % items.length];
  const asQuestion = (text: string) => `${text.replace(/[.!?]+$/, '')}?`;

  if (category === 'Culture' || category === 'Behavioral') {
    return asQuestion(pick([
      `For ${contextLabel} practice, tell me about a time you demonstrated ${conceptLabel.toLowerCase()} — what was the situation, what did you do, and what changed?`,
      `In a ${contextLabel} mock interview, how have you shown ${conceptLabel.toLowerCase()} on a team? Walk me through one concrete example.`,
      `Imagine you're interviewing for a ${role} role: describe a moment where ${conceptLabel.toLowerCase()} mattered — what did you decide and why?`,
    ]));
  }
  if (category === 'Coding') {
    return asQuestion(pick([
      `Practice coding round (${contextLabel} style): ${conceptLabel}. Walk me through your approach, edge cases, and time/space complexity for a ${role} context.`,
      `Let's work through a coding-style prompt for ${contextLabel}: ${conceptLabel}. Explain your algorithm, test cases, and complexity.`,
      `For a ${role} coding practice question (${contextLabel} topic area): ${conceptLabel}. How would you structure your solution and validate it?`,
    ]));
  }
  return asQuestion(pick([
    `For a ${role} practice question in the spirit of ${contextLabel}: ${conceptLabel}. Explain with a concrete example from your experience.`,
    `Mock ${contextLabel} technical depth: ${conceptLabel}. How would you explain your approach and trade-offs to an interviewer?`,
    `Practice technical question (${contextLabel} topic): ${conceptLabel}. Use a real project example if you can.`,
  ]));
};

export const paraphraseConceptToQuestion = async (input: {
  conceptLabel: string;
  category: ConceptCategory;
  companyLabel?: string;
  role: string;
  experienceLevel: ExperienceLevel;
  resumeProject?: string;
  resumeSkills?: string[];
}): Promise<string> => {
  const fallback = fallbackQuestionFromConcept(input);
  const apiKey = env.AI_PROVIDER === 'openai' ? env.OPENAI_API_KEY : env.GROQ_API_KEY;
  if (!apiKey || process.env.NODE_ENV === 'test') return fallback;

  const resumeBlock = [
    input.resumeProject ? `Resume project: ${input.resumeProject}` : '',
    input.resumeSkills?.length ? `Resume skills: ${input.resumeSkills.slice(0, 12).join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const prompt = `Write ONE spoken interview question for mock practice.

${input.companyLabel ? `Company context (style only): ${input.companyLabel}` : 'Context: generic role practice; do not invent a company'}
Role: ${input.role} (${input.experienceLevel})
Topic concept (NOT a finished question — expand naturally): ${input.conceptLabel}
Category: ${input.category}
${resumeBlock ? `\nCandidate resume hints (weave in naturally if relevant):\n${resumeBlock}` : ''}

Rules:
- Output ONLY the question text — no preamble, no JSON, no numbering.
- Natural conversational interviewer tone; vary wording — do not reuse template phrasing.
- ${OFFICIAL_CLAIM_BAN}
- Ground in the concept topic; optional resume tie-in when it fits.
- One question only, ending with ?`;

  const endpoint =
    env.AI_PROVIDER === 'openai'
      ? `${env.OPENAI_BASE_URL.replace(/\/$/, '')}/chat/completions`
      : `${env.GROQ_BASE_URL.replace(/\/$/, '')}/chat/completions`;
  const model = env.AI_PROVIDER === 'openai' ? env.OPENAI_MODEL : env.GROQ_MODEL;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.75,
        messages: [
          {
            role: 'system',
            content:
              'You write realistic mock interview questions. Never claim questions are official company questions.',
          },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!response.ok) return fallback;
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = String(data.choices?.[0]?.message?.content || '').trim().replace(/^["']|["']$/g, '');
    if (text.length < 20) return fallback;
    if (!text.endsWith('?')) return `${text.replace(/[.!]+$/, '')}?`;
    return text;
  } catch {
    return fallback;
  }
};

export const recordConceptUsage = async (conceptIds: string[]) => {
  const ids = conceptIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (!ids.length) return;
  const now = new Date();
  await QuestionConcept.updateMany(
    { _id: { $in: ids } },
    { $inc: { usageCount: 1 }, $set: { lastUsedAt: now } },
  );
};

export const listConcepts = async (options: {
  page?: number;
  limit?: number;
  companySlug?: string;
  role?: string;
  category?: string;
  tier?: string;
  status?: ConceptStatus | 'all';
  search?: string;
}) => {
  const page = Math.max(1, options.page || 1);
  const limit = Math.min(100, Math.max(1, options.limit || 25));
  const filter: Record<string, unknown> = {};
  if (options.companySlug?.trim()) filter.companySlug = slugifyCompanyName(options.companySlug.trim());
  if (options.role?.trim()) filter.role = options.role.trim();
  if (options.category && options.category !== 'all') filter.category = options.category;
  if (options.tier && options.tier !== 'all') filter.tier = options.tier;
  if (options.status && options.status !== 'all') filter.status = options.status;
  if (options.search?.trim()) {
    filter.conceptLabel = { $regex: options.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  }

  const [rows, total] = await Promise.all([
    QuestionConcept.find(filter).sort({ companySlug: 1, role: 1, category: 1, usageCount: 1 }).skip((page - 1) * limit).limit(limit),
    QuestionConcept.countDocuments(filter),
  ]);

  return {
    concepts: rows.map(serializeConcept),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
};

export const getConceptById = async (id: string) => {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const row = await QuestionConcept.findById(id);
  return row ? serializeConcept(row) : null;
};

export const createConceptRecord = async (input: {
  companySlug?: string;
  role?: RoleConceptKey;
  category: ConceptCategory;
  conceptLabel: string;
  tier: ConceptTier;
  createdBy: ConceptCreatedBy;
  createdByUserId?: string;
  status?: ConceptStatus;
  batchId?: string;
  genre?: string;
  specificity?: 'company' | 'industry' | 'mixed';
}) => {
  if (!input.companySlug && !input.role) throw new Error('Concept requires companySlug or role');
  const row = await QuestionConcept.create({
    companySlug: input.companySlug ? slugifyCompanyName(input.companySlug) : undefined,
    role: input.role,
    category: input.category,
    conceptLabel: input.conceptLabel.trim(),
    originalConceptLabel: input.conceptLabel.trim(),
    tier: input.tier,
    createdBy: input.createdBy,
    createdByUserId: input.createdByUserId,
    status: input.status ?? 'active',
    batchId: input.batchId,
    genre: input.genre,
    specificity: input.specificity,
    usageCount: 0,
  });
  return serializeConcept(row);
};

export const updateConceptRecord = async (
  id: string,
  input: Partial<{
    conceptLabel: string;
    category: ConceptCategory;
    tier: ConceptTier;
    status: ConceptStatus;
    specificity: 'company' | 'industry' | 'mixed';
  }>,
) => {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;

  const existing = await QuestionConcept.findById(id).lean();
  if (!existing) return null;

  const $set: Record<string, unknown> = {};
  const contentChanged =
    (input.conceptLabel !== undefined && input.conceptLabel.trim() !== existing.conceptLabel)
    || (input.category !== undefined && input.category !== existing.category)
    || (input.tier !== undefined && input.tier !== existing.tier);

  if (input.conceptLabel !== undefined) $set.conceptLabel = input.conceptLabel.trim();
  if (input.category !== undefined) $set.category = input.category;
  if (input.tier !== undefined) $set.tier = input.tier;
  if (input.status !== undefined) $set.status = input.status;
  if (input.specificity !== undefined) $set.specificity = input.specificity;

  if (contentChanged) {
    $set.manuallyEditedAt = new Date();
  }

  if (!Object.keys($set).length) {
    return serializeConcept(existing as unknown as IQuestionConcept);
  }

  const row = await QuestionConcept.findByIdAndUpdate(
    id,
    { $set },
    { new: true, runValidators: true },
  );
  return row ? serializeConcept(row) : null;
};

export const archiveConceptRecord = async (id: string) =>
  updateConceptRecord(id, { status: 'archived' });

export const deleteConceptRecord = async (id: string) => {
  if (!mongoose.Types.ObjectId.isValid(id)) return false;
  const result = await QuestionConcept.findByIdAndDelete(id);
  return Boolean(result);
};

export const bulkCreateConcepts = async (
  items: Array<{
    companySlug?: string;
    role?: RoleConceptKey;
    category: ConceptCategory;
    conceptLabel: string;
    tier: ConceptTier;
    createdBy: ConceptCreatedBy;
    createdByUserId?: string;
    status?: ConceptStatus;
    batchId?: string;
    genre?: string;
    specificity?: 'company' | 'industry' | 'mixed';
  }>,
) => {
  const created: ConceptRecord[] = [];
  for (const item of items) {
    created.push(await createConceptRecord(item));
  }
  return { created, count: created.length };
};

export const getCompanyPoolSummaries = async () => {
  const grouped = await QuestionConcept.aggregate([
    { $match: { status: 'active' } },
    {
      $group: {
        _id: '$companySlug',
        count: { $sum: 1 },
        tier: { $first: '$tier' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return grouped.map((row) => {
    const companySlug = row._id as string;
    const count = row.count as number;
    const tier = (row.tier as ConceptTier) || 'medium';
    const guidance = TIER_POOL_GUIDANCE[tier] ?? TIER_POOL_GUIDANCE.medium;
    const provisioned =
      count >= guidance.min && count <= guidance.max
        ? 'in_range'
        : count < guidance.min
        ? 'under'
        : 'over';
    return {
      companySlug,
      tier,
      activeConceptCount: count,
      recommendedMin: guidance.min,
      recommendedMax: guidance.max,
      provisioned,
      guidanceLabel: guidance.label,
    };
  });
};

export const loadActiveConceptsForCompany = async (companySlug: string) => {
  const rows = await QuestionConcept.find({
    companySlug: slugifyCompanyName(companySlug),
    status: 'active',
  }).lean();
  return rows.map((row) => serializeConcept(row as unknown as IQuestionConcept));
};

export const loadActiveConceptsForRole = async (role: string) => {
  const entry = getRoleConceptEntry(role);
  if (!entry) return [];
  const rows = await QuestionConcept.find({ role: entry.key, status: 'active' }).lean();
  return rows.map((row) => serializeConcept(row as unknown as IQuestionConcept));
};

export const generateConceptLabelCandidates = async (input: {
  companyLabel: string;
  companySlug: string;
  tier: ConceptTier;
  roleTopic: string;
  categories: ConceptCategory[];
  count: number;
}) => {
  const apiKey = env.AI_PROVIDER === 'openai' ? env.OPENAI_API_KEY : env.GROQ_API_KEY;
  const perCategory = Math.max(1, Math.ceil(input.count / input.categories.length));
  const fallback = input.categories.flatMap((category) =>
    Array.from({ length: perCategory }, (_, index) => ({
      companySlug: input.companySlug,
      category,
      conceptLabel: `${input.roleTopic} — ${category} practice area ${index + 1}`,
      tier: input.tier,
    })),
  );

  if (!apiKey || process.env.NODE_ENV === 'test') {
    return fallback.slice(0, input.count);
  }

  const endpoint =
    env.AI_PROVIDER === 'openai'
      ? `${env.OPENAI_BASE_URL.replace(/\/$/, '')}/chat/completions`
      : `${env.GROQ_BASE_URL.replace(/\/$/, '')}/chat/completions`;
  const model = env.AI_PROVIDER === 'openai' ? env.OPENAI_MODEL : env.GROQ_MODEL;

  const prompt = `Generate ${input.count} SHORT interview topic concepts (NOT full questions) for mock practice at ${input.companyLabel}.
Role context: ${input.roleTopic}
Company tier: ${input.tier}
Categories to cover: ${input.categories.join(', ')}
${(() => {
    const entry = getCatalogEntry(input.companySlug);
    return entry ? `\n${buildGenreDifficultyGuidance(entry)}\n` : '';
  })()}

Each conceptLabel should be 5–15 words describing a topic area, e.g. "Distributed systems / high-scale read traffic design".
Return ONLY JSON:
{
  "concepts": [
    { "category": "Technical"|"Culture"|"Coding"|"Behavioral", "conceptLabel": string }
  ]
}`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Return strict JSON only. Concepts are topic labels, not questions.' },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!response.ok) return fallback.slice(0, input.count);
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '{}') as {
      concepts?: Array<{ category?: string; conceptLabel?: string }>;
    };
    const entry = getCatalogEntry(input.companySlug);
    let results = (parsed.concepts ?? [])
      .map((item) => ({
        companySlug: input.companySlug,
        category: (CONCEPT_CATEGORIES.includes(item.category as ConceptCategory)
          ? item.category
          : 'Technical') as ConceptCategory,
        conceptLabel: String(item.conceptLabel || '').trim(),
        tier: input.tier,
      }))
      .filter((item) => item.conceptLabel.length >= 8)
      .slice(0, input.count);

    if (entry) {
      resetItServicesReplacementPool();
      results = sanitizeConceptsForGenre(
        results.map((row) => ({ category: row.category, conceptLabel: row.conceptLabel })),
        entry,
      ).map((sanitized, index) => ({
        ...results[index],
        conceptLabel: sanitized.conceptLabel,
      }));
    }

    return results;
  } catch {
    return fallback.slice(0, input.count);
  }
};

const conceptToGeneratedQuestion = (
  questionText: string,
  concept: ConceptRecord,
  contextLabel: string,
  index: number,
  total: number,
): GeneratedQuestion & { conceptId: string } => {
  const isCoding = concept.category === 'Coding';
  const isBehavioral = concept.category === 'Culture' || concept.category === 'Behavioral';
  return {
    question: questionText,
    questionId: `concept:${concept.id}`,
    conceptId: concept.id,
    expectedSignals: isCoding
      ? ['approach explanation', 'edge cases', 'complexity analysis']
      : isBehavioral
      ? ['STAR structure', 'specific example', 'clear outcome']
      : ['accurate explanation', 'practical example', 'role relevance'],
    questionType: isBehavioral ? 'behavioural' : isCoding ? 'technical' : 'technical',
    resumeReference: `${contextLabel} · concept:${concept.category}`,
    difficulty: isCoding ? 'medium-hard' : index === 0 ? 'easy-medium' : 'medium',
    topic:
      concept.category === 'Culture'
        ? `${contextLabel} culture`
        : isCoding
        ? `${contextLabel} coding`
        : `${contextLabel} technical`,
    followUpIntent: isCoding ? 'challenge' : 'deepen',
  };
};

export type BuildConceptPackInput = {
  companyName: string;
  companyLabel: string;
  role: string;
  experienceLevel: ExperienceLevel;
  resumeProject?: string;
  resumeSkills?: string[];
  excludedConceptIds?: string[];
  studentConceptHistory?: Array<{ conceptId: string; lastUsedAt?: string }>;
};

/** Build company question pack from concept pool + fresh AI wording. */
export const buildConceptBasedCompanyQuestions = async (
  input: BuildConceptPackInput,
): Promise<(GeneratedQuestion & { conceptId?: string })[]> => {
  const slug = slugifyCompanyName(input.companyName);
  const pool = await loadActiveConceptsForCompany(slug);
  if (!pool.length) return [];

  const technicalCount = input.experienceLevel === 'fresher' ? 3 : 4;
  const culturePick = selectConceptsFromPool(pool, {
    categories: ['Culture', 'Behavioral'],
    count: 1,
    excludedConceptIds: input.excludedConceptIds,
    studentConceptHistory: input.studentConceptHistory,
  });
  const technicalPick = selectConceptsFromPool(pool, {
    categories: ['Technical'],
    count: technicalCount,
    excludedConceptIds: [
      ...(input.excludedConceptIds ?? []),
      ...culturePick.map((c) => c.id),
    ],
    studentConceptHistory: input.studentConceptHistory,
  });
  const codingPick = selectConceptsFromPool(pool, {
    categories: ['Coding'],
    count: 1,
    excludedConceptIds: [
      ...(input.excludedConceptIds ?? []),
      ...culturePick.map((c) => c.id),
      ...technicalPick.map((c) => c.id),
    ],
    studentConceptHistory: input.studentConceptHistory,
  });

  const ordered = [...culturePick, ...technicalPick, ...codingPick];
  if (!ordered.length) return [];

  const results: (GeneratedQuestion & { conceptId?: string })[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const concept = ordered[index];
    const questionText = await paraphraseConceptToQuestion({
      conceptLabel: concept.conceptLabel,
      category: concept.category,
      companyLabel: input.companyLabel,
      role: input.role,
      experienceLevel: input.experienceLevel,
      resumeProject: input.resumeProject,
      resumeSkills: input.resumeSkills,
    });
    results.push(
      conceptToGeneratedQuestion(questionText, concept, input.companyLabel, index, ordered.length),
    );
  }

  await recordConceptUsage(ordered.map((c) => c.id));
  return results;
};

export type BuildRoleConceptPackInput = {
  role: string;
  experienceLevel: ExperienceLevel;
  resumeProject?: string;
  resumeSkills?: string[];
  excludedConceptIds?: string[];
  studentConceptHistory?: Array<{ conceptId: string; lastUsedAt?: string }>;
};

/** Build generic role questions from approved concepts using the same LRU + paraphrase path. */
export const buildConceptBasedRoleQuestions = async (
  input: BuildRoleConceptPackInput,
): Promise<(GeneratedQuestion & { conceptId?: string })[]> => {
  const entry = getRoleConceptEntry(input.role);
  if (!entry) return [];
  const pool = await loadActiveConceptsForRole(entry.key);
  if (!pool.length) return [];

  const isHr = entry.key === 'hr_behavioral';
  const technicalCount = isHr ? 0 : input.experienceLevel === 'fresher' ? 3 : 4;
  const culturePick = selectConceptsFromPool(pool, {
    categories: ['Culture', 'Behavioral'],
    count: isHr ? 5 : 1,
    excludedConceptIds: input.excludedConceptIds,
    studentConceptHistory: input.studentConceptHistory,
  });
  const technicalPick = selectConceptsFromPool(pool, {
    categories: ['Technical'],
    count: technicalCount,
    excludedConceptIds: [
      ...(input.excludedConceptIds ?? []),
      ...culturePick.map((c) => c.id),
    ],
    studentConceptHistory: input.studentConceptHistory,
  });
  const codingPick = selectConceptsFromPool(pool, {
    categories: ['Coding'],
    count: isHr ? 0 : 1,
    excludedConceptIds: [
      ...(input.excludedConceptIds ?? []),
      ...culturePick.map((c) => c.id),
      ...technicalPick.map((c) => c.id),
    ],
    studentConceptHistory: input.studentConceptHistory,
  });

  const ordered = [...culturePick, ...technicalPick, ...codingPick];
  const results: (GeneratedQuestion & { conceptId?: string })[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const concept = ordered[index];
    const questionText = await paraphraseConceptToQuestion({
      conceptLabel: concept.conceptLabel,
      category: concept.category,
      role: entry.label,
      experienceLevel: input.experienceLevel,
      resumeProject: input.resumeProject,
      resumeSkills: input.resumeSkills,
    });
    results.push(conceptToGeneratedQuestion(questionText, concept, entry.label, index, ordered.length));
  }

  await recordConceptUsage(ordered.map((c) => c.id));
  return results;
};

export const collectStudentConceptUsage = (
  interviews: Array<{
    targetCompany?: string;
    askedConceptIds?: string[];
    questions?: Array<{ conceptId?: string }>;
    createdAt?: Date | string;
  }>,
  companySlug: string,
) => {
  const excludedConceptIds: string[] = [];
  const studentConceptHistory: Array<{ conceptId: string; lastUsedAt?: string }> = [];

  interviews.forEach((interview) => {
    const slug = interview.targetCompany ? slugifyCompanyName(interview.targetCompany) : '';
    if (slug !== companySlug) return;

    const ids = new Set<string>([
      ...(interview.askedConceptIds ?? []),
      ...(interview.questions ?? [])
        .map((question) => question.conceptId)
        .filter((id): id is string => Boolean(id)),
    ]);

    ids.forEach((conceptId) => {
      if (!excludedConceptIds.includes(conceptId)) excludedConceptIds.push(conceptId);
      studentConceptHistory.push({
        conceptId,
        lastUsedAt: interview.createdAt ? new Date(interview.createdAt).toISOString() : undefined,
      });
    });
  });

  return { excludedConceptIds, studentConceptHistory };
};

export const collectStudentRoleConceptUsage = (
  interviews: Array<{
    roleDomain?: string;
    askedConceptIds?: string[];
    questions?: Array<{ conceptId?: string }>;
    createdAt?: Date | string;
  }>,
  role: string,
) => {
  const entry = getRoleConceptEntry(role);
  const excludedConceptIds: string[] = [];
  const studentConceptHistory: Array<{ conceptId: string; lastUsedAt?: string }> = [];
  if (!entry) return { excludedConceptIds, studentConceptHistory };

  interviews.forEach((interview) => {
    if (getRoleConceptEntry(interview.roleDomain)?.key !== entry.key) return;
    const ids = new Set<string>([
      ...(interview.askedConceptIds ?? []),
      ...(interview.questions ?? [])
        .map((question) => question.conceptId)
        .filter((id): id is string => Boolean(id)),
    ]);
    ids.forEach((conceptId) => {
      if (!excludedConceptIds.includes(conceptId)) excludedConceptIds.push(conceptId);
      studentConceptHistory.push({
        conceptId,
        lastUsedAt: interview.createdAt ? new Date(interview.createdAt).toISOString() : undefined,
      });
    });
  });
  return { excludedConceptIds, studentConceptHistory };
};

const OFFICIAL_HONESTY =
  'Do NOT claim these are official, actual, verified, or guaranteed interview questions from the company. '
  + 'They are realistic practice topic areas only.';

export type StarterConceptDraft = {
  category: ConceptCategory;
  conceptLabel: string;
  specificity?: 'company' | 'industry' | 'mixed';
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const parseRetryAfterMs = (header: string | null) => {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
};

const fetchConceptGenerationCompletion = async (
  endpoint: string,
  apiKey: string,
  model: string,
  prompt: string,
  companyLabel: string,
) => {
  const maxAttempts = Number(process.env.CONCEPT_GEN_MAX_ATTEMPTS || 6);
  let lastError = 'Unknown AI error';

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.65,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'Return strict JSON. Concepts are short topic labels for mock interview practice — never full questions.',
          },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (response.ok) {
      return response;
    }

    const body = await response.text().catch(() => '');
    lastError = `AI generation failed (${response.status}) for ${companyLabel}${body ? `: ${body.slice(0, 300)}` : ''}`;

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= maxAttempts) {
      logger.warn(
        { companyLabel, status: response.status, attempt, body: body.slice(0, 500) },
        'Concept generation AI request failed',
      );
      return { ok: false as const, status: response.status, error: lastError, body };
    }

    const retryAfterMs =
      parseRetryAfterMs(response.headers.get('retry-after'))
      ?? Math.min(90_000, 3000 * 2 ** (attempt - 1));
    logger.warn(
      { companyLabel, status: response.status, attempt, retryAfterMs },
      'Concept generation AI rate limited — retrying',
    );
    await sleep(retryAfterMs);
  }

  return { ok: false as const, status: 0, error: lastError, body: '' };
};

export const generateStarterConceptSetForCompany = async (
  entry: CompanyCatalogEntry,
): Promise<StarterConceptDraft[]> => {
  const { target, min: minConcepts } = tierConceptTarget(entry.tier);
  const genreLabel = GENRE_LABELS[entry.genre];
  const tierNote = entry.tierIsGuess
    ? `(Tier "${entry.tier}" is an estimated traffic tier — use it only for pool sizing.)`
    : `(Tier "${entry.tier}" is a curated traffic tier.)`;

  const fallback = buildIndustryFallbackConceptSet(entry, target);

  const apiKey =
    (env.AI_PROVIDER === 'openai' ? env.OPENAI_API_KEY : env.GROQ_API_KEY)
    || process.env.GROQ_API_KEY
    || process.env.OPENAI_API_KEY;
  const useTestFallback =
    process.env.NODE_ENV === 'test' && process.env.FORCE_CONCEPT_AI_IN_TEST !== '1';
  if (!apiKey || useTestFallback) return fallback;

  const categoryMix = buildCategoryMixGuidance(entry);

  const genreDifficulty = buildGenreDifficultyGuidance(entry);
  const promptContext = buildConceptPromptContext(entry);
  const specificityRules = buildSpecificityRules(entry);

  const prompt = `Generate ${target} SHORT interview topic concepts (NOT full questions) for mock practice targeting ${entry.label}.

Industry / genre: ${genreLabel}
Company slug: ${entry.slug}
${tierNote}
Target pool size: ${target} concepts total.
Category mix guidance: ${categoryMix}

${genreDifficulty ? `${genreDifficulty}\n` : ''}
${promptContext}

Rules:
- Each conceptLabel is 5–15 words — a topic area, NOT a finished question.
- ${OFFICIAL_HONESTY}
- Do NOT fabricate specific claims about this company's actual interview process that you are not reasonably confident are commonly known.
- If you lack meaningful company-specific signal for a category, generate a strong industry/role-typical concept instead of inventing fake company-specific detail.
- For lesser-known companies it is fine if most concepts are industry-typical; mark those with specificity "industry".
${specificityRules}

Return ONLY JSON:
{
  "concepts": [
    {
      "category": "Technical"|"Culture"|"Coding"|"Behavioral",
      "conceptLabel": string,
      "specificity": "company"|"industry"|"mixed"
    }
  ]
}`;

  const endpoint =
    env.AI_PROVIDER === 'openai'
      ? `${env.OPENAI_BASE_URL.replace(/\/$/, '')}/chat/completions`
      : `${env.GROQ_BASE_URL.replace(/\/$/, '')}/chat/completions`;
  const model = env.AI_PROVIDER === 'openai' ? env.OPENAI_MODEL : env.GROQ_MODEL;

  const aiResult = await fetchConceptGenerationCompletion(
    endpoint,
    apiKey,
    model,
    prompt,
    entry.label,
  );

  if (!('ok' in aiResult) || aiResult.ok === false) {
    const status = 'status' in aiResult ? aiResult.status : 0;
    if (status === 429) {
      logger.warn(
        { company: entry.slug, genre: entry.genre, tier: entry.tier, tierIsGuess: entry.tierIsGuess },
        'AI rate limit exhausted after retries — failing batch item instead of saving padded fallback',
      );
      throw new Error(`AI rate limit exhausted for ${entry.label} after retries — re-queue this company later`);
    }
    throw new Error('error' in aiResult ? aiResult.error : `AI generation failed for ${entry.label}`);
  }

  const response = aiResult;

  let parsed: { concepts?: Array<{ category?: string; conceptLabel?: string; specificity?: string }> };
  try {
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '{}') as typeof parsed;
  } catch (parseError) {
    const message = parseError instanceof Error ? parseError.message : String(parseError);
    logger.warn({ company: entry.slug, error: message }, 'Concept generation JSON parse failed — using fallback');
    return fallback;
  }

  const concepts = (parsed.concepts ?? [])
    .map((item) => ({
      category: (CONCEPT_CATEGORIES.includes(item.category as ConceptCategory)
        ? item.category
        : 'Technical') as ConceptCategory,
      conceptLabel: String(item.conceptLabel || '').trim(),
      specificity: (['company', 'industry', 'mixed'].includes(String(item.specificity))
        ? item.specificity
        : 'mixed') as StarterConceptDraft['specificity'],
    }))
    .filter((item) => item.conceptLabel.length >= 8 && !isBrokenFallbackConceptLabel(item.conceptLabel));

  const mergeDistinctConcepts = (...groups: StarterConceptDraft[][]) => {
    const seen = new Set<string>();
    const merged: StarterConceptDraft[] = [];
    for (const group of groups) {
      for (const item of group) {
        const key = item.conceptLabel.trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        merged.push(item);
      }
    }
    return merged;
  };

  const finalizeConceptDrafts = (drafts: StarterConceptDraft[]) =>
    calibrateConceptSpecificity(
      sanitizeConceptsForGenre(drafts, entry),
      entry,
    );

  const minimumAcceptable = Math.min(minConcepts, target);
  if (concepts.length < minimumAcceptable) {
    const toppedUp = mergeDistinctConcepts(concepts, fallback).slice(0, target);
    logger.warn(
      {
        company: entry.slug,
        received: concepts.length,
        minimumAcceptable,
        toppedUp: toppedUp.length,
      },
      toppedUp.length >= minimumAcceptable
        ? 'AI returned too few concepts — topped up with distinct industry fallback'
        : 'AI returned too few concepts — returning distinct fallback only (no padded duplicates)',
    );
    resetItServicesReplacementPool();
    resetStrategyCasePool();
    const output = toppedUp.length >= minimumAcceptable
      ? toppedUp
      : mergeDistinctConcepts(concepts, fallback);
    return finalizeConceptDrafts(output.slice(0, target));
  }

  resetItServicesReplacementPool();
  resetStrategyCasePool();
  return finalizeConceptDrafts(concepts.slice(0, target));
};

export { isBrokenFallbackConceptLabel } from './conceptGenreDifficulty';

export const generateAndSaveStarterConceptsForCompany = async (input: {
  entry: CompanyCatalogEntry;
  batchId: string;
  createdByUserId?: string;
}) => {
  // SAFETY: auto-archive disabled by default — set CONCEPT_AUTO_ARCHIVE_PRIOR=1 to enable.
  // When enabled, only prior pending_review batches are archived at generation time;
  // active pools are superseded only on approve (see approveConceptsForCompany).
  let archiveReport: PriorBatchArchiveReport = {
    companySlug: input.entry.slug,
    newBatchId: input.batchId,
    archivedCount: 0,
    preservedCount: 0,
    archivedBatchIds: [],
    preservedConceptIds: [],
    preservedConceptLabels: [],
  };

  if (isConceptAutoArchiveAtGenerationEnabled()) {
    archiveReport = await archivePriorStarterConceptsForCompany({
      companySlug: input.entry.slug,
      newBatchId: input.batchId,
      archiveActive: false,
    });
  }

  const drafts = await generateStarterConceptSetForCompany(input.entry);
  const items = drafts.map((draft) => ({
    companySlug: input.entry.slug,
    category: draft.category,
    conceptLabel: draft.conceptLabel,
    tier: input.entry.tier,
    createdBy: 'ai' as const,
    createdByUserId: input.createdByUserId,
    status: 'pending_review' as const,
    batchId: input.batchId,
    genre: input.entry.genre,
    specificity: draft.specificity ?? 'mixed',
  }));

  const created = await bulkCreateConcepts(items);
  return { ...created, archiveReport };
};

const roleCategoryOrder: ConceptCategory[] = ['Technical', 'Culture', 'Coding', 'Behavioral'];

export type RoleCategoryShortfall = {
  category: ConceptCategory;
  expected: number;
  actual: number;
  shortBy: number;
};

export type RoleConceptGenerationResult = {
  drafts: StarterConceptDraft[];
  categoryShortfalls: RoleCategoryShortfall[];
  isPartial: boolean;
  target: number;
};

const buildRoleTestConceptSet = (entry: RoleConceptCatalogEntry, target = 50): StarterConceptDraft[] => {
  const targets = roleCategoryTargets(entry, target);
  const drafts: StarterConceptDraft[] = [];
  let index = 1;
  for (const category of roleCategoryOrder) {
    for (let count = 0; count < targets[category]; count += 1) {
      drafts.push({
        category,
        conceptLabel: `${entry.label} ${category} interview topic ${index}`,
        specificity: 'industry',
      });
      index += 1;
    }
  }
  return drafts;
};

const formatRoleCategoryShortfallMessage = (
  label: string,
  shortfalls: RoleCategoryShortfall[],
) => {
  const parts = shortfalls.map(
    (row) => `${row.category} ${row.actual}/${row.expected} (short by ${row.shortBy})`,
  );
  return `${label}: incomplete generation — ${parts.join('; ')}`;
};

/** Accepts only genuine AI drafts — never pads with templated fallback labels. */
export const finalizeRoleConceptDrafts = (
  aiDrafts: StarterConceptDraft[],
  entry: RoleConceptCatalogEntry,
  target: number,
): Pick<RoleConceptGenerationResult, 'drafts' | 'categoryShortfalls' | 'isPartial'> => {
  const cleanAi = sanitizeRoleConcepts(aiDrafts, { hrOnly: entry.key === 'hr_behavioral' });
  const targets = roleCategoryTargets(entry, target);
  const used = new Set<string>();
  const output: StarterConceptDraft[] = [];
  const categoryShortfalls: RoleCategoryShortfall[] = [];

  for (const category of roleCategoryOrder) {
    const candidates = cleanAi.filter((item) => item.category === category);
    let count = 0;
    for (const candidate of candidates) {
      const key = candidate.conceptLabel.toLowerCase();
      if (used.has(key) || count >= targets[category]) continue;
      used.add(key);
      output.push(candidate);
      count += 1;
    }
    if (count < targets[category]) {
      categoryShortfalls.push({
        category,
        expected: targets[category],
        actual: count,
        shortBy: targets[category] - count,
      });
    }
  }

  return {
    drafts: output,
    categoryShortfalls,
    isPartial: categoryShortfalls.length > 0,
  };
};

export const generateStarterConceptSetForRole = async (
  entry: RoleConceptCatalogEntry,
): Promise<RoleConceptGenerationResult> => {
  const target = 50;
  const apiKey =
    (env.AI_PROVIDER === 'openai' ? env.OPENAI_API_KEY : env.GROQ_API_KEY)
    || process.env.GROQ_API_KEY
    || process.env.OPENAI_API_KEY;
  const useTestFallback =
    process.env.NODE_ENV === 'test' && process.env.FORCE_CONCEPT_AI_IN_TEST !== '1';
  if (!apiKey || useTestFallback) {
    const drafts = buildRoleTestConceptSet(entry, target);
    return { drafts, categoryShortfalls: [], isPartial: false, target };
  }

  const targets = roleCategoryTargets(entry, target);
  const prompt = buildRoleConceptGenerationPrompt({
    entry,
    counts: targets,
    officialHonesty: OFFICIAL_HONESTY,
  });
  const endpoint =
    env.AI_PROVIDER === 'openai'
      ? `${env.OPENAI_BASE_URL.replace(/\/$/, '')}/chat/completions`
      : `${env.GROQ_BASE_URL.replace(/\/$/, '')}/chat/completions`;
  const model = env.AI_PROVIDER === 'openai' ? env.OPENAI_MODEL : env.GROQ_MODEL;
  const aiResult = await fetchConceptGenerationCompletion(endpoint, apiKey, model, prompt, entry.label);
  if (!('ok' in aiResult) || aiResult.ok === false) {
    const status = 'status' in aiResult ? aiResult.status : 0;
    if (status === 429) {
      throw new Error(`AI rate limit exhausted for ${entry.label} after retries — re-queue this role later`);
    }
    throw new Error(
      'error' in aiResult
        ? aiResult.error
        : `AI generation failed for ${entry.label} — no templated fallback applied`,
    );
  }

  try {
    const data = (await aiResult.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '{}') as {
      concepts?: Array<{ category?: string; conceptLabel?: string; specificity?: string }>;
    };
    const aiDrafts = (parsed.concepts ?? [])
      .map((item) => ({
        category: (CONCEPT_CATEGORIES.includes(item.category as ConceptCategory)
          ? item.category
          : 'Technical') as ConceptCategory,
        conceptLabel: String(item.conceptLabel || '').trim(),
        specificity: 'industry' as const,
      }));
    const finalized = finalizeRoleConceptDrafts(aiDrafts, entry, target);
    logger.info(
      {
        role: entry.key,
        received: aiDrafts.length,
        saved: finalized.drafts.length,
        isPartial: finalized.isPartial,
        categoryShortfalls: finalized.categoryShortfalls,
      },
      'Generated role concept set',
    );
    return { ...finalized, target };
  } catch (error) {
    if (error instanceof Error && error.message.includes('incomplete generation')) {
      throw error;
    }
    throw new Error(
      `Role concept JSON parse failed for ${entry.label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

const roleConceptApiConfig = () => {
  const apiKey =
    (env.AI_PROVIDER === 'openai' ? env.OPENAI_API_KEY : env.GROQ_API_KEY)
    || process.env.GROQ_API_KEY
    || process.env.OPENAI_API_KEY;
  const endpoint =
    env.AI_PROVIDER === 'openai'
      ? `${env.OPENAI_BASE_URL.replace(/\/$/, '')}/chat/completions`
      : `${env.GROQ_BASE_URL.replace(/\/$/, '')}/chat/completions`;
  const model = env.AI_PROVIDER === 'openai' ? env.OPENAI_MODEL : env.GROQ_MODEL;
  return { apiKey, endpoint, model };
};

const parseRoleConceptAiDrafts = (
  raw: Array<{ category?: string; conceptLabel?: string; specificity?: string }>,
  entry: RoleConceptCatalogEntry,
) =>
  sanitizeRoleConcepts(
    raw
      .map((item) => ({
        category: (CONCEPT_CATEGORIES.includes(item.category as ConceptCategory)
          ? item.category
          : 'Technical') as ConceptCategory,
        conceptLabel: String(item.conceptLabel || '').trim(),
        specificity: 'industry' as const,
      }))
      .filter((item) =>
        item.conceptLabel.length >= 8
        && !isBrokenFallbackConceptLabel(item.conceptLabel)
        && !isTemplatedRoleFallbackLabel(item.conceptLabel),
      ),
    { hrOnly: entry.key === 'hr_behavioral' },
  );

/** AI-only role section generation — never pads with buildRoleFallbackConceptSet. */
export const generateRoleConceptSectionsViaAi = async (
  entry: RoleConceptCatalogEntry,
  counts: Partial<Record<ConceptCategory, number>>,
): Promise<StarterConceptDraft[]> => {
  const needed = Object.fromEntries(
    (['Technical', 'Culture', 'Coding', 'Behavioral'] as ConceptCategory[]).map((category) => [
      category,
      Math.max(0, Number(counts[category] ?? 0)),
    ]),
  ) as Record<ConceptCategory, number>;
  const total = Object.values(needed).reduce((sum, value) => sum + value, 0);
  if (total === 0) return [];

  const { apiKey, endpoint, model } = roleConceptApiConfig();
  if (!apiKey) {
    throw new Error('No AI API key configured for role concept regeneration');
  }

  const buildPrompt = (continuationNote?: string) => buildRoleConceptGenerationPrompt({
    entry,
    counts: needed,
    officialHonesty: OFFICIAL_HONESTY,
    continuationNote,
  });

  const prompt = buildPrompt();

  const maxRounds = Number(process.env.CONCEPT_SECTION_REGEN_ROUNDS || 3);
  const collected: StarterConceptDraft[] = [];
  const used = new Set<string>();

  for (let round = 1; round <= maxRounds; round += 1) {
    const remaining = Object.fromEntries(
      (['Technical', 'Culture', 'Coding', 'Behavioral'] as ConceptCategory[]).map((category) => [
        category,
        Math.max(0, needed[category] - collected.filter((item) => item.category === category).length),
      ]),
    ) as Record<ConceptCategory, number>;
    const remainingTotal = Object.values(remaining).reduce((sum, value) => sum + value, 0);
    if (remainingTotal === 0) break;

    const roundPrompt = round === 1
      ? prompt
      : buildPrompt(
        `You already provided ${collected.length} concepts. Generate ${remainingTotal} MORE distinct concepts with these remaining counts: ${(['Technical', 'Culture', 'Coding', 'Behavioral'] as ConceptCategory[])
          .filter((category) => remaining[category] > 0)
          .map((category) => `${category} ${remaining[category]}`)
          .join(', ')}. Do not repeat prior concepts.`,
      );

    const aiResult = await fetchConceptGenerationCompletion(endpoint, apiKey, model, roundPrompt, entry.label);
    if (!('ok' in aiResult) || aiResult.ok === false) {
      const status = 'status' in aiResult ? aiResult.status : 0;
      if (status === 429) {
        throw new Error(`AI rate limit exhausted for ${entry.label} section regeneration`);
      }
      throw new Error('error' in aiResult ? aiResult.error : `AI generation failed for ${entry.label}`);
    }

    const data = (await aiResult.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '{}') as {
      concepts?: Array<{ category?: string; conceptLabel?: string; specificity?: string }>;
    };
    const drafts = parseRoleConceptAiDrafts(parsed.concepts ?? [], entry);
    for (const draft of drafts) {
      const key = draft.conceptLabel.toLowerCase();
      if (used.has(key)) continue;
      const catCount = collected.filter((item) => item.category === draft.category).length;
      if (catCount >= needed[draft.category]) continue;
      used.add(key);
      collected.push(draft);
    }
  }

  for (const category of ['Technical', 'Culture', 'Coding', 'Behavioral'] as ConceptCategory[]) {
    const have = collected.filter((item) => item.category === category).length;
    if (have < needed[category]) {
      throw new Error(
        `AI returned insufficient ${category} concepts for ${entry.label} (${have}/${needed[category]}) — no fallback padding applied`,
      );
    }
  }

  return collected.slice(0, total);
};

export type RoleSectionRegenerationPlan = {
  role: RoleConceptKey;
  /** Categories to replace templated rows in. Ignored when fullRegenerate is true. */
  categories?: ConceptCategory[];
  fullRegenerate?: boolean;
};

export const regenerateRoleConceptSections = async (input: {
  plan: RoleSectionRegenerationPlan;
  batchId: string;
  createdByUserId?: string;
}) => {
  const entry = getRoleConceptEntry(input.plan.role);
  if (!entry) throw new Error(`Unknown role: ${input.plan.role}`);

  const targets = roleCategoryTargets(entry, 50);
  const allCategories: ConceptCategory[] = ['Technical', 'Culture', 'Coding', 'Behavioral'];
  const categoriesToTouch = input.plan.fullRegenerate
    ? allCategories
    : (input.plan.categories?.length ? input.plan.categories : allCategories);

  const pending = await QuestionConcept.find({ role: entry.key, status: 'pending_review' }).lean();
  const kept: StarterConceptDraft[] = [];
  const keptRowIds: string[] = [];
  const discardIds: string[] = [];

  if (input.plan.fullRegenerate) {
    for (const row of pending) {
      if (isManuallyEditedConcept(row)) {
        kept.push({
          category: row.category as ConceptCategory,
          conceptLabel: String(row.conceptLabel),
          specificity: 'industry',
        });
        keptRowIds.push(String(row._id));
        continue;
      }
      discardIds.push(String(row._id));
    }
  } else {
    for (const row of pending) {
      const category = row.category as ConceptCategory;
      const label = String(row.conceptLabel);
      const templated = isTemplatedRoleFallbackLabel(label);
      const touchCategory = categoriesToTouch.includes(category);

      if (!touchCategory) {
        kept.push({ category, conceptLabel: label, specificity: 'industry' });
        keptRowIds.push(String(row._id));
        continue;
      }

      if (templated && !isManuallyEditedConcept(row)) {
        discardIds.push(String(row._id));
        continue;
      }

      kept.push({ category, conceptLabel: label, specificity: 'industry' });
      keptRowIds.push(String(row._id));
    }
  }

  const needed: Partial<Record<ConceptCategory, number>> = {};
  for (const category of allCategories) {
    const keptCount = kept.filter((item) => item.category === category).length;
    if (input.plan.fullRegenerate || categoriesToTouch.includes(category)) {
      needed[category] = Math.max(0, targets[category] - keptCount);
    }
  }

  const generated = await generateRoleConceptSectionsViaAi(entry, needed);

  if (discardIds.length) {
    await QuestionConcept.updateMany(
      { _id: { $in: discardIds } },
      { $set: { status: 'discarded' } },
    );
  }

  const items = generated.map((draft) => ({
    role: entry.key,
    category: draft.category,
    conceptLabel: draft.conceptLabel,
    tier: 'medium' as const,
    createdBy: 'ai' as const,
    createdByUserId: input.createdByUserId,
    status: 'pending_review' as const,
    batchId: input.batchId,
    genre: 'role',
    specificity: draft.specificity ?? 'industry',
  }));

  const created = items.length ? await bulkCreateConcepts(items) : { created: [], count: 0 };

  if (keptRowIds.length) {
    await QuestionConcept.updateMany(
      { _id: { $in: keptRowIds } },
      { $set: { batchId: input.batchId } },
    );
  }

  const pendingAfter = await QuestionConcept.find({ role: entry.key, status: 'pending_review' }).lean();
  for (const category of allCategories) {
    const count = pendingAfter.filter((row) => row.category === category).length;
    if (count !== targets[category]) {
      throw new Error(
        `Post-regeneration count mismatch for ${entry.key} ${category}: expected ${targets[category]}, got ${count}`,
      );
    }
  }

  const templatedRemaining = pendingAfter.filter((row) =>
    isTemplatedRoleFallbackLabel(String(row.conceptLabel)),
  ).length;

  return {
    role: entry.key,
    discarded: discardIds.length,
    kept: kept.length,
    generated: generated.length,
    templatedRemaining,
    created,
  };
};

export const generateAndSaveStarterConceptsForRole = async (input: {
  entry: RoleConceptCatalogEntry;
  batchId: string;
  createdByUserId?: string;
}) => {
  const archiveReport = await archivePriorStarterConceptsForRole({
    role: input.entry.key,
    newBatchId: input.batchId,
  });
  const generation = await generateStarterConceptSetForRole(input.entry);
  const items = generation.drafts.map((draft) => ({
    role: input.entry.key,
    category: draft.category,
    conceptLabel: draft.conceptLabel,
    tier: 'medium' as const,
    createdBy: 'ai' as const,
    createdByUserId: input.createdByUserId,
    status: 'pending_review' as const,
    batchId: input.batchId,
    genre: 'role',
    specificity: draft.specificity ?? 'industry',
  }));
  const created = items.length
    ? await bulkCreateConcepts(items)
    : { created: [], count: 0 };
  return {
    ...created,
    archiveReport,
    isPartial: generation.isPartial,
    categoryShortfalls: generation.categoryShortfalls,
    target: generation.target,
    generatedCount: generation.drafts.length,
  };
};

export const markBatchProgress = async (input: {
  batchId: string;
  companySlug?: string;
  companyLabel?: string;
  role?: RoleConceptKey;
  targetLabel?: string;
  success: boolean;
  error?: string;
  categoryShortfalls?: RoleCategoryShortfall[];
}) => {
  if (!mongoose.Types.ObjectId.isValid(input.batchId)) return null;
  const batch = await ConceptGenerationBatch.findById(input.batchId);
  if (!batch || batch.status === 'cancelled') return null;

  const scopeKey = input.role ?? input.companySlug ?? 'unknown';
  const scopeLabel = input.companyLabel ?? input.targetLabel ?? input.role ?? 'Unknown target';

  if (input.categoryShortfalls?.length) {
    batch.partialTargets = batch.partialTargets ?? [];
    batch.partialTargets.push({
      companySlug: scopeKey,
      companyLabel: scopeLabel,
      categoryShortfalls: input.categoryShortfalls.map((row) => ({
        category: row.category,
        expected: row.expected,
        actual: row.actual,
        shortBy: row.shortBy,
      })),
      message: formatRoleCategoryShortfallMessage(scopeLabel, input.categoryShortfalls),
    });
    batch.completedCompanies += 1;
  } else if (input.success) {
    batch.completedCompanies += 1;
  } else {
    batch.failedCompanies.push({
      companySlug: scopeKey,
      companyLabel: scopeLabel,
      error: input.error ?? 'Unknown error',
    });
  }
  await batch.save();
  return batch;
};

export const getReviewQueueGrouped = async (options: { batchId?: string; genre?: string; role?: string } = {}) => {
  const filter: Record<string, unknown> = { status: 'pending_review' };
  if (options.batchId && mongoose.Types.ObjectId.isValid(options.batchId)) {
    filter.batchId = options.batchId;
  }
  if (options.genre?.trim()) filter.genre = options.genre.trim();
  if (options.role?.trim()) filter.role = options.role.trim();

  const rows = await QuestionConcept.find(filter).sort({ role: 1, companySlug: 1, category: 1 }).lean();
  const grouped = new Map<string, {
    companySlug?: string;
    role?: RoleConceptKey;
    genre?: string;
    tier?: ConceptTier;
    batchId?: string;
    concepts: ConceptRecord[];
    preservedManualEdits: ConceptRecord[];
  }>();

  rows.forEach((row) => {
    const concept = serializeConcept(row as unknown as IQuestionConcept);
    const key = `${concept.role ?? concept.companySlug ?? 'unknown'}:${concept.batchId ?? 'none'}`;
    const existing = grouped.get(key) ?? {
      companySlug: concept.companySlug,
      role: concept.role,
      genre: concept.genre,
      tier: concept.tier,
      batchId: concept.batchId,
      concepts: [],
      preservedManualEdits: [] as ConceptRecord[],
    };
    existing.concepts.push(concept);
    grouped.set(key, existing);
  });

  for (const group of grouped.values()) {
    const scopeFilter = group.role ? { role: group.role } : { companySlug: group.companySlug };
    const preservedRows = await QuestionConcept.find({
      ...scopeFilter,
      status: 'active',
      $or: [
        { manuallyEditedAt: { $exists: true, $ne: null } },
        { createdBy: 'admin' },
      ],
    }).lean();
    group.preservedManualEdits = preservedRows
      .filter((row) => isManuallyEditedConcept(row))
      .map((row) => serializeConcept(row as unknown as IQuestionConcept));
  }

  const batchIds = [...new Set(
    [...grouped.values()]
      .map((group) => group.batchId)
      .filter((batchId): batchId is string => Boolean(batchId && mongoose.Types.ObjectId.isValid(batchId))),
  )];
  const batchRows = batchIds.length
    ? await ConceptGenerationBatch.find({ _id: { $in: batchIds } }).lean()
    : [];
  const partialByScope = new Map<string, {
    categoryShortfalls: RoleCategoryShortfall[];
    message: string;
    expectedConceptCount?: number;
  }>();
  for (const batch of batchRows) {
    for (const partial of batch.partialTargets ?? []) {
      partialByScope.set(`${partial.companySlug}:${String(batch._id)}`, {
        categoryShortfalls: partial.categoryShortfalls.map((row) => ({
          category: row.category as ConceptCategory,
          expected: row.expected,
          actual: row.actual,
          shortBy: row.shortBy,
        })),
        message: partial.message,
      });
    }
  }

  const roleKeys = [...new Set(
    rows.map((row) => row.role).filter((role): role is RoleConceptKey => Boolean(role)),
  )];
  const roleApprovalBlockReasonByRole = new Map<RoleConceptKey, string | null>();
  await Promise.all(roleKeys.map(async (role) => {
    roleApprovalBlockReasonByRole.set(role, await getRoleConceptApprovalBlockReason(role));
  }));

  const enrichedGroups = [...grouped.values()].map((group) => {
    const partialKey = `${group.role ?? group.companySlug ?? 'unknown'}:${group.batchId ?? 'none'}`;
    const partial = partialByScope.get(partialKey);
    const roleEntry = group.role ? getRoleConceptEntry(group.role) : undefined;
    const expectedConceptCount = roleEntry ? 50 : undefined;
    const rolePending = group.role
      ? rows.filter((row) => row.role === group.role)
      : [];
    const roleBatchIds = new Set(
      rolePending.map((row) => String(row.batchId || '')).filter(Boolean),
    );
    const roleApprovalBlockReason = group.role
      ? roleApprovalBlockReasonByRole.get(group.role) ?? null
      : null;
    const roleApprovalBlocked = Boolean(group.role && roleApprovalBlockReason);
    return {
      ...group,
      isPartialGeneration: Boolean(partial),
      categoryShortfalls: partial?.categoryShortfalls ?? [],
      partialMessage: partial?.message,
      expectedConceptCount,
      actualConceptCount: group.concepts.length,
      rolePendingCount: rolePending.length,
      roleHasSplitBatches: roleBatchIds.size > 1,
      roleApprovalBlocked,
      roleApprovalBlockReason,
    };
  });

  return {
    groups: enrichedGroups.sort((left, right) =>
      (left.role ?? left.companySlug ?? '').localeCompare(right.role ?? right.companySlug ?? '')),
    totalPending: rows.length,
  };
};

export const getRoleConceptApprovalBlockReason = async (role: RoleConceptKey) => {
  const entry = getRoleConceptEntry(role);
  if (!entry) return 'Unknown role';
  const targets = roleCategoryTargets(entry, 50);
  const pending = await QuestionConcept.find({ role, status: 'pending_review' }).lean();
  if (!pending.length) return 'No pending concepts to approve';

  const batchIds = new Set(pending.map((row) => String(row.batchId || '')).filter(Boolean));
  if (batchIds.size > 1) {
    return `Concepts are split across ${batchIds.size} generation batches — consolidate before approving.`;
  }
  if (pending.length !== 50) {
    return `Expected 50 pending concepts, found ${pending.length}.`;
  }
  const templated = pending.filter((row) => isTemplatedRoleFallbackLabel(String(row.conceptLabel))).length;
  if (templated > 0) {
    return `${templated} concept(s) still use templated fallback padding.`;
  }
  for (const category of roleCategoryOrder) {
    const count = pending.filter((row) => row.category === category).length;
    if (count !== targets[category]) {
      return `${category} has ${count}/${targets[category]} concepts.`;
    }
  }
  return null;
};

const assertRoleConceptPoolReadyForApproval = async (role: RoleConceptKey) => {
  const reason = await getRoleConceptApprovalBlockReason(role);
  if (reason) {
    const entry = getRoleConceptEntry(role);
    throw new AppError(
      `Cannot approve ${entry?.label ?? role}: ${reason}`,
      400,
      'ROLE_APPROVAL_BLOCKED',
    );
  }
};

const approveConceptsInScope = async (input: {
  companySlug?: string;
  role?: RoleConceptKey;
  batchId?: string;
  conceptIds?: string[];
}) => {
  const filter: Record<string, unknown> = {
    status: 'pending_review',
  };
  if (input.role) filter.role = input.role;
  else if (input.companySlug) filter.companySlug = slugifyCompanyName(input.companySlug);
  else throw new Error('Approve scope requires companySlug or role');
  if (input.role) {
    await assertRoleConceptPoolReadyForApproval(input.role);
  }
  if (input.batchId && mongoose.Types.ObjectId.isValid(input.batchId)) {
    filter.batchId = input.batchId;
  }
  if (input.conceptIds?.length) {
    filter._id = { $in: input.conceptIds.filter((id) => mongoose.Types.ObjectId.isValid(id)) };
  }

  const pendingRows = await QuestionConcept.find(filter).select('_id').lean();
  const approvedIds = pendingRows.map((row) => row._id);

  const result = await QuestionConcept.updateMany(filter, { $set: { status: 'active' } });

  const otherActive = await QuestionConcept.find({
    ...(input.role ? { role: input.role } : { companySlug: slugifyCompanyName(input.companySlug!) }),
    status: 'active',
    _id: { $nin: approvedIds },
  }).lean();

  const supersededIds = otherActive
    .filter((row) => !isManuallyEditedConcept(row))
    .map((row) => row._id);

  if (supersededIds.length) {
    await QuestionConcept.updateMany(
      { _id: { $in: supersededIds } },
      { $set: { status: 'archived' } },
    );
    logger.info(
      {
        companySlug: input.companySlug,
        role: input.role,
        batchId: input.batchId,
        supersededArchivedCount: supersededIds.length,
      },
      'Archived superseded active concepts when approving new starter batch',
    );
  }

  return {
    approvedCount: result.modifiedCount ?? 0,
    supersededArchivedCount: supersededIds.length,
  };
};

export const approveConceptsForCompany = async (input: {
  companySlug: string;
  batchId?: string;
  conceptIds?: string[];
}) => approveConceptsInScope(input);

export const approveConceptsForRole = async (input: {
  role: RoleConceptKey;
  batchId?: string;
  conceptIds?: string[];
}) => approveConceptsInScope(input);

export const discardConcepts = async (input: {
  companySlug?: string;
  role?: RoleConceptKey;
  batchId?: string;
  conceptIds?: string[];
}) => {
  const filter: Record<string, unknown> = { status: 'pending_review' };
  if (input.role) filter.role = input.role;
  else if (input.companySlug) filter.companySlug = slugifyCompanyName(input.companySlug);
  if (input.batchId && mongoose.Types.ObjectId.isValid(input.batchId)) filter.batchId = input.batchId;
  if (input.conceptIds?.length) {
    filter._id = { $in: input.conceptIds.filter((id) => mongoose.Types.ObjectId.isValid(id)) };
  }

  const result = await QuestionConcept.updateMany(filter, { $set: { status: 'discarded' } });
  return { discardedCount: result.modifiedCount ?? 0 };
};

/** Fix advanced Coding (and select Technical) concepts for IT Services/Consulting genre. */
export const fixItServicesConsultingConceptRecords = async () => {
  const rows = await QuestionConcept.find({
    genre: 'it_services',
    category: { $in: ['Coding', 'Technical'] },
    status: { $in: ['active', 'pending_review'] },
  });

  const fixes: Array<{ id: string; from: string; to: string; companySlug: string }> = [];

  for (const row of rows) {
    const companySlug = row.companySlug;
    if (!companySlug) continue;
    const entry = getCatalogEntry(companySlug) ?? {
      slug: companySlug,
      label: companySlug,
      genre: 'it_services' as const,
      tier: row.tier,
      tierIsGuess: false,
    };

    const explicit = row.category === 'Coding'
      ? lookupItServicesCodingReplacement(row.conceptLabel)
      : null;
    const needsFix = explicit
      || (row.category === 'Coding' && isAdvancedItServicesCodingConcept(row.conceptLabel));

    if (!needsFix) continue;

    resetItServicesReplacementPool();
    const [sanitized] = sanitizeConceptsForGenre(
      [{ category: row.category as ConceptCategory, conceptLabel: row.conceptLabel }],
      entry,
    );

    if (sanitized.conceptLabel === row.conceptLabel) continue;

    await QuestionConcept.findByIdAndUpdate(row._id, {
      $set: { conceptLabel: sanitized.conceptLabel },
    });

    fixes.push({
      id: String(row._id),
      companySlug,
      from: row.conceptLabel,
      to: sanitized.conceptLabel,
    });
  }

  return { fixedCount: fixes.length, fixes };
};

export { CONCEPT_CATEGORIES, CONCEPT_TIERS, TIER_POOL_GUIDANCE };
