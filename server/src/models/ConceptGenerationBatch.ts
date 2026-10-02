import mongoose, { Document, Model, Schema } from 'mongoose';

export const BATCH_STATUSES = ['queued', 'running', 'completed', 'partial', 'failed', 'cancelled'] as const;
export type ConceptBatchStatus = (typeof BATCH_STATUSES)[number];
export type ConceptBatchScope = 'pilot' | 'full' | 'custom';
export type ConceptBatchTargetType = 'company' | 'role';

export type ConceptBatchFailure = {
  companySlug: string;
  companyLabel: string;
  error: string;
};

export type ConceptCategoryShortfall = {
  category: string;
  expected: number;
  actual: number;
  shortBy: number;
};

export type ConceptBatchPartialTarget = {
  companySlug: string;
  companyLabel: string;
  categoryShortfalls: ConceptCategoryShortfall[];
  message: string;
};

export interface IConceptGenerationBatch extends Document {
  scope: ConceptBatchScope;
  targetType: ConceptBatchTargetType;
  status: ConceptBatchStatus;
  totalCompanies: number;
  completedCompanies: number;
  failedCompanies: ConceptBatchFailure[];
  partialTargets: ConceptBatchPartialTarget[];
  companySlugs: string[];
  roleKeys: string[];
  createdByUserId?: mongoose.Types.ObjectId;
  startedAt?: Date;
  completedAt?: Date;
}

const conceptGenerationBatchSchema = new Schema<IConceptGenerationBatch>(
  {
    scope: { type: String, enum: ['pilot', 'full', 'custom'], required: true },
    targetType: { type: String, enum: ['company', 'role'], default: 'company', index: true },
    status: { type: String, enum: BATCH_STATUSES, default: 'queued', index: true },
    totalCompanies: { type: Number, required: true, min: 0 },
    completedCompanies: { type: Number, default: 0, min: 0 },
    failedCompanies: [
      {
        companySlug: String,
        companyLabel: String,
        error: String,
      },
    ],
    partialTargets: {
      type: [
        {
          companySlug: String,
          companyLabel: String,
          categoryShortfalls: [
            {
              category: String,
              expected: Number,
              actual: Number,
              shortBy: Number,
            },
          ],
          message: String,
        },
      ],
      default: [],
    },
    companySlugs: { type: [String], default: [] },
    roleKeys: { type: [String], default: [] },
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    startedAt: Date,
    completedAt: Date,
  },
  { timestamps: true },
);

export const ConceptGenerationBatch =
  (mongoose.models.ConceptGenerationBatch as Model<IConceptGenerationBatch> | undefined)
  ?? mongoose.model<IConceptGenerationBatch>('ConceptGenerationBatch', conceptGenerationBatchSchema);
