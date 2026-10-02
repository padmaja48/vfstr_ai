import mongoose from 'mongoose';
import { Request } from 'express';
import { RequestHandler } from 'express';
import { Institution } from '../models/Institution';
import { IUser } from '../models/User';
import { AppError } from '../utils/AppError';
import { assertInstitutionIsActive } from '../services/institutionImpact.service';
import {
  isAnyAdminRole,
  isCollegeAdminRole,
  isSuperAdminRole,
  normalizeRole,
} from '../utils/roles';

export type AdminScope =
  | { type: 'global' }
  | {
      type: 'institution';
      institutionIds: mongoose.Types.ObjectId[];
      institutionNames: string[];
    };

declare global {
  namespace Express {
    interface Request {
      adminScope?: AdminScope;
    }
  }
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Effective assigned institution IDs for a college admin (array + legacy single field). */
export const getAssignedInstitutionIds = (user: IUser): mongoose.Types.ObjectId[] => {
  const fromArray = (user.assignedInstitutionIds || []).filter(Boolean);
  if (fromArray.length) return fromArray;
  if (user.institutionId) return [user.institutionId];
  return [];
};

export const buildAdminScope = async (user: IUser): Promise<AdminScope> => {
  const role = normalizeRole(user.role);
  if (isSuperAdminRole(role)) {
    return { type: 'global' };
  }

  if (isCollegeAdminRole(role)) {
    const rawIds = getAssignedInstitutionIds(user);
    let institutionNames = String(user.institution || '').trim()
      ? [String(user.institution).trim()]
      : [];

    if (rawIds.length) {
      const rows = await Institution.find({ _id: { $in: rawIds } }).select('_id name status').lean();
      const archived = rows.find((row) => row.status === 'archived');
      if (archived) {
        throw new AppError(
          'One of your assigned institutions has been archived. Contact a super admin.',
          403,
          'INSTITUTION_ARCHIVED',
        );
      }
      if (rows.length) {
        institutionNames = rows.map((row) => row.name);
        return {
          type: 'institution',
          institutionIds: rows.map((row) => row._id as mongoose.Types.ObjectId),
          institutionNames,
        };
      }
    }

    if (institutionNames.length) {
      const resolvedIds: mongoose.Types.ObjectId[] = [];
      const resolvedNames: string[] = [];
      for (const name of institutionNames) {
        const row = await Institution.findOne({
          name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' },
        }).select('_id name status');
        if (row) {
          if (row.status === 'archived') {
            throw new AppError(
              'Your institution has been archived. Contact a super admin.',
              403,
              'INSTITUTION_ARCHIVED',
            );
          }
          resolvedIds.push(row._id);
          resolvedNames.push(row.name);
        }
      }
      if (resolvedIds.length) {
        return { type: 'institution', institutionIds: resolvedIds, institutionNames: resolvedNames };
      }
    }

    throw new AppError(
      'Admin account is missing institution assignment. Contact a super admin.',
      403,
      'INSTITUTION_ADMIN_UNASSIGNED',
    );
  }

  throw new AppError('Forbidden', 403, 'FORBIDDEN');
};

/** Both superAdmin and college admin — attaches req.adminScope. */
export const authorizeAdmin: RequestHandler = async (req, _res, next) => {
  if (!req.user || !isAnyAdminRole(req.user.role)) {
    return next(new AppError('Forbidden', 403, 'FORBIDDEN'));
  }

  try {
    req.adminScope = await buildAdminScope(req.user);
    req.userRole = normalizeRole(req.user.role);
    next();
  } catch (err) {
    next(err);
  }
};

/** Super admin only. */
export const authorizeSuperAdmin: RequestHandler = (req, _res, next) => {
  if (!req.user || !isSuperAdminRole(req.user.role)) {
    return next(new AppError('Super admin access required', 403, 'SUPER_ADMIN_REQUIRED'));
  }
  req.adminScope = { type: 'global' };
  req.userRole = normalizeRole(req.user.role);
  next();
};

/**
 * Optional institution drill-down for superAdmin (global scope).
 * College admin scope is enforced by userFilterForScope + assertInstitutionParamAllowed.
 */
export const institutionQueryFilter = (
  scope: AdminScope,
  institutionId?: string | null,
  institutionName?: string | null,
): Record<string, unknown> | null => {
  if (scope.type === 'institution') {
    const id = String(institutionId || '').trim();
    if (id && mongoose.Types.ObjectId.isValid(id)) {
      return { institutionId: new mongoose.Types.ObjectId(id) };
    }
    const name = String(institutionName || '').trim();
    if (name && name !== 'all') {
      return {
        institution: {
          $regex: `^${escapeRegex(name)}$`,
          $options: 'i',
        },
      };
    }
    return null;
  }

  const id = String(institutionId || '').trim();
  if (id && mongoose.Types.ObjectId.isValid(id)) {
    return { institutionId: new mongoose.Types.ObjectId(id) };
  }

  const name = String(institutionName || '').trim();
  if (name && name !== 'all') {
    return {
      institution: {
        $regex: `^${escapeRegex(name)}$`,
        $options: 'i',
      },
    };
  }

  return null;
};

const institutionScopeOrFilter = (scope: Extract<AdminScope, { type: 'institution' }>) => {
  const idMatch = scope.institutionIds.length
    ? [{ institutionId: { $in: scope.institutionIds } }]
    : [];
  const nameMatches = scope.institutionNames.map((name) => ({
    institutionId: { $exists: false },
    institution: { $regex: `^${escapeRegex(name)}$`, $options: 'i' },
  }));
  return [...idMatch, ...nameMatches];
};

/** Build a Mongo filter for User documents within the caller's admin scope. */
export const userFilterForScope = (
  scope: AdminScope,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => {
  if (scope.type === 'global') {
    return { ...extra };
  }

  const orConditions = institutionScopeOrFilter(scope);
  if (!orConditions.length) {
    return { ...extra, _id: { $in: [] } };
  }

  return {
    ...extra,
    $or: orConditions,
  };
};

/** Resolve user IDs belonging to the admin scope (for interview/report/resume queries). */
export const getScopedUserIds = async (scope: AdminScope): Promise<mongoose.Types.ObjectId[]> => {
  if (scope.type === 'global') {
    return [];
  }

  const filter = userFilterForScope(scope, { role: { $in: ['student', 'candidate'] } });
  const rows = await mongoose.model('User').find(filter).select('_id').lean();
  return rows.map((r) => r._id as mongoose.Types.ObjectId);
};

/** Filter interviews/reports/resumes by scoped user IDs. Empty array for global = no user filter. */
export const resourceFilterForScope = async (
  scope: AdminScope,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> => {
  if (scope.type === 'global') {
    return { ...extra };
  }

  const userIds = await getScopedUserIds(scope);
  if (!userIds.length) {
    return { ...extra, userId: { $in: [] } };
  }

  return { ...extra, userId: { $in: userIds } };
};

const userInInstitutionScope = (
  scope: Extract<AdminScope, { type: 'institution' }>,
  user: IUser,
): boolean => {
  if (user.institutionId) {
    return scope.institutionIds.some((id) => String(id) === String(user.institutionId));
  }
  if (user.institution) {
    const normalized = user.institution.toLowerCase();
    return scope.institutionNames.some((name) => name.toLowerCase() === normalized);
  }
  return false;
};

/** Reject if target user is outside the caller's institution scope. */
export const assertUserInAdminScope = async (
  scope: AdminScope,
  targetUserId: string,
): Promise<IUser> => {
  const user = await mongoose.model<IUser>('User').findById(targetUserId);
  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  if (scope.type === 'global') {
    return user as IUser;
  }

  if (!userInInstitutionScope(scope, user as IUser)) {
    throw new AppError('Forbidden — user belongs to another institution', 403, 'INSTITUTION_FORBIDDEN');
  }

  return user as IUser;
};

/** Reject institution query/body params outside the caller's assigned institutions. */
export const assertInstitutionParamAllowed = (
  scope: AdminScope,
  institutionId?: string | null,
  institutionName?: string | null,
) => {
  if (scope.type === 'global') return;

  const id = String(institutionId || '').trim();
  if (id && mongoose.Types.ObjectId.isValid(id)) {
    const allowed = scope.institutionIds.some((instId) => String(instId) === id);
    if (!allowed) {
      throw new AppError('Forbidden — cannot access another institution', 403, 'INSTITUTION_FORBIDDEN');
    }
  }

  const name = String(institutionName || '').trim();
  if (name && name !== 'all') {
    const allowed = scope.institutionNames.some((n) => n.toLowerCase() === name.toLowerCase());
    if (!allowed) {
      throw new AppError('Forbidden — cannot access another institution', 403, 'INSTITUTION_FORBIDDEN');
    }
  }
};

export const resolveInstitutionAssignment = async (
  institutionId?: string,
  institutionName?: string,
): Promise<{ institutionId?: mongoose.Types.ObjectId; institutionName: string }> => {
  if (institutionId && mongoose.Types.ObjectId.isValid(institutionId)) {
    const row = await Institution.findById(institutionId);
    if (!row) throw new AppError('Institution not found', 404, 'INSTITUTION_NOT_FOUND');
    assertInstitutionIsActive(row);
    return { institutionId: row._id, institutionName: row.name };
  }

  const name = String(institutionName || '').trim();
  if (!name) return { institutionName: '' };

  const row = await Institution.findOne({
    name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' },
  });
  if (row) {
    assertInstitutionIsActive(row);
    return { institutionId: row._id, institutionName: row.name };
  }
  return { institutionName: name };
};

/** Resolve many institution IDs (for college admin assignment). */
export const resolveAssignedInstitutionIds = async (
  ids: string[],
): Promise<{ institutionIds: mongoose.Types.ObjectId[]; institutionNames: string[]; primaryName: string }> => {
  const unique = Array.from(new Set(ids.map((id) => String(id).trim()).filter(Boolean)));
  if (!unique.length) {
    throw new AppError('At least one institution must be assigned.', 400, 'INSTITUTION_REQUIRED');
  }

  const institutionIds: mongoose.Types.ObjectId[] = [];
  const institutionNames: string[] = [];

  for (const id of unique) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError(`Invalid institution id: ${id}`, 400, 'INSTITUTION_INVALID');
    }
    const row = await Institution.findById(id);
    if (!row) throw new AppError('Institution not found', 404, 'INSTITUTION_NOT_FOUND');
    assertInstitutionIsActive(row);
    institutionIds.push(row._id);
    institutionNames.push(row.name);
  }

  return {
    institutionIds,
    institutionNames,
    primaryName: institutionNames[0] || '',
  };
};

/** Resolve + authorize institution for bulk student import (super admin only). */
export const resolveBulkImportInstitution = async (
  scope: AdminScope,
  institutionId?: string | null,
): Promise<{ institutionId: mongoose.Types.ObjectId; institutionName: string }> => {
  if (scope.type === 'institution') {
    throw new AppError('Bulk import requires super admin access', 403, 'SUPER_ADMIN_REQUIRED');
  }

  const id = String(institutionId || '').trim();
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(
      'institutionId is required for bulk import',
      400,
      'INSTITUTION_REQUIRED',
    );
  }

  const assignment = await resolveInstitutionAssignment(id);
  if (!assignment.institutionId) {
    throw new AppError('Institution not found', 404, 'INSTITUTION_NOT_FOUND');
  }

  return {
    institutionId: assignment.institutionId,
    institutionName: assignment.institutionName,
  };
};

export const scopeFromRequest = (req: Request): AdminScope => {
  if (!req.adminScope) {
    throw new AppError('Admin scope not initialized', 500, 'SCOPE_MISSING');
  }
  return req.adminScope;
};

/** Load institution summaries for auth/API responses. */
export const loadAssignedInstitutionSummaries = async (user: IUser) => {
  const ids = getAssignedInstitutionIds(user);
  if (!ids.length) return [];
  const rows = await Institution.find({ _id: { $in: ids } }).select('_id name status').lean();
  return rows.map((row) => ({
    id: String(row._id),
    name: row.name,
    status: row.status,
  }));
};
