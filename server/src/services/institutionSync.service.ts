import { Institution } from '../models/Institution';
import { User } from '../models/User';
import { institutionNameRegex } from './institutionImpact.service';

const SKIP_NAMES = new Set(['unassigned', 'unknown', 'n/a', 'na', 'none', '']);

/**
 * Ensure every distinct user.institution string has an active Institution row
 * so super admins can assign college admins to all campuses in use.
 */
export const syncInstitutionsFromUserProfiles = async () => {
  const names = await User.distinct('institution', {
    institution: { $exists: true, $nin: ['', null] },
  });

  let created = 0;
  for (const raw of names) {
    const name = String(raw || '').trim();
    if (!name || SKIP_NAMES.has(name.toLowerCase())) continue;

    const existing = await Institution.findOne({
      name: institutionNameRegex(name),
      status: { $ne: 'archived' },
    });
    if (existing) continue;

    const archived = await Institution.findOne({
      name: institutionNameRegex(name),
      status: 'archived',
    });
    if (archived) continue;

    await Institution.create({ name, contactEmail: '' });
    created += 1;
  }

  return created;
};
