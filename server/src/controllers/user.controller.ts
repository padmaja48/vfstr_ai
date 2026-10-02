import { z } from 'zod';
import mongoose from 'mongoose';
import { Interview } from '../models/Interview';
import { Report } from '../models/Report';
import { Resume } from '../models/Resume';
import { Schedule } from '../models/Schedule';
import { User } from '../models/User';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import {
  ensureUniqueUsername,
  passwordFromUsername,
  usernameFromEmail,
} from '../services/accountCredentials';
import { revokeAllSessionsForUser } from '../services/token.service';
import {
  assertInstitutionParamAllowed,
  assertUserInAdminScope,
  institutionQueryFilter,
  resolveBulkImportInstitution,
  resolveAssignedInstitutionIds,
  resolveInstitutionAssignment,
  scopeFromRequest,
  userFilterForScope,
} from '../middleware/adminScope';
import { logAdminAction } from '../services/auditLog.service';
import { sendBulkWelcomeEmails } from '../services/bulkWelcomeEmail.service';
import { ASSIGNABLE_ROLES, isCollegeAdminRole, isSuperAdminRole, normalizeRole } from '../utils/roles';

export const updateProfileSchema = z.object({
  body: z.object({
    name: z.string().min(2).optional(),
    level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).optional(),
    phone: z.string().max(30).optional(),
    institution: z.string().max(120).optional(),
    preferredLanguage: z.enum(['English', 'Telugu', 'Hindi']).optional(),
    profileImageUrl: z
      .union([
        z.literal(''),
        z
          .string()
          .url()
          .refine((value) => /^https?:\/\//i.test(value), 'Profile image must be an http(s) URL'),
      ])
      .optional(),
    companySelectorRecentCompanies: z.array(z.string().min(1).max(120)).max(6).optional(),
  }),
});

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
  }),
});

export const getUserDashboard = asyncHandler(async (req, res) => {
  const [user, interviews, reports, resumes, schedules] = await Promise.all([
    User.findById(req.userId).select('-password'),
    Interview.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(5),
    Report.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(5),
    Resume.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(3),
    Schedule.find({ userId: req.userId, status: { $in: ['Scheduled', 'Rescheduled'] } })
      .sort({ scheduledFor: 1 })
      .limit(5),
  ]);

  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  const interviewActivity = interviews.map((interview) => ({
    _id: interview._id,
    type: 'interview',
    title: interview.get('roleDomain') ? `${interview.get('roleDomain')} interview` : 'AI interview',
    subtitle: interview.get('status') ?? 'Interview',
    score: Object.values((interview.get('scores') ?? {}) as Record<string, number>).filter(Boolean)[0] ?? 0,
    createdAt: interview.get('updatedAt') ?? interview.get('createdAt'),
  }));
  const reportActivity = reports.map((report) => ({
    _id: report._id,
    type: 'report',
    title: report.get('title') ?? 'Performance report',
    subtitle: 'Report generated',
    score: report.get('overallScore') ?? 0,
    createdAt: report.get('updatedAt') ?? report.get('createdAt'),
  }));

  const [interviewCount, reportCount, resumeCount] = await Promise.all([
    Interview.countDocuments({ userId: req.userId }),
    Report.countDocuments({ userId: req.userId }),
    Resume.countDocuments({ userId: req.userId }),
  ]);

  res.json({
    user,
    totals: {
      interviews: interviewCount,
      reports: reportCount,
      resumes: resumeCount,
    },
    recentActivity: [...interviewActivity, ...reportActivity]
      .sort((a, b) => Number(new Date(b.createdAt)) - Number(new Date(a.createdAt)))
      .slice(0, 10),
    interviews,
    reports,
    resumes,
    schedules,
  });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const user = await User.findByIdAndUpdate(req.userId, req.body, { new: true }).select('-password');
  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  res.json(user);
});

