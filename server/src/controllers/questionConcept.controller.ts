import { z } from 'zod';
import mongoose from 'mongoose';
import { CONCEPT_CATEGORIES, CONCEPT_TIERS } from '../models/QuestionConcept';
import { ROLE_CONCEPT_KEYS } from '../data/roleConceptCatalog';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { slugifyCompanyName } from '../services/companyQuestionBank';
import {
  archiveConceptRecord,
  approveConceptsForCompany,
  approveConceptsForRole,
  bulkCreateConcepts,
  createConceptRecord,
  deleteConceptRecord,
  discardConcepts,
  generateConceptLabelCandidates,
  getCompanyPoolSummaries,
  getConceptById,
  getReviewQueueGrouped,
  listConcepts,
  updateConceptRecord,
} from '../services/questionConcept.service';
import {
  createConceptGenerationBatch,
  getConceptGenerationBatch,
  listConceptGenerationBatches,
  cancelConceptGenerationBatch,
} from '../services/conceptGenerationQueue.service';
import {
  restoreApprovedPilotConcepts,
} from '../services/approvedPilotConceptRestore.service';
import { getCatalogCompanies, COMPANY_CATALOG, GENRE_LABELS } from '../data/companyConceptCatalog';

const categoryEnum = z.enum(CONCEPT_CATEGORIES as unknown as [string, ...string[]]);
const tierEnum = z.enum(CONCEPT_TIERS as unknown as [string, ...string[]]);
const roleEnum = z.enum(ROLE_CONCEPT_KEYS as unknown as [string, ...string[]]);

export const listConceptsQuerySchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    search: z.string().optional(),
    companySlug: z.string().optional(),
    role: roleEnum.optional(),
    category: z.string().optional(),
    tier: z.string().optional(),
    status: z.enum(['active', 'archived', 'pending_review', 'discarded', 'all']).optional(),
  }),
});

export const conceptIdSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
});

export const createConceptSchema = z.object({
  body: z.object({
    companySlug: z.string().trim().min(1).max(160).optional(),
    role: roleEnum.optional(),
    category: categoryEnum,
    conceptLabel: z.string().trim().min(8).max(500),
    tier: tierEnum,
  }).refine((body) => Boolean(body.companySlug || body.role), { message: 'companySlug or role is required' }),
});

export const updateConceptSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    conceptLabel: z.string().trim().min(8).max(500).optional(),
    category: categoryEnum.optional(),
    tier: tierEnum.optional(),
    status: z.enum(['active', 'archived', 'pending_review', 'discarded']).optional(),
  }),
});

export const generateConceptsSchema = z.object({
  body: z.object({
    companyLabel: z.string().trim().min(1).max(160),
    companySlug: z.string().trim().min(1).max(160).optional(),
    tier: tierEnum,
    roleTopic: z.string().trim().min(2).max(200),
    categories: z.array(categoryEnum).min(1).max(4).optional(),
    count: z.coerce.number().int().min(1).max(30),
  }),
});

export const bulkCreateConceptsSchema = z.object({
  body: z.object({
    concepts: z.array(z.object({
      companySlug: z.string().trim().min(1).max(160).optional(),
      role: roleEnum.optional(),
      category: categoryEnum,
      conceptLabel: z.string().trim().min(8).max(500),
      tier: tierEnum,
      createdBy: z.enum(['admin', 'ai']).optional(),
    })).min(1).max(50),
  }).refine((body) => body.concepts.every((concept) => Boolean(concept.companySlug || concept.role)), { message: 'Each concept needs companySlug or role' }),
});

export const listConceptsHandler = asyncHandler(async (req, res) => {
  const payload = await listConcepts({
    page: Number.parseInt(String(req.query.page || '1'), 10) || 1,
    limit: Number.parseInt(String(req.query.limit || '25'), 10) || 25,
    search: String(req.query.search || ''),
    companySlug: String(req.query.companySlug || ''),
    role: String(req.query.role || ''),
    category: String(req.query.category || 'all'),
    tier: String(req.query.tier || 'all'),
    status: (String(req.query.status || 'active') as 'active' | 'archived' | 'pending_review' | 'discarded' | 'all'),
  });
  res.json(payload);
});

export const getConceptHandler = asyncHandler(async (req, res) => {
  const row = await getConceptById(String(req.params.id));
  if (!row) throw new AppError('Concept not found', 404, 'CONCEPT_NOT_FOUND');
  res.json(row);
});

export const createConceptHandler = asyncHandler(async (req, res) => {
  const created = await createConceptRecord({
    ...req.body,
    createdBy: 'admin',
    createdByUserId: String(req.user!._id),
  });
  res.status(201).json({ concept: created });
});

export const updateConceptHandler = asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError('Invalid concept id', 400, 'INVALID_CONCEPT_ID');
  }
  const updated = await updateConceptRecord(id, req.body);
  if (!updated) throw new AppError('Concept not found', 404, 'CONCEPT_NOT_FOUND');
  res.json({ concept: updated });
});

export const archiveConceptHandler = asyncHandler(async (req, res) => {
  const archived = await archiveConceptRecord(String(req.params.id));
  if (!archived) throw new AppError('Concept not found', 404, 'CONCEPT_NOT_FOUND');
  res.json({ concept: archived });
});

export const deleteConceptHandler = asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError('Invalid concept id', 400, 'INVALID_CONCEPT_ID');
  }
  const deleted = await deleteConceptRecord(id);
  if (!deleted) throw new AppError('Concept not found', 404, 'CONCEPT_NOT_FOUND');
  res.json({ deleted: true, id });
});

