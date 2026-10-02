import request from 'supertest';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { createApp } from '../app';
import { User } from '../models/User';
import { Institution } from '../models/Institution';
import { createSessionTokens } from '../services/token.service';

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

describe('institution create', () => {
  const app = createApp();
  let superAdminToken: string;
  const testName = `Plan Tier Free Test ${Date.now()}`;

  beforeAll(async () => {
    await connectDatabase();

    await Promise.all([
      User.deleteMany({ email: 'create-inst@plan-tier-test.local' }),
      Institution.deleteMany({ name: /^Plan Tier Free Test/ }),
    ]);

    const superAdmin = await User.create({
      name: 'Super Admin',
      email: 'create-inst@plan-tier-test.local',
      username: `super_create_${Date.now()}`,
      password: 'Password123!',
      role: 'superAdmin',
      isEmailVerified: true,
    });

    const tokens = await createSessionTokens(superAdmin, {});
    superAdminToken = tokens.accessToken;

    const { getRedis } = await import('../config/redis');
    await getRedis().hset(`session:${tokens.sessionId}`, {
      userId: String(superAdmin._id),
      role: 'superAdmin',
    });
  });

  afterAll(async () => {
    await Institution.deleteMany({ name: /^Plan Tier Free Test/ });
    await User.deleteMany({ email: 'create-inst@plan-tier-test.local' });
    await disconnectDatabase();
  });

  it('creates an institution without planTier in the request body', async () => {
    const res = await request(app)
      .post('/api/institutions')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        name: testName,
        contactEmail: 'placement@example.edu',
      });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe(testName);
    expect(res.body.contactEmail).toBe('placement@example.edu');
    expect(res.body.id).toBeTruthy();
    expect(res.body.planTier).toBeUndefined();

    const row = await Institution.findById(res.body.id);
    expect(row?.name).toBe(testName);
    expect(row?.contactEmail).toBe('placement@example.edu');
  });

  it('ignores planTier if a legacy client still sends it', async () => {
    const legacyName = `${testName} Legacy`;
    const res = await request(app)
      .post('/api/institutions')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        name: legacyName,
        contactEmail: '',
        planTier: 'Enterprise',
      });

    expect(res.status).toBe(201);
    expect(res.body.planTier).toBeUndefined();

    const row = await Institution.findById(res.body.id);
    expect(row?.planTier).toBe('Campus Standard');
  });
});