export const changePassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.userId).select('+password');
  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  if (user.authProvider !== 'email') {
    throw new AppError('Password changes are not available for OAuth accounts.', 400, 'OAUTH_PASSWORD_UNAVAILABLE');
  }

  if (!(await user.comparePassword(req.body.currentPassword))) {
    throw new AppError('Current password is incorrect.', 400, 'INVALID_CURRENT_PASSWORD');
  }

  user.password = req.body.newPassword;
  await user.save();
  res.json({ message: 'Password updated successfully.' });
});

const ADMIN_ROLES = ASSIGNABLE_ROLES;

const serializeAdminUser = (user: {
  _id: unknown;
  name?: string;
  username?: string;
  email?: string;
  role?: string;
  institution?: string;
  institutionId?: unknown;
  assignedInstitutionIds?: unknown[];
  batch?: string;
  branch?: string;
  phone?: string;
  isEmailVerified?: boolean;
  requiresAccountSetup?: boolean;
  isActive?: boolean;
  deactivatedAt?: Date | null;
  totalSessions?: number;
  averageScore?: number;
  terminationHistory?: unknown[];
  createdAt?: Date;
  updatedAt?: Date;
}) => ({
  id: String(user._id),
  _id: user._id,
  name: user.name,
  username: user.username || '',
  email: user.email,
  role: normalizeRole(user.role),
  institution: user.institution || '',
  institutionId: user.institutionId ? String(user.institutionId) : '',
  assignedInstitutionIds: (user.assignedInstitutionIds || []).map((id) => String(id)),
  batch: user.batch || '',
  branch: user.branch || '',
  phone: user.phone || '',
  isEmailVerified: user.isEmailVerified,
  requiresAccountSetup: Boolean(user.requiresAccountSetup),
  isActive: user.isActive !== false,
  deactivatedAt: user.deactivatedAt || null,
  totalSessions: user.totalSessions || 0,
  averageScore: user.averageScore || 0,
  terminationHistory: user.terminationHistory || [],
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

export const createUserSchema = z.object({
  body: z.object({
    email: z.string().trim().email().toLowerCase(),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .min(2)
      .max(40)
      .regex(/^[a-z0-9._-]+$/, 'Username may only contain letters, numbers, dots, underscores, and hyphens'),
    password: z.string().min(8).max(128),
    name: z.string().trim().min(2).max(120).optional(),
    role: z.enum(ADMIN_ROLES).optional(),
    institution: z.string().trim().max(160).optional(),
    institutionId: z.string().trim().optional(),
    assignedInstitutionIds: z.array(z.string().trim().min(1)).optional(),
    batch: z.string().trim().max(40).optional(),
    branch: z.string().trim().max(80).optional(),
  }),
});

export const updateUserAdminSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .min(2)
      .max(40)
      .regex(/^[a-z0-9._-]+$/, 'Username may only contain letters, numbers, dots, underscores, and hyphens')
      .optional(),
    password: z.string().min(8).max(128).optional(),
    role: z.enum(ADMIN_ROLES).optional(),
    name: z.string().trim().min(2).max(120).optional(),
    email: z.string().trim().email().toLowerCase().optional(),
    institution: z.string().trim().max(160).optional(),
    institutionId: z.string().trim().optional(),
    assignedInstitutionIds: z.array(z.string().trim().min(1)).optional(),
    batch: z.string().trim().max(40).optional(),
    branch: z.string().trim().max(80).optional(),
    isActive: z.boolean().optional(),
  }),
});

export const deleteUserSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
});

export const bulkUserIdsSchema = z.object({
  body: z.object({
    ids: z.array(z.string().trim().min(1)).min(1).max(1000),
  }),
});

export const bulkImportEmailsSchema = z.object({
  body: z.object({
    // Row-level validation happens in the controller so malformed rows can be reported
    // alongside successful, skipped, and failed rows instead of rejecting the whole file.
    emails: z.array(z.unknown()).min(1).max(1000),
    role: z.enum(ADMIN_ROLES).optional(),
    institutionId: z.string().trim().min(1).optional(),
  }),
});

