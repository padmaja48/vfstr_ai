import { z } from 'zod';
import { AuditLog } from '../models/AuditLog';
import {
  assertInstitutionParamAllowed,
  assertUserInAdminScope,
  authorizeAdmin,
  authorizeSuperAdmin,
  scopeFromRequest,
} from '../middleware/adminScope';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import {
  buildCandidate360,
  buildStudentExportRows,
  computeInstitutionAnalytics,
  computeInstitutionComparison,
  rowsToCsv,
} from '../services/adminAnalytics.service';
import { logAdminAction } from '../services/auditLog.service';
import { revokeAllSessionsForUser } from '../services/token.service';
import { normalizeRole } from '../utils/roles';
import { loadAssignedInstitutionSummaries } from '../middleware/adminScope';

export const terminateStudentSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    reason: z.string().trim().min(3).max(2000),
    reasonType: z.enum(['policy_violation', 'academic', 'misconduct', 'voluntary', 'other']).optional(),
    notes: z.string().trim().max(4000).optional(),
  }),
});

export const reactivateStudentSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    notes: z.string().trim().max(4000).optional(),
  }).optional(),
});

export const resetStudentPasswordSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    password: z.string().min(8).max(128),
  }),
});

export const exportQuerySchema = z.object({
  query: z.object({
    format: z.enum(['csv', 'json']).default('csv'),
    batch: z.string().optional(),
    branch: z.string().optional(),
    institutionId: z.string().optional(),
    institution: z.string().optional(),
  }),
});

/** List institutions assigned to the current college admin (or all for super admin via institutions API). */
export const getAssignedInstitutions = asyncHandler(async (req, res) => {
  const scope = scopeFromRequest(req);
  if (scope.type === 'global') {
    res.json({ institutions: [] });
    return;
  }
  const institutions = await loadAssignedInstitutionSummaries(req.user!);
  res.json({ institutions });
});

/** Platform-wide analytics — super admin only. */
export const getPlatformAnalytics = asyncHandler(async (req, res) => {
  const analytics = await computeInstitutionAnalytics({ type: 'global' });
  res.json(analytics);
});

/** Institution analytics — scoped automatically for institutionAdmin. */
export const getInstitutionAnalytics = asyncHandler(async (req, res) => {
  const scope = scopeFromRequest(req);
  const institutionId = String(req.query.institutionId || '');
  const institutionName = String(req.query.institution || '');
  assertInstitutionParamAllowed(scope, institutionId || undefined, institutionName || undefined);

  const analytics = await computeInstitutionAnalytics(scope, {
    institutionId: institutionId || undefined,
    institution: institutionName || undefined,
    batch: String(req.query.batch || '') || undefined,
    branch: String(req.query.branch || '') || undefined,
  });
  res.json(analytics);
});

export const getCandidate360 = asyncHandler(async (req, res) => {
  const scope = scopeFromRequest(req);
  const id = String(req.params.id);
  await assertUserInAdminScope(scope, id);
  const report = await buildCandidate360(id);
  res.json(report);
});

export const getTerminationHistory = asyncHandler(async (req, res) => {
  const scope = scopeFromRequest(req);
  const id = String(req.params.id);
  const user = await assertUserInAdminScope(scope, id);
  res.json({
    userId: String(user._id),
    terminationHistory: user.terminationHistory || [],
  });
});

/** Terminate a student with mandatory reason + audit trail (scoped by admin tier). */
export const terminateStudent = asyncHandler(async (req, res) => {
  const scope = scopeFromRequest(req);
  const id = String(req.params.id);
  const user = await assertUserInAdminScope(scope, id);

  if (!['student', 'candidate'].includes(normalizeRole(user.role))) {
    throw new AppError('Only student accounts can be terminated through this action.', 400, 'INVALID_TARGET');
  }

  if (user.isActive === false) {
    throw new AppError('Student is already deactivated.', 400, 'ALREADY_TERMINATED');
  }

  user.terminationHistory = user.terminationHistory || [];
  user.terminationHistory.push({
    reason: req.body.reason,
    reasonType: req.body.reasonType || 'other',
    terminatedBy: req.user!._id,
    terminatedAt: new Date(),
    notes: req.body.notes,
  });
  user.isActive = false;
  user.deactivatedAt = new Date();
  await user.save();
  await revokeAllSessionsForUser(String(user._id));

  await logAdminAction({
    actor: req.user!,
    action: 'user.terminate',
    targetType: 'User',
    targetId: String(user._id),
    institutionId: user.institutionId ? String(user.institutionId) : undefined,
    metadata: { reason: req.body.reason, reasonType: req.body.reasonType },
    req,
  });

  res.json({
    message: 'Student terminated.',
    userId: String(user._id),
    terminationHistory: user.terminationHistory,
  });
});

