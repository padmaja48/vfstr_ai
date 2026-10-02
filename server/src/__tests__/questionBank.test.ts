import request from 'supertest';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { createApp } from '../app';
import { User } from '../models/User';
import { Question } from '../models/Question';
import { createSessionTokens } from '../services/token.service';
import { normalizeQuestionText } from '../services/questionBank.service';

jest.mock('../config/redis', () => {
  const store = new Map<string, Record<string, string>>();
  return {
    getRedis: () => ({
      hgetall: async (key: string) => store.get(key) || {},
      hset: async (key: string, data: Record<string, string>) => {
        store.set(key, { ...(store.get(key) || {}), ...data });
      },
      expire: async () => undefined,
      get: async () => null,
      set: async () => undefined,
      del: async (key: string) => {
        store.delete(key);
      },
    }),
  };
});

describe('question bank admin API', () => {
  const app = createApp();
  let superAdminToken: string;
  let instAdminToken: string;
  let activeQuestionId: string;

  beforeAll(async () => {
    await connectDatabase();

    await Promise.all([
      User.deleteMany({ email: /@question-bank-test\.local$/ }),
      Question.deleteMany({ text: /^QB test / }),
    ]);

    const superAdmin = await User.create({
      name: 'QB Super Admin',
      email: 'super@question-bank-test.local',
      username: 'super_qb',
      password: 'Password123!',
      role: 'superAdmin',
      isEmailVerified: true,
    });

    const instAdmin = await User.create({
      name: 'QB Inst Admin',
      email: 'instadmin@question-bank-test.local',
      username: 'instadmin_qb',
      password: 'Password123!',
      role: 'institutionAdmin',
      institution: 'QB College',
      isEmailVerified: true,
    });

    const created = await Question.create({
      text: 'QB test active question about binary search trees',
      normalizedText: normalizeQuestionText('QB test active question about binary search trees'),
      category: 'Technical',
      difficulty: 'Medium',
      createdBy: 'admin',
      createdByUserId: superAdmin._id,
      status: 'active',
    });
    activeQuestionId = String(created._id);

    await Question.create({
      text: 'QB test archived question about teamwork',
      normalizedText: normalizeQuestionText('QB test archived question about teamwork'),
      category: 'Behavioral',
      difficulty: 'Easy',
      createdBy: 'migrated',
      status: 'archived',
    });

    const superTokens = await createSessionTokens(superAdmin, {});
    const instTokens = await createSessionTokens(instAdmin, {});
    superAdminToken = superTokens.accessToken;
    instAdminToken = instTokens.accessToken;

    const { getRedis } = await import('../config/redis');
    await getRedis().hset(`session:${superTokens.sessionId}`, {
      userId: String(superAdmin._id),
      role: 'superAdmin',
      email: superAdmin.email,
    });
    await getRedis().hset(`session:${instTokens.sessionId}`, {
      userId: String(instAdmin._id),
      role: 'institutionAdmin',
      email: instAdmin.email,
    });
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('superAdmin can list active questions', async () => {
    const res = await request(app)
      .get('/api/admin/questions?status=active')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.questions.some((q: { text: string }) => q.text.includes('binary search'))).toBe(true);
  });

  it('institutionAdmin cannot access question bank endpoints', async () => {
    const res = await request(app)
      .get('/api/admin/questions')
      .set('Authorization', `Bearer ${instAdminToken}`);

    expect(res.status).toBe(403);
  });

  it('archived questions are excluded from active bank query helper', async () => {
    const { queryQuestionBankFromDb } = await import('../services/questionBank.service');
    const result = await queryQuestionBankFromDb(undefined, 'Software Engineer', 'fresher', 20);
    const texts = (result?.questions || []).map((q) => q.question);
    expect(texts.some((text) => text.includes('archived question about teamwork'))).toBe(false);
  });

  it('superAdmin can archive a question', async () => {
    const res = await request(app)
      .delete(`/api/admin/questions/${activeQuestionId}`)
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.question.status).toBe('archived');
  });
});