export const getAllUsers = asyncHandler(async (req, res) => {
  const scope = scopeFromRequest(req);
  const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit || '25'), 10) || 25));
  const search = String(req.query.search || '').trim();
  const status = String(req.query.status || 'all');
  const scopeFilter = String(req.query.scope || 'all');
  const institution = String(req.query.institution || '').trim();
  const institutionId = String(req.query.institutionId || '').trim();
  const batch = String(req.query.batch || '').trim();
  const branch = String(req.query.branch || '').trim();

  assertInstitutionParamAllowed(scope, institutionId || undefined, institution || undefined);

  const instFilter = institutionQueryFilter(scope, institutionId, institution);
  const filter: Record<string, unknown> = userFilterForScope(scope, instFilter || {});

  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = { $regex: escaped, $options: 'i' };
    filter.$and = [
      ...(Array.isArray(filter.$and) ? filter.$and : []),
      { $or: [{ name: regex }, { email: regex }, { username: regex }] },
    ];
  }
  if (scopeFilter === 'non_admin') filter.role = { $in: ['student', 'candidate'] };
  if (scopeFilter === 'admins') filter.role = { $in: ['superAdmin', 'admin', 'institutionAdmin', 'recruiter'] };
  if (!instFilter && institution && institution !== 'all') filter.institution = institution;
  if (batch) filter.batch = batch;
  if (branch) filter.branch = branch;
  if (status === 'deactivated') {
    filter.isActive = false;
  } else if (status === 'pending_setup') {
    filter.$and = [
      ...(Array.isArray(filter.$and) ? filter.$and : []),
      { isActive: { $ne: false } },
      { requiresAccountSetup: true },
    ];
  } else if (status === 'active') {
    filter.$and = [
      ...(Array.isArray(filter.$and) ? filter.$and : []),
      { isActive: { $ne: false } },
      { requiresAccountSetup: { $ne: true } },
    ];
  }

  const [users, total] = await Promise.all([
    User.find(filter).select('-password').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    User.countDocuments(filter),
  ]);

  res.json({
    users: users.map((u) => serializeAdminUser(u)),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  });
});

/** Super admin: create a single account (email, username, password). */
export const createUser = asyncHandler(async (req, res) => {
  const email = String(req.body.email).trim().toLowerCase();
  const username = String(req.body.username).trim().toLowerCase();
  const password = String(req.body.password);
  const role = normalizeRole((req.body.role as string) || 'student');
  const name = String(req.body.name || username).trim();
  const batch = String(req.body.batch || '').trim();
  const branch = String(req.body.branch || '').trim();

  let institution = '';
  let institutionId: mongoose.Types.ObjectId | undefined;
  let assignedInstitutionIds: mongoose.Types.ObjectId[] = [];

  if (isCollegeAdminRole(role)) {
    const rawIds = Array.isArray(req.body.assignedInstitutionIds)
      ? (req.body.assignedInstitutionIds as string[])
      : req.body.institutionId
        ? [String(req.body.institutionId)]
        : [];
    if (!rawIds.length && !req.body.institution) {
      throw new AppError('College admins must be assigned at least one institution.', 400, 'INSTITUTION_REQUIRED');
    }
    if (rawIds.length) {
      const resolved = await resolveAssignedInstitutionIds(rawIds);
      assignedInstitutionIds = resolved.institutionIds;
      institution = resolved.primaryName;
      institutionId = resolved.institutionIds[0];
    } else {
      const assignment = await resolveInstitutionAssignment(undefined, req.body.institution);
      institution = assignment.institutionName;
      institutionId = assignment.institutionId;
      assignedInstitutionIds = assignment.institutionId ? [assignment.institutionId] : [];
    }
  } else if (role === 'student') {
    const assignment = await resolveInstitutionAssignment(req.body.institutionId, req.body.institution);
    institution = assignment.institutionName;
    institutionId = assignment.institutionId;
  }

  const emailTaken = await User.findOne({ email });
  if (emailTaken) {
    throw new AppError('An account with this email already exists.', 409, 'USER_EXISTS');
  }

  const usernameTaken = await User.findOne({ username });
  if (usernameTaken) {
    throw new AppError('That username is already taken.', 409, 'USERNAME_EXISTS');
  }

  const user = await User.create({
    name,
    email,
    username,
    password,
    role,
    institution,
    institutionId,
    assignedInstitutionIds,
    batch,
    branch,
    isEmailVerified: true,
    authProvider: 'email',
    requiresAccountSetup: role === 'student',
  });

  await logAdminAction({
    actor: req.user!,
    action: role === 'student' ? 'user.create' : 'admin.create',
    targetType: 'User',
    targetId: String(user._id),
    institutionId: institutionId ? String(institutionId) : undefined,
    metadata: { role, email, assignedInstitutionIds: assignedInstitutionIds.map(String) },
    req,
  });

  res.status(201).json({
    message: 'Account created.',
    user: serializeAdminUser(user),
  });
});

