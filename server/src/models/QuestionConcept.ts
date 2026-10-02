import mongoose, { Document, Model, Schema } from 'mongoose';
import { ROLE_CONCEPT_KEYS, type RoleConceptKey } from '../data/roleConceptCatalog';

export const CONCEPT_CATEGORIES = ['Technical', 'Culture', 'Coding', 'Behavioral'] as const;
export const CONCEPT_TIERS = ['high', 'medium', 'low'] as const;
export const CONCEPT_CREATED_BY = ['admin', 'ai'] as const;
export const CONCEPT_STATUSES = ['active', 'pending_review', 'archived', 'discarded'] as const;

export type ConceptCategory = (typeof CONCEPT_CATEGORIES)[number];
export type ConceptTier = (typeof CONCEPT_TIERS)[number];
export type ConceptCreatedBy = (typeof CONCEPT_CREATED_BY)[number];
export type ConceptStatus = (typeof CONCEPT_STATUSES)[number];

export interface IQuestionConcept extends Document {
  /** Company is optional for generic role-only concepts. */
  companySlug?: string;
  role?: RoleConceptKey;
  category: ConceptCategory;
  conceptLabel: string;
  tier: ConceptTier;
  status: ConceptStatus;
  createdBy: ConceptCreatedBy;
  createdByUserId?: mongoose.Types.ObjectId;
  usageCount: number;
  lastUsedAt?: Date;
  batchId?: mongoose.Types.ObjectId;
  genre?: string;
  specificity?: 'company' | 'industry' | 'mixed';
  /** Set when an admin edits label/category/tier — preserved across batch regeneration. */
  manuallyEditedAt?: Date;
  /** AI-generated label at creation time; used to detect silent label drift. */
  originalConceptLabel?: string;
}

const questionConceptSchema = new Schema<IQuestionConcept>(
  {
    companySlug: { type: String, trim: true, index: true },
    role: { type: String, enum: ROLE_CONCEPT_KEYS, trim: true, index: true },
    category: { type: String, enum: CONCEPT_CATEGORIES, required: true, index: true },
    conceptLabel: { type: String, required: true, trim: true, maxlength: 500 },
    tier: { type: String, enum: CONCEPT_TIERS, required: true, default: 'medium', index: true },
    status: { type: String, enum: CONCEPT_STATUSES, default: 'active', index: true },
    createdBy: { type: String, enum: CONCEPT_CREATED_BY, required: true, index: true },
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    usageCount: { type: Number, default: 0, min: 0 },
    lastUsedAt: { type: Date },
    batchId: { type: Schema.Types.ObjectId, ref: 'ConceptGenerationBatch', index: true },
    genre: { type: String, trim: true },
    specificity: { type: String, enum: ['company', 'industry', 'mixed'] },
    manuallyEditedAt: { type: Date },
    originalConceptLabel: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true },
);

questionConceptSchema.index({ companySlug: 1, status: 1, category: 1 });
questionConceptSchema.index({ role: 1, status: 1, category: 1 });
questionConceptSchema.pre('validate', function (next) {
  if (!this.companySlug && !this.role) {
    next(new Error('QuestionConcept requires companySlug or role'));
    return;
  }
  next();
});
questionConceptSchema.index({ status: 1, usageCount: 1, lastUsedAt: 1 });

export const QuestionConcept =
  (mongoose.models.QuestionConcept as Model<IQuestionConcept> | undefined)
  ?? mongoose.model<IQuestionConcept>('QuestionConcept', questionConceptSchema);

export const TIER_POOL_GUIDANCE: Record<ConceptTier, { min: number; max: number; label: string }> = {
  high: { min: 25, max: 30, label: 'High-traffic company (25–30 concepts recommended)' },
  medium: { min: 15, max: 20, label: 'Medium-traffic company (15–20 concepts recommended)' },
  low: { min: 8, max: 10, label: 'Low-traffic company (8–10 concepts recommended)' },
};
