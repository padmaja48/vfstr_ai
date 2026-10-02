/**
 * Upsert local admin account from environment (never hardcode production secrets).
 *
 * Required env:
 *   SEED_ADMIN_PASSWORD  — password for the seeded admin
 * Optional:
 *   SEED_ADMIN_USERNAME  — default "admin"
 *   SEED_ADMIN_EMAIL     — default "admin@fluentai.local"
 *
 * Usage (from repo root or server/):
 *   npx ts-node --transpile-only scripts/seedAdmin.ts
 */
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  const { User } = await import('../src/models/User');
  const { env } = await import('../src/config/env');

  const username = (process.env.SEED_ADMIN_USERNAME || 'admin').trim().toLowerCase();
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@fluentai.local').trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!password || password.length < 8) {
    throw new Error(
      'Set SEED_ADMIN_PASSWORD (min 8 chars) in server/.env before running seedAdmin.',
    );
  }

  await mongoose.connect(env.MONGODB_URI);
  console.log('Connected to MongoDB');

  let user = await User.findOne({
    $or: [{ username }, { email }],
  }).select('+password');

  if (!user) {
    user = new User({
      name: 'Admin',
      username,
      email,
      password,
      role: 'superAdmin',
      authProvider: 'email',
      isEmailVerified: true,
      level: 'C1',
    });
  } else {
    user.name = user.name || 'Admin';
    user.username = username;
    user.email = email;
    user.role = 'superAdmin';
    user.authProvider = 'email';
    user.isEmailVerified = true;
    user.password = password; // hashed by User pre-save hook
  }

  await user.save();

  console.log('Admin ready.');
  console.log('  username:', username);
  console.log('  email:   ', email);
  console.log('  role:    ', user.role);
  console.log('  password: (from SEED_ADMIN_PASSWORD — not printed)');
  console.log(`Sign in with username "${username}" or email "${email}".`);

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
