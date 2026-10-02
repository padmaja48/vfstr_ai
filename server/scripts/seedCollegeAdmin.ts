/**
 * One-off: create college-scoped test admin (role: admin, not superAdmin).
 * Usage: npx ts-node --transpile-only scripts/seedCollegeAdmin.ts
 */
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const EMAIL = 'collegeadmin@fluentai.local';
const USERNAME = 'collegeadmin';
const PASSWORD = 'admin1234';
const NAME = 'College Test Admin';

async function main() {
  const { env } = await import('../src/config/env');
  const { User } = await import('../src/models/User');
  const { Institution } = await import('../src/models/Institution');

  await mongoose.connect(env.MONGODB_URI);
  console.log('Connected to MongoDB\n');

  const institutions = await Institution.find({ status: 'active' })
    .sort({ name: 1 })
    .limit(10)
    .select('name status');

  if (institutions.length < 2) {
    const all = await Institution.find({}).sort({ name: 1 }).select('name status');
    console.log('Institutions in DB:', JSON.stringify(all, null, 2));
    throw new Error('Need at least 2 institutions in the database to assign college admin.');
  }

  const picked = institutions.slice(0, 2);
  const assignedIds = picked.map((i) => i._id);

  let user = await User.findOne({
    $or: [{ email: EMAIL }, { username: USERNAME }],
  }).select('+password');

  if (!user) {
    user = new User({
      name: NAME,
      username: USERNAME,
      email: EMAIL,
      password: PASSWORD,
      role: 'admin',
      authProvider: 'email',
      isEmailVerified: true,
      isActive: true,
      requiresAccountSetup: false,
      level: 'C1',
      institution: picked[0].name,
      institutionId: picked[0]._id,
      assignedInstitutionIds: assignedIds,
    });
  } else {
    user.name = NAME;
    user.username = USERNAME;
    user.email = EMAIL;
    user.password = PASSWORD;
    user.role = 'admin';
    user.authProvider = 'email';
    user.isEmailVerified = true;
    user.isActive = true;
    user.requiresAccountSetup = false;
    user.institution = picked[0].name;
    user.institutionId = picked[0]._id;
    user.assignedInstitutionIds = assignedIds;
  }

  await user.save();

  const verified = await User.findById(user._id)
    .populate('assignedInstitutionIds', 'name')
    .select('username email role institution institutionId assignedInstitutionIds');

  console.log('College admin ready.\n');
  console.log('Credentials:');
  console.log('  email:   ', EMAIL);
  console.log('  username:', USERNAME);
  console.log('  password:', PASSWORD);
  console.log('  role:    ', verified?.role, '(NOT superAdmin)\n');
  console.log('Assigned institutions:');
  for (const inst of picked) {
    console.log(`  - ${inst.name} [${inst._id}]`);
  }
  console.log('\nPrimary institution (institutionId):', picked[0].name);

  await mongoose.disconnect();
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
