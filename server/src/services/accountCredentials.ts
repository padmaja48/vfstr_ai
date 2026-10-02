import { User } from '../models/User';
import { AppError } from '../utils/AppError';

export const usernameFromEmail = (email: string) => {
  const local = String(email || '').split('@')[0] || '';
  return slugifyUsername(local) || 'user';
};

/** Normalize imported name or roll number into a login-safe username base. */
export const slugifyUsername = (value: string) =>
  String(value || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 40);

/**
 * Prefer roll number, then student name, then email local-part for bulk-import usernames.
 */
export const usernameFromImportIdentity = (input: {
  name?: string;
  rollNumber?: string;
  email?: string;
}) => {
  const fromRoll = slugifyUsername(input.rollNumber || '');
  if (fromRoll.length >= 2) return fromRoll;

  const fromName = slugifyUsername(input.name || '');
  if (fromName.length >= 2) return fromName;

  return usernameFromEmail(input.email || '');
};

export const passwordFromUsername = (username: string) => `${username}@PV2913`;

export const ensureUniqueUsername = async (base: string, excludeId?: string) => {
  let candidate = base.slice(0, 40) || 'user';
  let suffix = 0;

  while (suffix < 500) {
    const tryName = suffix === 0 ? candidate : `${candidate.slice(0, 36)}${suffix}`;
    const existing = await User.findOne({
      username: tryName,
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    }).select('_id');

    if (!existing) return tryName;
    suffix += 1;
  }

  throw new AppError('Could not allocate a unique username.', 500, 'USERNAME_ALLOCATION_FAILED');
};
