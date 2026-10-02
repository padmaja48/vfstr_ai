import mongoose from 'mongoose';
import { Interview } from '../models/Interview';
import { IInstitution } from '../models/Institution';
import { User } from '../models/User';
import { AppError } from '../utils/AppError';

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const institutionNameRegex = (name: string) =>
  new RegExp(`^${escapeRegex(String(name || '').trim())}$`, 'i');

/** Users linked by institutionId or legacy institution name. */
export const userFilterForInstitution = (institution: Pick<IInstitution, '_id' | 'name'>) => ({
  $or: [
    { institutionId: institution._id },
    {
      $and: [
        { $or: [{ institutionId: { $exists: false } }, { institutionId: null }] },
        { institution: institutionNameRegex(institution.name) },
      ],
    },
  ],
});

export const getInstitutionImpactCounts = async (
  institution: Pick<IInstitution, '_id' | 'name'>,
) => {
  const baseFilter = userFilterForInstitution(institution);

  const [studentIds, adminCount] = await Promise.all([
    User.find({ ...baseFilter, role: { $in: ['student', 'candidate'] } })
      .select('_id')
      .lean(),
    User.countDocuments({
      $and: [
        baseFilter,
        { role: { $in: ['admin', 'institutionAdmin', 'recruiter'] } },
        {
          $or: [
            { assignedInstitutionIds: institution._id },
            { institutionId: institution._id },
          ],
        },
      ],
    }),
  ]);

  const ids = studentIds.map((row) => row._id as mongoose.Types.ObjectId);
  const interviewCount = ids.length
    ? await Interview.countDocuments({ userId: { $in: ids } })
    : 0;

  return {
    studentCount: ids.length,
    interviewCount,
    adminCount,
  };
};

export const assertInstitutionIsActive = (
  institution: Pick<IInstitution, 'status' | 'name'>,
) => {
  if (institution.status === 'archived') {
    throw new AppError(
      'This institution has been archived and is no longer active.',
      410,
      'INSTITUTION_ARCHIVED',
    );
  }
};