/** Reactivate a deactivated student (scoped college admin or super admin). */
export const reactivateStudent = asyncHandler(async (req, res) => {
  const scope = scopeFromRequest(req);
  const id = String(req.params.id);
  const user = await assertUserInAdminScope(scope, id);

  if (!['student', 'candidate'].includes(normalizeRole(user.role))) {
    throw new AppError('Only student accounts can be reactivated through this action.', 400, 'INVALID_TARGET');
  }

  if (user.isActive !== false) {
    throw new AppError('Student is already active.', 400, 'ALREADY_ACTIVE');
  }

  user.isActive = true;
  user.deactivatedAt = null;
  await user.save();

  await logAdminAction({
    actor: req.user!,
    action: 'user.reactivate',
    targetType: 'User',
    targetId: String(user._id),
    institutionId: user.institutionId ? String(user.institutionId) : undefined,
    metadata: { notes: req.body?.notes },
    req,
  });

  res.json({
    message: 'Student reactivated.',
    userId: String(user._id),
    isActive: true,
  });
});

/** Reset a student password (scoped college admin or super admin). */
export const resetStudentPassword = asyncHandler(async (req, res) => {
  const scope = scopeFromRequest(req);
  const id = String(req.params.id);
  const user = await assertUserInAdminScope(scope, id);

  if (!['student', 'candidate'].includes(normalizeRole(user.role))) {
    throw new AppError('Only student passwords can be reset through this action.', 400, 'INVALID_TARGET');
  }

  user.password = req.body.password;
  await user.save();
  await revokeAllSessionsForUser(String(user._id));

  await logAdminAction({
    actor: req.user!,
    action: 'user.update',
    targetType: 'User',
    targetId: String(user._id),
    institutionId: user.institutionId ? String(user.institutionId) : undefined,
    req,
  });

  res.json({ message: 'Student password reset successfully.' });
});

/** Super admin: compare metrics across all active institutions. */
export const getInstitutionComparison = asyncHandler(async (req, res) => {
  const scope = scopeFromRequest(req);
  if (scope.type !== 'global') {
    throw new AppError('Institution comparison requires super admin access.', 403, 'FORBIDDEN');
  }
  const comparison = await computeInstitutionComparison();
  res.json(comparison);
});

export const exportStudents = asyncHandler(async (req, res) => {
  const scope = scopeFromRequest(req);
  assertInstitutionParamAllowed(
    scope,
    String(req.query.institutionId || '') || undefined,
    String(req.query.institution || '') || undefined,
  );

  const rows = await buildStudentExportRows(scope, {
    institutionId: String(req.query.institutionId || '') || undefined,
    institution: String(req.query.institution || '') || undefined,
    batch: String(req.query.batch || '') || undefined,
    branch: String(req.query.branch || '') || undefined,
  });
  const format = String(req.query.format || 'csv');

  await logAdminAction({
    actor: req.user!,
    action: 'export.download',
    targetType: 'students',
    metadata: { format, rowCount: rows.length },
    req,
  });

  if (format === 'json') {
    res.json({ rows, count: rows.length });
    return;
  }

  const csv = rowsToCsv(rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="students-export.csv"');
  res.send(csv);
});

export const listAuditLogs = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit || '25'), 10) || 25));
  const filter: Record<string, unknown> = {};

  if (req.query.action) filter.action = String(req.query.action);
  if (req.query.actorId) filter.actorId = String(req.query.actorId);

  const [logs, total] = await Promise.all([
    AuditLog.find(filter)
      .populate('actorId', 'name email role')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    AuditLog.countDocuments(filter),
  ]);

  res.json({
    logs,
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  });
});
