import request from 'supertest';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { createApp } from '../app';
import { User } from '../models/User';
import { Institution } from '../models/Institution';
import { Interview } from '../models/Interview';
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

describe('admin institution scoping', () => {
  jest.setTimeout(120000);

  const app = createApp();
  let institutionA: mongoose.Types.ObjectId;
  let institutionB: mongoose.Types.ObjectId;
  let institutionC: mongoose.Types.ObjectId;
  let studentA: mongoose.Types.ObjectId;
  let studentB: mongoose.Types.ObjectId;
  let studentC: mongoose.Types.ObjectId;
  let interviewAId: string;
  let interviewBId: string;
  let superAdminToken: string;
  let instAdminToken: string;
  let multiAdminToken: string;
  let legacyAdminToken: string;

  beforeAll(async () => {
    await connectDatabase();

    await Promise.all([
      User.deleteMany({ email: /@scope-test\.local$/ }),
      Institution.deleteMany({ name: /^Scope Test/ }),
      Interview.deleteMany({ roleDomain: 'scope-test' }),
    ]);

    const [instA, instB, instC] = await Institution.create([
      { name: 'Scope Test College A', contactEmail: 'a@scope-test.local' },
      { name: 'Scope Test College B', contactEmail: 'b@scope-test.local' },
      { name: 'Scope Test College C', contactEmail: 'c@scope-test.local' },
    ]);
    institutionA = instA._id;
    institutionB = instB._id;
    institutionC = instC._id;

    const superAdmin = await User.create({
      name: 'Super Admin',
      email: 'super@scope-test.local',
      username: 'super_scope',
      password: 'Password123!',
      role: 'superAdmin',
      isEmailVerified: true,
    });

    const instAdmin = await User.create({
      name: 'Inst Admin A',
      email: 'instadmin@scope-test.local',
      username: 'instadmin_a',
      password: 'Password123!',
      role: 'admin',
      institution: instA.name,
      institutionId: instA._id,
      assignedInstitutionIds: [instA._id],
      isEmailVerified: true,
    });

    const legacyAdmin = await User.create({
      name: 'Legacy Inst Admin',
      email: 'legacyadmin@scope-test.local',
      username: 'legacyadmin_a',
      password: 'Password123!',
      role: 'institutionAdmin',
      institution: instA.name,
      institutionId: instA._id,
      isEmailVerified: true,
    });

    const multiAdmin = await User.create({
      name: 'Multi College Admin',
      email: 'multiadmin@scope-test.local',
      username: 'multiadmin_ab',
      password: 'Password123!',
      role: 'admin',
      institution: instA.name,
      institutionId: instA._id,
      assignedInstitutionIds: [instA._id, instB._id],
      isEmailVerified: true,
    });

    const userA = await User.create({
      name: 'Student A',
      email: 'studenta@scope-test.local',
      username: 'student_a',
      password: 'Password123!',
      role: 'student',
      institution: instA.name,
      institutionId: instA._id,
      isEmailVerified: true,
    });

    const userB = await User.create({
      name: 'Student B',
      email: 'studentb@scope-test.local',
      username: 'student_b',
      password: 'Password123!',
      role: 'student',
      institution: instB.name,
      institutionId: instB._id,
      isEmailVerified: true,
    });

    const userC = await User.create({
      name: 'Student C',
      email: 'studentc@scope-test.local',
      username: 'student_c',
      password: 'Password123!',
      role: 'student',
      institution: instC.name,
      institutionId: instC._id,
      isEmailVerified: true,
    });

    studentA = userA._id;
    studentB = userB._id;
    studentC = userC._id;

    await Interview.create([
      { userId: studentA, roleDomain: 'scope-test', roleLevel: 'Fresher', interviewStyle: 'Mixed', duration: 30, questions: [], status: 'Completed', totalScore: 80 },
      { userId: studentB, roleDomain: 'scope-test', roleLevel: 'Fresher', interviewStyle: 'Mixed', duration: 30, questions: [], status: 'Completed', totalScore: 70 },
      { userId: studentC, roleDomain: 'scope-test', roleLevel: 'Fresher', interviewStyle: 'Mixed', duration: 30, questions: [], status: 'Completed', totalScore: 60 },
    ]);

    const interviews = await Interview.find({ roleDomain: 'scope-test' }).sort({ totalScore: -1 });
    interviewAId = String(interviews.find((iv) => String(iv.userId) === String(studentA))?._id);
    interviewBId = String(interviews.find((iv) => String(iv.userId) === String(studentB))?._id);

    const superTokens = await createSessionTokens(superAdmin, {});
    const instTokens = await createSessionTokens(instAdmin, {});
    const multiTokens = await createSessionTokens(multiAdmin, {});
    const legacyTokens = await createSessionTokens(legacyAdmin, {});
    superAdminToken = superTokens.accessToken;
    instAdminToken = instTokens.accessToken;
    multiAdminToken = multiTokens.accessToken;
    legacyAdminToken = legacyTokens.accessToken;

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
    await getRedis().hset(`session:${multiTokens.sessionId}`, {
      userId: String(multiAdmin._id),
      role: 'admin',
      email: multiAdmin.email,
    });
    await getRedis().hset(`session:${legacyTokens.sessionId}`, {
      userId: String(legacyAdmin._id),
      role: 'institutionAdmin',
      email: legacyAdmin.email,
    });
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('college admin users list excludes other institution', async () => {
    const res = await request(app)
      .get('/api/users/all?page=1&limit=50&scope=non_admin')
      .set('Authorization', `Bearer ${instAdminToken}`);

    expect(res.status).toBe(200);
    const emails = (res.body.users || []).map((u: { email: string }) => u.email);
    expect(emails).toContain('studenta@scope-test.local');
    expect(emails).not.toContain('studentb@scope-test.local');
    expect(emails).not.toContain('studentc@scope-test.local');
  });

  it('multi-college admin sees students from both assigned institutions only', async () => {
    const res = await request(app)
      .get('/api/users/all?page=1&limit=50&scope=non_admin')
      .set('Authorization', `Bearer ${multiAdminToken}`);

    expect(res.status).toBe(200);
    const emails = (res.body.users || []).map((u: { email: string }) => u.email);
    expect(emails).toContain('studenta@scope-test.local');
    expect(emails).toContain('studentb@scope-test.local');
    expect(emails).not.toContain('studentc@scope-test.local');
  });

  it('legacy institutionAdmin with only institutionId still scoped correctly', async () => {
    const res = await request(app)
      .get('/api/users/all?page=1&limit=50&scope=non_admin')
      .set('Authorization', `Bearer ${legacyAdminToken}`);

    expect(res.status).toBe(200);
    const emails = (res.body.users || []).map((u: { email: string }) => u.email);
    expect(emails).toContain('studenta@scope-test.local');
    expect(emails).not.toContain('studentb@scope-test.local');
  });

  it('superAdmin users list includes all institutions', async () => {
    const res = await request(app)
      .get('/api/users/all?page=1&limit=50&scope=non_admin')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    const emails = (res.body.users || []).map((u: { email: string }) => u.email);
    expect(emails).toContain('studenta@scope-test.local');
    expect(emails).toContain('studentb@scope-test.local');
    expect(emails).toContain('studentc@scope-test.local');
  });

  it('college admin cannot fetch other institution student analytics', async () => {
    const res = await request(app)
      .get(`/api/users/${studentB}/analytics`)
      .set('Authorization', `Bearer ${instAdminToken}`);

    expect(res.status).toBe(403);
  });

  it('multi-college admin can fetch assigned institution student analytics', async () => {
    const res = await request(app)
      .get(`/api/users/${studentB}/analytics`)
      .set('Authorization', `Bearer ${multiAdminToken}`);

    expect(res.status).toBe(200);
  });

  it('multi-college admin cannot fetch unassigned institution student analytics', async () => {
    const res = await request(app)
      .get(`/api/users/${studentC}/analytics`)
      .set('Authorization', `Bearer ${multiAdminToken}`);

    expect(res.status).toBe(403);
  });

  it('college admin cannot pass foreign institutionId in analytics query', async () => {
    const res = await request(app)
      .get(`/api/admin/analytics/institution?institutionId=${institutionB}`)
      .set('Authorization', `Bearer ${instAdminToken}`);

    expect(res.status).toBe(403);
  });

  it('multi-college admin can filter analytics to an assigned institution', async () => {
    const res = await request(app)
      .get(`/api/admin/analytics/institution?institutionId=${institutionB}`)
      .set('Authorization', `Bearer ${multiAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.totals.students).toBe(1);
  });

  it('multi-college admin combined analytics spans assigned colleges', async () => {
    const res = await request(app)
      .get('/api/admin/analytics/institution')
      .set('Authorization', `Bearer ${multiAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.totals.students).toBe(2);
    expect(res.body.totals.interviews).toBe(2);
  });

  it('college admin interview list excludes other institution', async () => {
    const res = await request(app)
      .get('/api/interviews/admin/all')
      .set('Authorization', `Bearer ${instAdminToken}`);

    expect(res.status).toBe(200);
    const userIds = res.body.map((iv: { userId: { email?: string } | string }) =>
      typeof iv.userId === 'object' ? iv.userId.email : iv.userId);
    expect(userIds.some((e: string) => String(e).includes('studenta'))).toBe(true);
    expect(userIds.some((e: string) => String(e).includes('studentb'))).toBe(false);
  });

  it('superAdmin users list filters by institutionId', async () => {
    const res = await request(app)
      .get(`/api/users/all?page=1&limit=50&scope=non_admin&institutionId=${institutionA}`)
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    const emails = (res.body.users || []).map((u: { email: string }) => u.email);
    expect(emails).toContain('studenta@scope-test.local');
    expect(emails).not.toContain('studentb@scope-test.local');
  });

  it('superAdmin institution analytics filters by institutionId', async () => {
    const res = await request(app)
      .get(`/api/admin/analytics/institution?institutionId=${institutionA}`)
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.totals.students).toBe(1);
    expect(res.body.totals.interviews).toBe(1);
  });

  it('superAdmin can assign additional college to admin and access expands', async () => {
    const multiAdmin = await User.findOne({ email: 'multiadmin@scope-test.local' });
    expect(multiAdmin).toBeTruthy();
    multiAdmin!.assignedInstitutionIds = [institutionA];
    await multiAdmin!.save();

    const narrowed = await request(app)
      .get('/api/users/all?page=1&limit=50&scope=non_admin')
      .set('Authorization', `Bearer ${multiAdminToken}`);
    expect(narrowed.body.users.map((u: { email: string }) => u.email)).not.toContain('studentb@scope-test.local');

    multiAdmin!.assignedInstitutionIds = [institutionA, institutionB];
    await multiAdmin!.save();

    const expanded = await request(app)
      .get('/api/users/all?page=1&limit=50&scope=non_admin')
      .set('Authorization', `Bearer ${multiAdminToken}`);
    expect(expanded.body.users.map((u: { email: string }) => u.email)).toContain('studentb@scope-test.local');
  });

  it('college admin cannot access institution comparison', async () => {
    const res = await request(app)
      .get('/api/admin/analytics/comparison')
      .set('Authorization', `Bearer ${instAdminToken}`);
    expect(res.status).toBe(403);
  });

  it('super admin can access institution comparison', async () => {
    const res = await request(app)
      .get('/api/admin/analytics/comparison')
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.institutions)).toBe(true);
    expect(res.body.institutions.length).toBeGreaterThanOrEqual(3);
  });

  it('college admin export excludes other institutions', async () => {
    const scoped = await request(app)
      .get('/api/admin/exports/students?format=json')
      .set('Authorization', `Bearer ${instAdminToken}`);
    expect(scoped.status).toBe(200);
    const emails = (scoped.body.rows || []).map((r: { email: string }) => r.email);
    expect(emails).toContain('studenta@scope-test.local');
    expect(emails).not.toContain('studentb@scope-test.local');

    const foreign = await request(app)
      .get(`/api/admin/exports/students?format=json&institutionId=${institutionB}`)
      .set('Authorization', `Bearer ${instAdminToken}`);
    expect(foreign.status).toBe(403);
  });

  it('college admin cannot bulk import students', async () => {
    const res = await request(app)
      .post(`/api/institutions/${institutionA}/students/bulk`)
      .set('Authorization', `Bearer ${instAdminToken}`)
      .send({ students: [{ name: 'New Student', email: 'new@scope-test.local' }] });
    expect(res.status).toBe(403);
  });

  it('college admin cannot create institutions', async () => {
    const res = await request(app)
      .post('/api/institutions')
      .set('Authorization', `Bearer ${instAdminToken}`)
      .send({ name: 'Scope Test Rogue College', contactEmail: 'rogue@scope-test.local' });
    expect(res.status).toBe(403);
  });

  it('college admin cannot update institutions', async () => {
    const res = await request(app)
      .patch(`/api/institutions/${institutionA}`)
      .set('Authorization', `Bearer ${instAdminToken}`)
      .send({ name: 'Renamed College A' });
    expect(res.status).toBe(403);
  });

  it('super admin can update institutions', async () => {
    const res = await request(app)
      .patch(`/api/institutions/${institutionA}`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ contactEmail: 'updated-a@scope-test.local' });
    expect(res.status).toBe(200);
    expect(res.body.contactEmail).toBe('updated-a@scope-test.local');
  });

  it('college admin cannot fetch other institution interview detail', async () => {
    const res = await request(app)
      .get(`/api/interviews/admin/${interviewBId}`)
      .set('Authorization', `Bearer ${instAdminToken}`);
    expect(res.status).toBe(403);
  });

  it('college admin can fetch assigned institution interview detail', async () => {
    const res = await request(app)
      .get(`/api/interviews/admin/${interviewAId}`)
      .set('Authorization', `Bearer ${instAdminToken}`);
    expect(res.status).toBe(200);
  });

  it('college admin cannot reset password for other institution student', async () => {
    const res = await request(app)
      .post(`/api/admin/candidates/${studentB}/reset-password`)
      .set('Authorization', `Bearer ${instAdminToken}`)
      .send({ password: 'NewPassword123!' });
    expect(res.status).toBe(403);
  });

  it('college admin can reset password for assigned institution student', async () => {
    const res = await request(app)
      .post(`/api/admin/candidates/${studentA}/reset-password`)
      .set('Authorization', `Bearer ${instAdminToken}`)
      .send({ password: 'ScopedReset123!' });
    expect(res.status).toBe(200);
  });

  it('college admin can reactivate assigned institution student', async () => {
    await User.findByIdAndUpdate(studentA, { isActive: false, deactivatedAt: new Date() });

    const reactivate = await request(app)
      .post(`/api/admin/candidates/${studentA}/reactivate`)
      .set('Authorization', `Bearer ${instAdminToken}`)
      .send({});
    expect(reactivate.status).toBe(200);

    const blocked = await request(app)
      .post(`/api/admin/candidates/${studentB}/reactivate`)
      .set('Authorization', `Bearer ${instAdminToken}`)
      .send({});
    expect(blocked.status).toBe(403);

    await User.findByIdAndUpdate(studentA, { isActive: true, deactivatedAt: null });
  });

  it('college admin cannot access candidate 360 for other institution', async () => {
    const res = await request(app)
      .get(`/api/admin/candidates/${studentB}/360`)
      .set('Authorization', `Bearer ${instAdminToken}`);
    expect(res.status).toBe(403);
  });

  it('college admin cannot list institutions catalog', async () => {
    const res = await request(app)
      .get('/api/institutions')
      .set('Authorization', `Bearer ${instAdminToken}`);
    expect(res.status).toBe(403);
  });

  it('super admin institution archive requires confirmation name', async () => {
    const temp = await Institution.create({
      name: 'Scope Test Archive Me',
      contactEmail: 'archive@scope-test.local',
    });
    const wrong = await request(app)
      .post(`/api/institutions/${temp._id}/archive`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ confirmName: 'Wrong Name' });
    expect(wrong.status).toBe(400);

    const ok = await request(app)
      .post(`/api/institutions/${temp._id}/archive`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ confirmName: 'Scope Test Archive Me' });
    expect(ok.status).toBe(200);
  });
});
