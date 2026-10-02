/**
 * Migrate legacy admin roles and backfill institutionId from institution name.
 *
 *   admin     -> superAdmin
 *   recruiter -> institutionAdmin
 *   candidate -> student
 *
 * Usage: npx ts-node --transpile-only scripts/migrateAdminRoles.ts
 */
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  const { User } = await import('../src/models/User');
  const { Institution } = await import('../src/models/Institution');
  const { env } = await import('../src/config/env');

  await mongoose.connect(env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const institutions = await Institution.find().lean();
  const byName = new Map(institutions.map((i) => [i.name.toLowerCase(), i._id]));

  const roleMigrations: Array<{ from: string; to: string }> = [
    { from: 'admin', to: 'superAdmin' },
    { from: 'recruiter', to: 'institutionAdmin' },
    { from: 'candidate', to: 'student' },
  ];

  for (const { from, to } of roleMigrations) {
    const result = await User.updateMany({ role: from }, { $set: { role: to } });
    console.log(`Role ${from} -> ${to}: ${result.modifiedCount} updated`);
  }

  const users = await User.find({
    $or: [
      { institution: { $exists: true, $ne: '' }, institutionId: { $exists: false } },
      { institution: { $exists: true, $ne: '' }, institutionId: null },
    ],
  }).select('_id institution role');

  let backfilled = 0;
  for (const user of users) {
    const name = String(user.institution || '').trim().toLowerCase();
    const instId = byName.get(name);
    if (instId) {
      user.institutionId = instId;
      await user.save();
      backfilled += 1;
    }
  }
  console.log(`institutionId backfilled on ${backfilled} users`);

  const unassignedInstAdmins = await User.find({
    role: 'institutionAdmin',
    $or: [{ institutionId: { $exists: false } }, { institutionId: null }],
  }).select('email institution');

  if (unassignedInstAdmins.length) {
    console.warn('Institution admins still missing institutionId:');
    unassignedInstAdmins.forEach((u) => console.warn(`  - ${u.email} (${u.institution || 'no institution string'})`));
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
