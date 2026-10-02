/**
 * Live API verification for multi-college admin scoping (dev DB).
 * Usage: npx ts-node --transpile-only scripts/verifyAdminRoleLive.ts
 */
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import request from 'supertest';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

type Check = { name: string; ok: boolean; detail: string };

async function main() {
  const checks: Check[] = [];
  const pass = (name: string, detail: string) => checks.push({ name, ok: true, detail });
  const fail = (name: string, detail: string) => checks.push({ name, ok: false, detail });

  const { connectDatabase, disconnectDatabase } = await import('../src/config/database');
  const { createApp } = await import('../src/app');
  const { User } = await import('../src/models/User');
  const { Institution } = await import('../src/models/Institution');
  const { createSessionTokens } = await import('../src/services/token.service');

  const tag = Date.now();
  const app = createApp();

  await connectDatabase();

  await Promise.all([
    User.deleteMany({ email: /@live-verify\.local$/ }),
    Institution.deleteMany({ name: /^Live Verify College/ }),
  ]);

  const [instA, instB, instC] = await Institution.create([
    { name: `Live Verify College A ${tag}`, contactEmail: `a-${tag}@live-verify.local` },
    { name: `Live Verify College B ${tag}`, contactEmail: `b-${tag}@live-verify.local` },
    { name: `Live Verify College C ${tag}`, contactEmail: `c-${tag}@live-verify.local` },
  ]);

  const superAdmin = await User.create({
    name: 'Live Super Admin',
    email: `super-${tag}@live-verify.local`,
    username: `super_live_${tag}`,
    password: 'Password123!',
    role: 'superAdmin',
    isEmailVerified: true,
  });

  const collegeAdmin = await User.create({
    name: 'Live College Admin',
    email: `admin-${tag}@live-verify.local`,
    username: `admin_live_${tag}`,
    password: 'Password123!',
    role: 'admin',
    institution: instA.name,
    institutionId: instA._id,
    assignedInstitutionIds: [instA._id, instB._id],
    isEmailVerified: true,
  });

  await User.create([
    {
      name: 'Student A',
      email: `studenta-${tag}@live-verify.local`,
      username: `student_a_${tag}`,
      password: 'Password123!',
      role: 'student',
      institution: instA.name,
      institutionId: instA._id,
      isEmailVerified: true,
    },
    {
      name: 'Student B',
      email: `studentb-${tag}@live-verify.local`,
      username: `student_b_${tag}`,
      password: 'Password123!',
      role: 'student',
      institution: instB.name,
      institutionId: instB._id,
      isEmailVerified: true,
    },
    {
      name: 'Student C',
      email: `studentc-${tag}@live-verify.local`,
      username: `student_c_${tag}`,
      password: 'Password123!',
      role: 'student',
      institution: instC.name,
      institutionId: instC._id,
      isEmailVerified: true,
    },
  ]);

  const studentC = await User.findOne({ email: `studentc-${tag}@live-verify.local` });

  const superTokens = await createSessionTokens(superAdmin, {});
  const adminTokens = await createSessionTokens(collegeAdmin, {});

  const { getRedis } = await import('../src/config/redis');
  await getRedis().hset(`session:${superTokens.sessionId}`, {
    userId: String(superAdmin._id),
    role: 'superAdmin',
    email: superAdmin.email,
  });
  await getRedis().hset(`session:${adminTokens.sessionId}`, {
    userId: String(collegeAdmin._id),
    role: 'admin',
    email: collegeAdmin.email,
  });

  const superAuth = `Bearer ${superTokens.accessToken}`;
  const adminAuth = `Bearer ${adminTokens.accessToken}`;

  const adminUsers = await request(app)
    .get('/api/users/all?page=1&limit=50&scope=non_admin')
    .set('Authorization', adminAuth);
  if (adminUsers.status === 200) {
    const emails = (adminUsers.body.users || []).map((u: { email: string }) => u.email);
    const hasA = emails.includes(`studenta-${tag}@live-verify.local`);
    const hasB = emails.includes(`studentb-${tag}@live-verify.local`);
    const hasC = emails.includes(`studentc-${tag}@live-verify.local`);
    if (hasA && hasB && !hasC) {
      pass('College admin student list', 'Sees A+B only, not C');
    } else {
      fail('College admin student list', `emails=${emails.join(', ')}`);
    }
  } else {
    fail('College admin student list', `status ${adminUsers.status}`);
  }

  const foreignAnalytics = await request(app)
    .get(`/api/admin/analytics/institution?institutionId=${instC._id}`)
    .set('Authorization', adminAuth);
  if (foreignAnalytics.status === 403) {
    pass('College admin foreign institution analytics', '403 as expected');
  } else {
    fail('College admin foreign institution analytics', `status ${foreignAnalytics.status}`);
  }

  const combinedAnalytics = await request(app)
    .get('/api/admin/analytics/institution')
    .set('Authorization', adminAuth);
  if (combinedAnalytics.status === 200 && combinedAnalytics.body?.totals?.students === 2) {
    pass('College admin combined analytics', 'totals.students=2');
  } else {
    fail('College admin combined analytics', JSON.stringify(combinedAnalytics.body?.totals || combinedAnalytics.status));
  }

  const bulkImport = await request(app)
    .post('/api/users/bulk-import')
    .set('Authorization', adminAuth)
    .send({ emails: [`blocked-${tag}@live-verify.local`], institutionId: String(instA._id) });
  if (bulkImport.status === 403 && bulkImport.body?.code === 'SUPER_ADMIN_REQUIRED') {
    pass('College admin bulk import blocked', '403 SUPER_ADMIN_REQUIRED');
  } else {
    fail('College admin bulk import blocked', `status ${bulkImport.status} code ${bulkImport.body?.code}`);
  }

  const superBulk = await request(app)
    .post('/api/users/bulk-import')
    .set('Authorization', superAuth)
    .send({ emails: [`imported-${tag}@live-verify.local`], institutionId: String(instA._id) });
  if (superBulk.status === 201 && superBulk.body?.createdCount === 1) {
    pass('Super admin bulk import', '201 created');
  } else {
    fail('Super admin bulk import', `status ${superBulk.status}`);
  }

  if (studentC) {
    const c360 = await request(app)
      .get(`/api/admin/candidates/${studentC._id}/360`)
      .set('Authorization', adminAuth);
    if (c360.status === 403) {
      pass('College admin candidate 360 foreign student', '403 as expected');
    } else {
      fail('College admin candidate 360 foreign student', `status ${c360.status}`);
    }
  }

  collegeAdmin.assignedInstitutionIds = [instA._id];
  await collegeAdmin.save();

  const narrowed = await request(app)
    .get('/api/users/all?page=1&limit=50&scope=non_admin')
    .set('Authorization', adminAuth);
  const narrowedEmails = (narrowed.body.users || []).map((u: { email: string }) => u.email);
  if (narrowed.status === 200 && !narrowedEmails.includes(`studentb-${tag}@live-verify.local`)) {
    pass('Assignment shrink', 'B hidden after removing college B');
  } else {
    fail('Assignment shrink', `status ${narrowed.status} emails=${narrowedEmails.join(', ')}`);
  }

  await User.deleteMany({ email: /@live-verify\.local$/ });
  await Institution.deleteMany({ name: /^Live Verify College/ });
  await disconnectDatabase();

  console.log('\n=== Live admin role verification ===\n');
  checks.forEach((c) => {
    console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}`);
    console.log(`       ${c.detail}`);
  });
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed\n`);
  if (failed) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
