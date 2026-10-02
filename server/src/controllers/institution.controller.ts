import { z } from 'zod';
import { Institution } from '../models/Institution';
import { User } from '../models/User';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import {
  ensureUniqueUsername,
  passwordFromUsername,
  usernameFromImportIdentity,
} from '../services/accountCredentials';
import { sendBulkWelcomeEmails } from '../services/bulkWelcomeEmail.service';
import { logAdminAction } from '../services/auditLog.service';
import {
  assertInstitutionIsActive,
  getInstitutionImpactCounts,
} from '../services/institutionImpact.service';
import { syncInstitutionsFromUserProfiles } from '../services/institutionSync.service';
import { isSuperAdminUser } from '../utils/roles';
import { assertInstitutionParamAllowed, resolveBulkImportInstitution, scopeFromRequest } from '../middleware/adminScope';

const ACTIVE_INSTITUTION_FILTER = { status: { $ne: 'archived' } };
export const createInstitutionSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(160),
    contactEmail: z.string().trim().email().toLowerCase().optional().or(z.literal('')),
  }),
});

export const institutionParamsSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
});

export const bulkImportStudentsSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
  body: z.object({
    // Keep rows intact so the controller can report malformed rows individually.
    students: z.array(z.unknown()).min(1).max(500),
  }),
});

export const archiveInstitutionSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
  body: z.object({
    confirmName: z.string().trim().min(1),
  }),
});

export const updateInstitutionSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
  body: z.object({
    name: z.string().trim().min(2).max(160).optional(),
    contactEmail: z.string().trim().email().toLowerCase().optional().or(z.literal('')),
  }),
});

const serializeInstitution = (doc: { toJSON?: () => Record<string, unknown> } | Record<string, unknown>) => {
  const json = (typeof (doc as { toJSON?: () => Record<string, unknown> }).toJSON === 'function'
    ? (doc as { toJSON: () => Record<string, unknown> }).toJSON()
    : { ...(doc as object) }) as Record<string, unknown>;
  return {
    id: String(json._id || json.id),
    name: json.name,
    contactEmail: json.contactEmail || '',
    createdAt: json.createdAt,
    updatedAt: json.updatedAt,
  };
};

export const listInstitutions = asyncHandler(async (req, res) => {
  if (isSuperAdminUser(req.user)) {
    await syncInstitutionsFromUserProfiles();
  }
  const rows = await Institution.find(ACTIVE_INSTITUTION_FILTER).sort({ name: 1 });
  res.json(rows.map(serializeInstitution));
});

export const createInstitution = asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const contactEmail = String(req.body.contactEmail || '').trim().toLowerCase();

  const existing = await Institution.findOne({
    name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
    ...ACTIVE_INSTITUTION_FILTER,
  });
  if (existing) {
    throw new AppError('An institution with this name already exists.', 409, 'INSTITUTION_EXISTS');
  }

  const archivedDuplicate = await Institution.findOne({
    name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
    status: 'archived',
  });
  if (archivedDuplicate) {
    throw new AppError(
      'An archived institution with this name already exists. Contact support to restore it or choose a different name.',
      409,
      'INSTITUTION_ARCHIVED_EXISTS',
    );
  }

  const created = await Institution.create({
    name,
    contactEmail,
  });

  await logAdminAction({
    actor: req.user!,
    action: 'institution.create',
    targetType: 'Institution',
    targetId: String(created._id),
    institutionId: String(created._id),
    metadata: { name },
    req,
  });

  res.status(201).json(serializeInstitution(created));
});

export const getInstitution = asyncHandler(async (req, res) => {
  const scope = scopeFromRequest(req);
  assertInstitutionParamAllowed(scope, String(req.params.id));

  const row = await Institution.findById(req.params.id);
  if (!row || row.status === 'archived') {
    throw new AppError('Institution not found', 404, 'INSTITUTION_NOT_FOUND');
  }
  res.json(serializeInstitution(row));
});

export const updateInstitution = asyncHandler(async (req, res) => {
  const row = await Institution.findById(req.params.id);
  if (!row || row.status === 'archived') {
    throw new AppError('Institution not found', 404, 'INSTITUTION_NOT_FOUND');
  }

  if (req.body.name) {
    const name = String(req.body.name).trim();
    const duplicate = await Institution.findOne({
      _id: { $ne: row._id },
      name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
      status: { $ne: 'archived' },
    });
    if (duplicate) {
      throw new AppError('An institution with this name already exists.', 409, 'INSTITUTION_EXISTS');
    }
    row.name = name;
  }

  if (req.body.contactEmail !== undefined) {
    row.contactEmail = String(req.body.contactEmail || '').trim().toLowerCase();
  }

  await row.save();

  await logAdminAction({
    actor: req.user!,
    action: 'institution.update',
    targetType: 'Institution',
    targetId: String(row._id),
    institutionId: String(row._id),
    metadata: { name: row.name },
    req,
  });

  res.json(serializeInstitution(row));
});

