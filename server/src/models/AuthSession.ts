import mongoose, { Document, Model, Schema } from 'mongoose';

export interface IAuthSession extends Document {
  userId: mongoose.Types.ObjectId;
  sessionId: string;
  refreshTokenHash: string;
  userAgent?: string;
  ip?: string;
  revokedAt?: Date;
  expiresAt: Date;
}

const authSessionSchema = new Schema<IAuthSession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sessionId: { type: String, required: true, unique: true, index: true },
    refreshTokenHash: { type: String, required: true },
    userAgent: String,
    ip: String,
    revokedAt: Date,
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true },
);

export const AuthSession =
  (mongoose.models.AuthSession as Model<IAuthSession> | undefined) ??
  mongoose.model<IAuthSession>('AuthSession', authSessionSchema);
