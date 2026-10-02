import { Request } from 'express';
import { AuditAction, AuditLog } from '../models/AuditLog';
import { IUser } from '../models/User';
import { normalizeRole } from '../utils/roles';

type LogParams = {
  actor: IUser;
  action: AuditAction;
  targetType: string;
  targetId?: string;
  institutionId?: string;
  metadata?: Record<string, unknown>;
  req?: Request;
};

export const logAdminAction = async ({
  actor,
  action,
  targetType,
  targetId,
  institutionId,
  metadata,
  req,
}: LogParams) => {
  try {
    await AuditLog.create({
      actorId: actor._id,
      actorRole: normalizeRole(actor.role),
      action,
      targetType,
      targetId,
      institutionId: institutionId || actor.institutionId || undefined,
      metadata: metadata || {},
      ip: req?.ip,
      userAgent: req?.headers['user-agent'],
    });
  } catch (err) {
    console.warn('[auditLog] failed to write entry:', err);
  }
};
