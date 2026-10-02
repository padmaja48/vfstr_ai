/**
 * Upsert platform super admin (dev/local).
 * Usage: npx ts-node --transpile-only scripts/seedSuperAdmin.ts
 */
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  const { User } = await import('../src/models/User');
  const { env } = await import('../src/config/env');

  const username = 'superadmin';
  const email = 'superadmin@fluentai.local';
  const password = '1234';

  await mongoose.connect(env.MONGODB_URI);
  console.log('Connected to MongoDB');

  let user = await User.findOne({
    $or: [{ username }, { email }],
  }).select('+password');

  if (!user) {
    user = new User({
      name: 'Super Admin',
      username,
      email,
      password,
      role: 'superAdmin',
      authProvider: 'email',
      isEmailVerified: true,
      level: 'C1',
    });
  } else {
    user.name = 'Super Admin';
    user.username = username;
    user.email = email;
    user.role = 'superAdmin';
    user.authProvider = 'email';
    user.isEmailVerified = true;
    user.password = password;
    user.assignedInstitutionIds = [];
    user.institutionId = undefined;
  }

  await user.save();

  console.log('Super admin ready.');
  console.log('  username:', username);
  console.log('  email:   ', email);
  console.log('  role:    ', user.role);
  console.log('  password: 1234');

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
