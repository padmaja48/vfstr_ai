import request from 'supertest';
import mongoose from 'mongoose';
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

jest.mock('../services/bulkWelcomeEmail.service', () => ({
  sendBulkWelcomeEmails: jest.fn(async () => []),
}));

describe('bulk import institution enforcement', () => {
  jest.setTimeout(120000);

  const app = createApp();
  let institutionA: mongoose.Types.ObjectId;
  let institutionB: mongoose.Types.ObjectId;
  let superAdminToken: string;
  let instAdminToken: string;

  beforeAll(async () => {
    await connectDatabase();

    await Promise.all([
      User.deleteMany({ email: /@bulk-import-test\.local$/ }),
      Institution.deleteMany({ name: /^Bulk Import Test/ }),
    ]);

    const [instA, instB] = await Institution.create([
      { name: 'Bulk Import Test College A', contactEmail: 'a@bulk-import-test.local' },
      { name: 'Bulk Import Test College B', contactEmail: 'b@bulk-import-test.local' },
    ]);
    institutionA = instA._id;
    institutionB = instB._id;

    const superAdmin = await User.create({
      name: 'Super Admin',
      email: 'super@bulk-import-test.local',
      username: 'super_bulk',
      password: 'Password123!',
      role: 'superAdmin',
      isEmailVerified: true,
    });

    const instAdmin = await User.create({
      name: 'Inst Admin A',
      email: 'instadmin@bulk-import-test.local',
      username: 'instadmin_bulk',
      password: 'Password123!',
      role: 'admin',
      institution: instA.name,
      institutionId: instA._id,
      assignedInstitutionIds: [instA._id],
      isEmailVerified: true,
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
      role: 'admin',
      email: instAdmin.email,
    });
  });

  afterAll(async () => {
    await User.deleteMany({ email: /@bulk-import-test\.local$/ });
    await Institution.deleteMany({ name: /^Bulk Import Test/ });
    await disconnectDatabase();
  });

  it('rejects bulk import without institutionId for superAdmin', async () => {
    const res = await request(app)
      .post('/api/users/bulk-import')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ emails: ['newstudent@bulk-import-test.local'] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INSTITUTION_REQUIRED');
  });

  it('assigns every created student to the selected institution', async () => {
    const email = `assigned-${Date.now()}@bulk-import-test.local`;
    const res = await request(app)
      .post('/api/users/bulk-import')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        emails: [email],
        institutionId: String(institutionA),
      });

    expect(res.status).toBe(201);
    expect(res.body.createdCount).toBe(1);
    expect(res.body.institutionId).toBe(String(institutionA));
    expect(res.body.institutionName).toBe('Bulk Import Test College A');

    const created = await User.findOne({ email });
    expect(String(created?.institutionId)).toBe(String(institutionA));
    expect(created?.institution).toBe('Bulk Import Test College A');
  });

  it('college admin cannot bulk import students', async () => {
    const res = await request(app)
      .post('/api/users/bulk-import')
      .set('Authorization', `Bearer ${instAdminToken}`)
      .send({
        emails: [`foreign-${Date.now()}@bulk-import-test.local`],
        institutionId: String(institutionA),
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SUPER_ADMIN_REQUIRED');
  });
});
