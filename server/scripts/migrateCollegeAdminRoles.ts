/**
 * Migrate college admin role + multi-institution assignments.
 *
 *   institutionAdmin -> admin
 *   recruiter          -> admin
 *   (legacy platform `admin` was already migrated to superAdmin by migrateAdminRoles.ts)
 *
 * For college admins with institutionId but empty assignedInstitutionIds:
 *   assignedInstitutionIds = [institutionId]
 *
 * Usage: npx ts-node --transpile-only scripts/migrateCollegeAdminRoles.ts
 */
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  const { User } = await import('../src/models/User');
  const { env } = await import('../src/config/env');

  await mongoose.connect(env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const roleMigrations: Array<{ from: string; to: string }> = [
    { from: 'institutionAdmin', to: 'admin' },
    { from: 'recruiter', to: 'admin' },
  ];

  for (const { from, to } of roleMigrations) {
    const result = await User.updateMany({ role: from }, { $set: { role: to } });
    console.log(`Role ${from} -> ${to}: ${result.modifiedCount} updated`);
  }

  const collegeAdmins = await User.find({
    role: 'admin',
    institutionId: { $exists: true, $ne: null },
    $or: [
      { assignedInstitutionIds: { $exists: false } },
      { assignedInstitutionIds: { $size: 0 } },
    ],
  }).select('_id email institutionId assignedInstitutionIds');

  let migrated = 0;
  for (const user of collegeAdmins) {
    if (!user.institutionId) continue;
    user.assignedInstitutionIds = [user.institutionId];
    await user.save();
    migrated += 1;
  }
  console.log(`assignedInstitutionIds backfilled on ${migrated} college admin(s)`);

  const unassigned = await User.find({
    role: 'admin',
    $and: [
      { $or: [{ assignedInstitutionIds: { $exists: false } }, { assignedInstitutionIds: { $size: 0 } }] },
      { $or: [{ institutionId: { $exists: false } }, { institutionId: null }] },
    ],
  }).select('email institution');

  if (unassigned.length) {
    console.warn('College admins still missing institution assignment:');
    unassigned.forEach((u) => console.warn(`  - ${u.email} (${u.institution || 'no institution string'})`));
  }

  await mongoose.disconnect();
  console.log('Migration complete.');
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
