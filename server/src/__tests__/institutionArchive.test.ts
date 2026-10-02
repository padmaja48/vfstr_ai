import request from 'supertest';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { createApp } from '../app';
import { User } from '../models/User';
import { Institution } from '../models/Institution';
import { Interview } from '../models/Interview';
import { AuditLog } from '../models/AuditLog';
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

describe('institution archive (soft delete)', () => {
  const app = createApp();
  let superAdminToken: string;
  let institutionId: mongoose.Types.ObjectId;
  let studentId: mongoose.Types.ObjectId;
  let adminId: mongoose.Types.ObjectId;
  let interviewId: mongoose.Types.ObjectId;
  const institutionName = `Archive Test College ${Date.now()}`;

  beforeAll(async () => {
    await connectDatabase();

    await Promise.all([
      User.deleteMany({ email: /@archive-inst-test\.local$/ }),
      Institution.deleteMany({ name: /^Archive Test College/ }),
      Interview.deleteMany({ targetCompany: 'Archive Test Interview Co' }),
      AuditLog.deleteMany({ action: 'institution.archive' }),
    ]);

    const institution = await Institution.create({
      name: institutionName,
      contactEmail: 'placement@archive-inst-test.local',
    });
    institutionId = institution._id;

    const student = await User.create({
      name: 'Archive Test Student',
      email: `student-${Date.now()}@archive-inst-test.local`,
      username: `archive_student_${Date.now()}`,
      password: 'Password123!',
      role: 'student',
      institution: institution.name,
      institutionId: institution._id,
      isEmailVerified: true,
    });
    studentId = student._id;

    const instAdmin = await User.create({
      name: 'Archive Test Inst Admin',
      email: `instadmin-${Date.now()}@archive-inst-test.local`,
      username: `archive_instadmin_${Date.now()}`,
      password: 'Password123!',
      role: 'institutionAdmin',
      institution: institution.name,
      institutionId: institution._id,
      isEmailVerified: true,
    });
    adminId = instAdmin._id;

    const interview = await Interview.create({
      userId: student._id,
      targetCompany: 'Archive Test Interview Co',
      status: 'Completed',
      totalScore: 72,
      roleLevel: 'Fresher',
      roleDomain: 'Software Engineering',
      questions: [{ question: 'Tell me about yourself.' }],
    });
    interviewId = interview._id;

    const superAdmin = await User.create({
      name: 'Archive Test Super Admin',
      email: `super-${Date.now()}@archive-inst-test.local`,
      username: `archive_super_${Date.now()}`,
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
    await Interview.deleteMany({ _id: interviewId });
    await User.deleteMany({ email: /@archive-inst-test\.local$/ });
    await Institution.deleteMany({ name: /^Archive Test College/ });
    await disconnectDatabase();
  });

  it('reports real linked counts before archive', async () => {
    const res = await request(app)
      .get(`/api/institutions/${institutionId}/deletion-impact`)
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.institution.name).toBe(institutionName);
    expect(res.body.studentCount).toBe(1);
    expect(res.body.interviewCount).toBe(1);
    expect(res.body.adminCount).toBe(1);
  });

  it('rejects archive when confirmation name does not match', async () => {
    const res = await request(app)
      .post(`/api/institutions/${institutionId}/archive`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ confirmName: 'Wrong Name' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INSTITUTION_CONFIRM_MISMATCH');

    const row = await Institution.findById(institutionId);
    expect(row?.status).not.toBe('archived');
  });

  it('archives institution without breaking linked student/interview records', async () => {
    const res = await request(app)
      .post(`/api/institutions/${institutionId}/archive`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ confirmName: institutionName });

    expect(res.status).toBe(200);
    expect(res.body.archived).toBe(true);
    expect(res.body.impact.studentCount).toBe(1);
    expect(res.body.impact.interviewCount).toBe(1);

    const row = await Institution.findById(institutionId);
    expect(row?.status).toBe('archived');
    expect(row?.archivedAt).toBeTruthy();

    const student = await User.findById(studentId);
    expect(String(student?.institutionId)).toBe(String(institutionId));
    expect(student?.institution).toBe(institutionName);

    const interview = await Interview.findById(interviewId);
    expect(String(interview?.userId)).toBe(String(studentId));

    const audit = await AuditLog.findOne({
      action: 'institution.archive',
      targetId: String(institutionId),
    });
    expect(audit).toBeTruthy();
    expect(audit?.metadata).toMatchObject({
      studentCount: 1,
      interviewCount: 1,
      adminCount: 1,
    });
  });

  it('hides archived institution from active list and blocks bulk import', async () => {
    const list = await request(app)
      .get('/api/institutions')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(list.status).toBe(200);
    expect(list.body.some((row: { id: string }) => row.id === String(institutionId))).toBe(false);

    const bulk = await request(app)
      .post(`/api/institutions/${institutionId}/students/bulk`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        students: [{ name: 'New Student', email: `new-${Date.now()}@archive-inst-test.local` }],
      });

    expect(bulk.status).toBe(410);
    expect(bulk.body.code).toBe('INSTITUTION_ARCHIVED');
  });

  it('blocks institution admin access after archive', async () => {
    const instAdmin = await User.findById(adminId);
    expect(instAdmin).toBeTruthy();

    const tokens = await createSessionTokens(instAdmin!, {});
    const { getRedis } = await import('../config/redis');
    await getRedis().hset(`session:${tokens.sessionId}`, {
      userId: String(instAdmin!._id),
      role: 'institutionAdmin',
    });

    const res = await request(app)
      .get(`/api/institutions/${institutionId}`)
      .set('Authorization', `Bearer ${tokens.accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INSTITUTION_ARCHIVED');
  });
});