/**
 * Admin: bulk-import emails.
 * Username = part before @; password = <username>@PV2913.
 */
export const bulkImportEmails = asyncHandler(async (req, res) => {
  const rawEmails = Array.isArray(req.body.emails) ? (req.body.emails as unknown[]) : [];
  const role = normalizeRole((req.body.role as string) || 'student');
  const scope = scopeFromRequest(req);
  const assignment = await resolveBulkImportInstitution(scope, req.body.institutionId);

  const created: Array<{ id: string; email: string; username: string; password: string }> = [];
  const skipped: Array<{ email: string; reason: string }> = [];
  const failed: Array<{ row: number; reason: string }> = [];
  const seen = new Set<string>();

  for (const [index, rawEmail] of rawEmails.entries()) {
    const row = index + 1;
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
    if (!z.string().email().safeParse(email).success) {
      failed.push({ row, reason: 'A valid email address is required' });
      continue;
    }
    if (seen.has(email)) {
      skipped.push({ email, reason: 'Duplicate in import' });
      continue;
    }
    seen.add(email);

    try {
      const exists = await User.findOne({ email });
      if (exists) {
        skipped.push({ email, reason: 'Already registered' });
        continue;
      }

      const baseUsername = usernameFromEmail(email);
      const username = await ensureUniqueUsername(baseUsername);
      const password = passwordFromUsername(username);

      const user = await User.create({
        name: username,
        email,
        username,
        password,
        role,
        institution: assignment.institutionName,
        institutionId: assignment.institutionId,
        isEmailVerified: true,
        authProvider: 'email',
        requiresAccountSetup: true,
      });

      created.push({
        id: String(user._id),
        email: user.email,
        username,
        password,
      });
    } catch (error) {
      failed.push({
        row,
        reason: error instanceof Error ? error.message : 'Could not create account',
      });
    }
  }

  const emailFailures = role === 'student'
    ? await sendBulkWelcomeEmails(
      created.map((account) => ({
        studentId: account.id,
        email: account.email,
        username: account.username,
        password: account.password,
        name: account.username,
        institutionName: assignment.institutionName,
      })),
    )
    : [];

  await logAdminAction({
    actor: req.user!,
    action: 'user.bulk_import',
    targetType: 'User',
    institutionId: assignment.institutionId ? String(assignment.institutionId) : undefined,
    metadata: { createdCount: created.length, role, emailFailureCount: emailFailures.length },
    req,
  });

  res.status(201).json({
    createdCount: created.length,
    skippedCount: skipped.length,
    failedCount: failed.length,
    emailFailureCount: emailFailures.length,
    institutionId: String(assignment.institutionId),
    institutionName: assignment.institutionName,
    created,
    skipped,
    failed,
    emailFailures,
    passwordFormula: '<username>@PV2913',
    message: `Imported ${created.length} account${created.length === 1 ? '' : 's'}. Passwords follow <username>@PV2913.${
      emailFailures.length
        ? ` ${emailFailures.length} welcome email${emailFailures.length === 1 ? '' : 's'} could not be sent — share credentials manually.`
        : created.length
          ? ' Welcome emails were sent to new students.'
          : ''
    }`,
  });
});

