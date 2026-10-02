import crypto from 'crypto';
import mongoose from 'mongoose';

import { AiContextCache, type AiContextCacheKind } from '../models/AiContextCache';

const DEFAULT_TTL_MS: Record<AiContextCacheKind, number> = {
  resume_analysis: 30 * 24 * 60 * 60 * 1000,
  job_description_profile: 14 * 24 * 60 * 60 * 1000,
  company_question_bank: 7 * 24 * 60 * 60 * 1000,
};

export const normalizeContentHash = (content: string) =>
  crypto.createHash('sha256').update(String(content || '').trim().replace(/\s+/g, ' ').toLowerCase()).digest('hex');

export const buildResumeAnalysisCacheKey = (userId: string, contentHash: string) =>
  `resume_analysis:${userId}:${contentHash}`;

export const buildJobDescriptionCacheKey = (contentHash: string) =>
  `job_description_profile:${contentHash}`;

export const buildCompanyQuestionBankCacheKey = (input: {
  companySlug: string;
  role: string;
  bankVersion: string;
}) => `company_question_bank:${input.companySlug}:${input.role}:${input.bankVersion}`;

export const getAiContextCache = async <T>(cacheKey: string) => {
  const row = await AiContextCache.findOne({ cacheKey, expiresAt: { $gt: new Date() } }).lean();
  if (!row) return null;
  return row.payload as T;
};

export const setAiContextCache = async (input: {
  cacheKey: string;
  kind: AiContextCacheKind;
  contentHash: string;
  payload: Record<string, unknown>;
  userId?: string;
  companySlug?: string;
  role?: string;
  bankVersion?: string;
  ttlMs?: number;
}) => {
  const expiresAt = new Date(Date.now() + (input.ttlMs ?? DEFAULT_TTL_MS[input.kind]));
  await AiContextCache.findOneAndUpdate(
    { cacheKey: input.cacheKey },
    {
      cacheKey: input.cacheKey,
      kind: input.kind,
      contentHash: input.contentHash,
      payload: input.payload,
      userId: input.userId && mongoose.Types.ObjectId.isValid(input.userId)
        ? new mongoose.Types.ObjectId(input.userId)
        : undefined,
      companySlug: input.companySlug,
      role: input.role,
      bankVersion: input.bankVersion,
      expiresAt,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
};

export const invalidateAiContextCacheByHash = async (kind: AiContextCacheKind, contentHash: string) => {
  await AiContextCache.deleteMany({ kind, contentHash });
};
