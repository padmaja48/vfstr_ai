import mongoose from 'mongoose';

import { connectDatabase, disconnectDatabase } from '../config/database';
import { AiContextCache } from '../models/AiContextCache';
import {
  buildJobDescriptionCacheKey,
  buildResumeAnalysisCacheKey,
  getAiContextCache,
  invalidateAiContextCacheByHash,
  normalizeContentHash,
  setAiContextCache,
} from '../services/aiContextCache.service';

describe('aiContextCache', () => {
  const userA = new mongoose.Types.ObjectId().toString();
  const userB = new mongoose.Types.ObjectId().toString();

  beforeAll(async () => {
    await connectDatabase();
  });

  afterAll(async () => {
    await AiContextCache.deleteMany({});
    await disconnectDatabase();
  });

  afterEach(async () => {
    await AiContextCache.deleteMany({});
  });

  it('isolates resume analysis per user and invalidates on content change', async () => {
    const resumeV1 = 'Jane Doe — React, Node.js, PostgreSQL';
    const resumeV2 = 'Jane Doe — React, Node.js, PostgreSQL, Kubernetes';
    const hashV1 = normalizeContentHash(resumeV1);
    const hashV2 = normalizeContentHash(resumeV2);

    await setAiContextCache({
      cacheKey: buildResumeAnalysisCacheKey(userA, hashV1),
      kind: 'resume_analysis',
      contentHash: hashV1,
      userId: userA,
      payload: { summary: 'User A v1', skills: ['React'] },
    });
    await setAiContextCache({
      cacheKey: buildResumeAnalysisCacheKey(userB, hashV1),
      kind: 'resume_analysis',
      contentHash: hashV1,
      userId: userB,
      payload: { summary: 'User B v1', skills: ['React'] },
    });

    const userAHit = await getAiContextCache<{ summary: string }>(buildResumeAnalysisCacheKey(userA, hashV1));
    const userBMiss = await getAiContextCache<{ summary: string }>(buildResumeAnalysisCacheKey(userA, hashV2));

    expect(userAHit?.summary).toBe('User A v1');
    expect(userBMiss).toBeNull();

    await invalidateAiContextCacheByHash('resume_analysis', hashV1);
    const afterInvalidate = await getAiContextCache(buildResumeAnalysisCacheKey(userA, hashV1));
    expect(afterInvalidate).toBeNull();
  });

  it('caches job-description profiles by normalized content hash', async () => {
    const jd = 'Backend engineer with Python, AWS, and PostgreSQL.';
    const hash = normalizeContentHash(jd);
    const cacheKey = buildJobDescriptionCacheKey(hash);

    await setAiContextCache({
      cacheKey,
      kind: 'job_description_profile',
      contentHash: hash,
      payload: { requiredSkills: ['Python', 'AWS'] },
    });

    const hit = await getAiContextCache<{ requiredSkills: string[] }>(cacheKey);
    expect(hit?.requiredSkills).toEqual(['Python', 'AWS']);
  });
});
