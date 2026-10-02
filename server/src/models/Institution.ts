import mongoose, { Document, Model, Schema } from 'mongoose';

export type InstitutionPlanTier = 'Starter' | 'Campus Standard' | 'Campus Pro' | 'Enterprise';
export type InstitutionStatus = 'active' | 'archived';

export interface IInstitution extends Document {
  name: string;
  contactEmail: string;
  /** Legacy billing field — not used in admin UI; optional on create. */
  planTier?: InstitutionPlanTier;
  status: InstitutionStatus;
  archivedAt?: Date;
}

interface InstitutionModel extends Model<IInstitution> {}

const institutionSchema = new Schema<IInstitution>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      maxlength: 160,
      index: true,
    },
    contactEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
      maxlength: 254,
    },
    planTier: {
      type: String,
      enum: ['Starter', 'Campus Standard', 'Campus Pro', 'Enterprise'],
      default: 'Campus Standard',
    },
    status: {
      type: String,
      enum: ['active', 'archived'],
      default: 'active',
      index: true,
    },
    archivedAt: { type: Date },
  },
  { timestamps: true },
);

export const Institution =
  (mongoose.models.Institution as InstitutionModel | undefined) ??
  mongoose.model<IInstitution, InstitutionModel>('Institution', institutionSchema);
