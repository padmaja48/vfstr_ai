import mongoose, { Document, Model, Schema } from 'mongoose';

export type AuditAction =
  | 'user.create'
  | 'user.update'
  | 'user.delete'
  | 'user.bulk_import'
  | 'user.bulk_delete'
  | 'user.bulk_deactivate'
  | 'user.terminate'
  | 'user.reactivate'
  | 'admin.create'
  | 'admin.update'
  | 'admin.delete'
  | 'institution.create'
  | 'institution.update'
  | 'institution.archive'
  | 'export.download';

export interface IAuditLog extends Document {
  actorId: mongoose.Types.ObjectId;
  actorRole: string;
  action: AuditAction;
  targetType: string;
  targetId?: string;
  institutionId?: mongoose.Types.ObjectId;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    actorRole: { type: String, required: true },
    action: { type: String, required: true, index: true },
    targetType: { type: String, required: true },
    targetId: { type: String, index: true },
    institutionId: { type: Schema.Types.ObjectId, ref: 'Institution', index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    ip: String,
    userAgent: String,
  },
  { timestamps: true },
);

export const AuditLog =
  (mongoose.models.AuditLog as Model<IAuditLog> | undefined)
  ?? mongoose.model<IAuditLog>('AuditLog', auditLogSchema);