export const generateConceptsHandler = asyncHandler(async (req, res) => {
  const companySlug = slugifyCompanyName(req.body.companySlug || req.body.companyLabel);
  const categories = req.body.categories?.length
    ? req.body.categories
    : [...CONCEPT_CATEGORIES];
  const preview = await generateConceptLabelCandidates({
    companyLabel: req.body.companyLabel,
    companySlug,
    tier: req.body.tier,
    roleTopic: req.body.roleTopic,
    categories,
    count: req.body.count,
  });
  res.json({ concepts: preview });
});

export const bulkCreateConceptsHandler = asyncHandler(async (req, res) => {
  const items = req.body.concepts.map((item: Record<string, unknown>) => ({
    companySlug: item.companySlug ? String(item.companySlug) : undefined,
    role: item.role as any,
    category: item.category,
    conceptLabel: String(item.conceptLabel),
    tier: item.tier,
    createdBy: (item.createdBy === 'ai' ? 'ai' : 'admin') as 'admin' | 'ai',
    createdByUserId: String(req.user!._id),
  }));
  const result = await bulkCreateConcepts(items);
  res.status(201).json(result);
});

export const companyPoolSummariesHandler = asyncHandler(async (_req, res) => {
  const summaries = await getCompanyPoolSummaries();
  res.json({ summaries });
});

export const listCompanyCatalogHandler = asyncHandler(async (_req, res) => {
  res.json({
    genres: GENRE_LABELS,
    companies: COMPANY_CATALOG.slice(0, 100).map((entry) => ({
      ...entry,
      genreLabel: GENRE_LABELS[entry.genre],
    })),
    totalCatalog: COMPANY_CATALOG.length,
    roles: ROLE_CONCEPT_KEYS,
  });
});

export const startGenerationBatchSchema = z.object({
  body: z.object({
    scope: z.enum(['pilot', 'full', 'custom']),
    companySlugs: z.array(z.string().trim().min(1)).optional(),
    targetType: z.enum(['company', 'role']).optional(),
    roleKeys: z.array(roleEnum).optional(),
  }),
});

export const batchIdParamSchema = z.object({
  params: z.object({ batchId: z.string().min(1) }),
});

export const startGenerationBatchHandler = asyncHandler(async (req, res) => {
  const batch = await createConceptGenerationBatch({
    scope: req.body.scope,
    slugs: req.body.companySlugs,
    targetType: req.body.targetType,
    roleKeys: req.body.roleKeys,
    createdByUserId: String(req.user!._id),
  });
  res.status(202).json({ batch });
});

export const getGenerationBatchHandler = asyncHandler(async (req, res) => {
  const batch = await getConceptGenerationBatch(String(req.params.batchId));
  if (!batch) throw new AppError('Generation batch not found', 404, 'BATCH_NOT_FOUND');
  res.json({ batch });
});

export const listGenerationBatchesHandler = asyncHandler(async (_req, res) => {
  const batches = await listConceptGenerationBatches();
  res.json({ batches });
});

export const cancelGenerationBatchHandler = asyncHandler(async (req, res) => {
  const batch = await cancelConceptGenerationBatch(String(req.params.batchId));
  if (!batch) throw new AppError('Generation batch not found', 404, 'BATCH_NOT_FOUND');
  res.json({ batch });
});

export const reviewQueueQuerySchema = z.object({
  query: z.object({
    batchId: z.string().optional(),
    genre: z.string().optional(),
    role: roleEnum.optional(),
  }),
});

export const reviewQueueHandler = asyncHandler(async (req, res) => {
  const payload = await getReviewQueueGrouped({
    batchId: String(req.query.batchId || ''),
    genre: String(req.query.genre || ''),
    role: String(req.query.role || ''),
  });
  res.json(payload);
});

export const approveConceptsSchema = z.object({
  body: z.object({
    companySlug: z.string().trim().min(1).optional(),
    role: roleEnum.optional(),
    batchId: z.string().optional(),
    conceptIds: z.array(z.string()).optional(),
  }).refine((body) => Boolean(body.companySlug || body.role), { message: 'companySlug or role is required' }),
});

export const discardConceptsSchema = z.object({
  body: z.object({
    companySlug: z.string().trim().optional(),
    role: roleEnum.optional(),
    batchId: z.string().optional(),
    conceptIds: z.array(z.string()).optional(),
  }),
});

export const approveConceptsHandler = asyncHandler(async (req, res) => {
  const result = req.body.role
    ? await approveConceptsForRole(req.body)
    : await approveConceptsForCompany(req.body);
  res.json(result);
});

export const discardConceptsHandler = asyncHandler(async (req, res) => {
  const result = await discardConcepts(req.body);
  res.json(result);
});

export const restoreApprovedPilotPreviewHandler = asyncHandler(async (_req, res) => {
  const report = await restoreApprovedPilotConcepts(false);
  res.json({ report });
});

export const restoreApprovedPilotSchema = z.object({
  body: z.object({
    confirm: z.literal(true),
  }),
});

export const restoreApprovedPilotHandler = asyncHandler(async (req, res) => {
  if (req.body.confirm !== true) {
    throw new AppError('Confirmation required', 400, 'RESTORE_CONFIRM_REQUIRED');
  }
  const report = await restoreApprovedPilotConcepts(true);
  res.json({ report });
});