export const getInstitutionDeletionImpact = asyncHandler(async (req, res) => {
  const row = await Institution.findById(req.params.id);
  if (!row || row.status === 'archived') {
    throw new AppError('Institution not found', 404, 'INSTITUTION_NOT_FOUND');
  }

  const impact = await getInstitutionImpactCounts(row);
  res.json({
    institution: serializeInstitution(row),
    ...impact,
  });
});

export const archiveInstitution = asyncHandler(async (req, res) => {
  const row = await Institution.findById(req.params.id);
  if (!row || row.status === 'archived') {
    throw new AppError('Institution not found', 404, 'INSTITUTION_NOT_FOUND');
  }

  const confirmName = String(req.body.confirmName || '').trim();
  if (confirmName !== row.name) {
    throw new AppError(
      'Confirmation name does not match the institution name.',
      400,
      'INSTITUTION_CONFIRM_MISMATCH',
    );
  }

  const impact = await getInstitutionImpactCounts(row);
  row.status = 'archived';
  row.archivedAt = new Date();
  await row.save();

  await logAdminAction({
    actor: req.user!,
    action: 'institution.archive',
    targetType: 'Institution',
    targetId: String(row._id),
    institutionId: String(row._id),
    metadata: {
      name: row.name,
      ...impact,
    },
    req,
  });

  res.json({
    institution: serializeInstitution(row),
    archived: true,
    impact,
    message:
      impact.studentCount || impact.interviewCount
        ? 'Institution archived. Linked students and interview history are preserved.'
        : 'Institution archived.',
  });
});

/**
 * Admin: create many student accounts under one institution.
 * Every student gets a generated username/password and must complete account setup on first login.
 */
export const bulkImportStudents = asyncHandler(async (req, res) => {
  const scope = scopeFromRequest(req);
  const institutionId = String(req.params.id);
  const assignment = await resolveBulkImportInstitution(scope, institutionId);
  const institution = await Institution.findById(assignment.institutionId);
  if (!institution) {
    throw new AppError('Institution not found', 404, 'INSTITUTION_NOT_FOUND');
  }
  assertInstitutionIsActive(institution);

  const students = Array.isArray(req.body.students) ? req.body.students : [];
  const created: Array<{
    id: string;
    name: string;
    email: string;
    username: string;
    password: string;
  }> = [];
  const skipped: Array<{ email: string; reason: string }> = [];
  const failed: Array<{ row: number; reason: string }> = [];
  const seen = new Set<string>();

  for (const [index, rawRow] of students.entries()) {
    const row = index + 1;
    const source = rawRow && typeof rawRow === 'object'
      ? rawRow as Record<string, unknown>
      : {};
    const name = typeof source.name === 'string' ? source.name.trim() : '';
    const rollNumberRaw =
      source.rollNumber ?? source.rollnumber ?? source.roll ?? source['Roll Number'] ?? source['roll number'];
    const rollNumber = typeof rollNumberRaw === 'string' || typeof rollNumberRaw === 'number'
      ? String(rollNumberRaw).trim()
      : '';
    const email = typeof source.email === 'string' ? source.email.trim().toLowerCase() : '';
    if (name.length < 2 || name.length > 120) {
      failed.push({ row, reason: 'Name must be between 2 and 120 characters' });
      continue;
    }
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

      const username = await ensureUniqueUsername(
        usernameFromImportIdentity({ name, rollNumber, email }),
      );
      const password = passwordFromUsername(username);

      const user = await User.create({
        name,
        email,
        username,
        password,
        role: 'student',
        institution: institution.name,
        institutionId: institution._id,
        isEmailVerified: true,
        authProvider: 'email',
        requiresAccountSetup: true,
      });

      created.push({
        id: String(user._id),
        name: user.name,
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

  const emailFailures = await sendBulkWelcomeEmails(
    created.map((account) => ({
      studentId: account.id,
      email: account.email,
      username: account.username,
      password: account.password,
      name: account.name,
      institutionName: institution.name,
    })),
  );

  res.status(201).json({
    institution: serializeInstitution(institution),
    institutionId: String(institution._id),
    institutionName: institution.name,
    createdCount: created.length,
    skippedCount: skipped.length,
    failedCount: failed.length,
    emailFailureCount: emailFailures.length,
    created,
    skipped,
    failed,
    emailFailures,
    passwordFormula: '<username>@PV2913',
    message:
      'Students can sign in with their generated username (roll number or name from import) and password (<username>@PV2913) and will be prompted to complete account setup.'
      + (emailFailures.length
        ? ` ${emailFailures.length} welcome email${emailFailures.length === 1 ? '' : 's'} could not be sent — share credentials manually.`
        : created.length
          ? ' Welcome emails were sent to new students.'
          : ''),
  });
});