/** Super admin: update username, role, institution, and/or reset password. */
export const updateUserAdmin = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select('+password');
  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  if (req.body.email && req.body.email !== user.email) {
    const emailTaken = await User.findOne({ email: req.body.email, _id: { $ne: user._id } });
    if (emailTaken) {
      throw new AppError('That email is already in use.', 409, 'USER_EXISTS');
    }
    user.email = req.body.email;
  }

  if (req.body.username && req.body.username !== user.username) {
    const usernameTaken = await User.findOne({ username: req.body.username, _id: { $ne: user._id } });
    if (usernameTaken) {
      throw new AppError('That username is already taken.', 409, 'USERNAME_EXISTS');
    }
    user.username = req.body.username;
  }

  if (req.body.role) {
    const nextRole = normalizeRole(req.body.role);
    if (String(user._id) === String(req.userId) && !isSuperAdminRole(nextRole)) {
      throw new AppError('You cannot remove your own super admin role.', 400, 'CANNOT_DEMOTE_SELF');
    }
    user.role = nextRole;
  }

  if (typeof req.body.isActive === 'boolean') {
    if (String(user._id) === String(req.userId) && req.body.isActive === false) {
      throw new AppError('You cannot deactivate your own account.', 400, 'CANNOT_DEACTIVATE_SELF');
    }
    user.isActive = req.body.isActive;
    user.deactivatedAt = req.body.isActive ? null : new Date();
  }

  if (typeof req.body.name === 'string' && req.body.name.trim()) {
    user.name = req.body.name.trim();
  }

  if (req.body.institutionId || req.body.institution) {
    const assignment = await resolveInstitutionAssignment(req.body.institutionId, req.body.institution);
    user.institution = assignment.institutionName;
    user.institutionId = assignment.institutionId;
  }

  if (Array.isArray(req.body.assignedInstitutionIds)) {
    const nextRole = normalizeRole(req.body.role || user.role);
    if (!isCollegeAdminRole(nextRole)) {
      throw new AppError('Only college admin accounts can have assignedInstitutionIds.', 400, 'INVALID_ASSIGNMENT');
    }
    const resolved = await resolveAssignedInstitutionIds(req.body.assignedInstitutionIds as string[]);
    user.assignedInstitutionIds = resolved.institutionIds;
    user.institution = resolved.primaryName;
    user.institutionId = resolved.institutionIds[0];
  } else if (req.body.role && isCollegeAdminRole(normalizeRole(req.body.role))) {
    const hasAssignment = (user.assignedInstitutionIds?.length || 0) > 0 || user.institutionId;
    if (!hasAssignment) {
      throw new AppError('College admins must be assigned at least one institution.', 400, 'INSTITUTION_REQUIRED');
    }
  }

  if (req.body.role && normalizeRole(req.body.role) === 'superAdmin') {
    user.assignedInstitutionIds = [];
    user.institutionId = undefined;
    user.institution = '';
  }

  if (typeof req.body.batch === 'string') user.batch = req.body.batch.trim();
  if (typeof req.body.branch === 'string') user.branch = req.body.branch.trim();

  if (req.body.password) {
    user.password = req.body.password;
  }

  await user.save();

  if (user.isActive === false || req.body.password) {
    await revokeAllSessionsForUser(String(user._id));
  }

  await logAdminAction({
    actor: req.user!,
    action: ['superAdmin', 'admin'].includes(normalizeRole(user.role)) ? 'admin.update' : 'user.update',
    targetType: 'User',
    targetId: String(user._id),
    institutionId: user.institutionId ? String(user.institutionId) : undefined,
    req,
  });

  res.json({
    message: 'User updated.',
    user: serializeAdminUser(user),
  });
});

