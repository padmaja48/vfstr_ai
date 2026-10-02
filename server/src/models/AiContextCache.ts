import mongoose, { Document, Model, Schema } from 'mongoose';

export type AiContextCacheKind = 'resume_analysis' | 'job_description_profile' | 'company_question_bank';

export interface IAiContextCache extends Document {
  cacheKey: string;
  kind: AiContextCacheKind;
  userId?: mongoose.Types.ObjectId;
  contentHash: string;
  companySlug?: string;
  role?: string;
  bankVersion?: string;
  payload: Record<string, unknown>;
  expiresAt: Date;
}

const aiContextCacheSchema = new Schema<IAiContextCache>(
  {
    cacheKey: { type: String, required: true, unique: true, index: true },
    kind: {
      type: String,
      enum: ['resume_analysis', 'job_description_profile', 'company_question_bank'],
      required: true,
      index: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    contentHash: { type: String, required: true, index: true },
    companySlug: { type: String, index: true },
    role: { type: String, index: true },
    bankVersion: { type: String },
    payload: { type: Schema.Types.Mixed, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

aiContextCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AiContextCache =
  (mongoose.models.AiContextCache as Model<IAiContextCache> | undefined)
  ?? mongoose.model<IAiContextCache>('AiContextCache', aiContextCacheSchema);