/** Admin: permanently delete a user account. */
export const deleteUser = asyncHandler(async (req, res) => {
  if (String(req.params.id) === String(req.userId)) {
    throw new AppError('You cannot delete your own account.', 400, 'CANNOT_DELETE_SELF');
  }

  const user = await User.findById(req.params.id);
  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  await User.deleteOne({ _id: user._id });
  await revokeAllSessionsForUser(String(user._id));

  await logAdminAction({
    actor: req.user!,
    action: ['superAdmin', 'admin'].includes(normalizeRole(user.role)) ? 'admin.delete' : 'user.delete',
    targetType: 'User',
    targetId: String(user._id),
    institutionId: user.institutionId ? String(user.institutionId) : undefined,
    req,
  });

  res.json({
    message: 'User account deleted.',
    id: String(user._id),
  });
});

const parseBulkUserIds = (ids: unknown[], currentUserId?: string) => {
  const validIds = ids.filter((id): id is string => mongoose.Types.ObjectId.isValid(String(id)))
    .map((id) => String(id));
  if (validIds.length !== ids.length) {
    throw new AppError('One or more user IDs are invalid.', 400, 'INVALID_USER_IDS');
  }
  const uniqueIds = Array.from(new Set(validIds));
  return {
    ids: uniqueIds.filter((id) => id !== String(currentUserId)),
    skippedSelfCount: uniqueIds.filter((id) => id === String(currentUserId)).length,
  };
};

export const bulkDeleteUsers = asyncHandler(async (req, res) => {
  const { ids, skippedSelfCount } = parseBulkUserIds(req.body.ids, req.userId);
  if (ids.length) {
    await Promise.all(ids.map((id) => revokeAllSessionsForUser(id)));
  }
  const result = ids.length ? await User.deleteMany({ _id: { $in: ids } }) : { deletedCount: 0 };
  await logAdminAction({
    actor: req.user!,
    action: 'user.bulk_delete',
    targetType: 'User',
    metadata: { count: result.deletedCount || 0 },
    req,
  });
  res.json({
    requestedCount: req.body.ids.length,
    affectedCount: result.deletedCount || 0,
    skippedSelfCount,
    message: `${result.deletedCount || 0} user account${result.deletedCount === 1 ? '' : 's'} deleted.`,
  });
});

export const bulkDeactivateUsers = asyncHandler(async (req, res) => {
  const { ids, skippedSelfCount } = parseBulkUserIds(req.body.ids, req.userId);
  const result = ids.length
    ? await User.updateMany(
      { _id: { $in: ids } },
      { $set: { isActive: false, deactivatedAt: new Date() } },
    )
    : { modifiedCount: 0, matchedCount: 0 };
  if (ids.length) {
    await Promise.all(ids.map((id) => revokeAllSessionsForUser(id)));
  }
  const affectedCount = result.modifiedCount || 0;
  await logAdminAction({
    actor: req.user!,
    action: 'user.bulk_deactivate',
    targetType: 'User',
    metadata: { count: affectedCount },
    req,
  });
  res.json({
    requestedCount: req.body.ids.length,
    affectedCount,
    skippedSelfCount,
    message: `${affectedCount} user account${affectedCount === 1 ? '' : 's'} deactivated.`,
  });
});

export const getUserAnalytics = asyncHandler(async (req, res) => {
  const scope = scopeFromRequest(req);
  const user = await assertUserInAdminScope(scope, String(req.params.id));
  const targetUserId = user._id;

  const [interviewHistory, reports] = await Promise.all([
    Interview.find({ userId: targetUserId }).sort({ createdAt: -1 }).limit(20).lean(),
    Report.find({ userId: targetUserId }).sort({ createdAt: -1 }).limit(10).lean(),
  ]);

  res.json({
    user: serializeAdminUser(user),
    interviewHistory,
    reports,
  });
});
