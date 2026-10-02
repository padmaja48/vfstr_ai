import mongoose, { Document, Model, Schema } from 'mongoose';

export const QUESTION_CATEGORIES = [
  'Company-specific',
  'Technical',
  'HR',
  'Coding',
  'Aptitude',
  'Behavioral',
] as const;

export const QUESTION_DIFFICULTIES = ['Easy', 'Medium', 'Hard'] as const;
export const QUESTION_CREATED_BY = ['admin', 'ai', 'migrated'] as const;
export const QUESTION_STATUSES = ['active', 'archived'] as const;

export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number];
export type QuestionDifficulty = (typeof QUESTION_DIFFICULTIES)[number];
export type QuestionCreatedBy = (typeof QUESTION_CREATED_BY)[number];
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export interface IQuestionEditHistory {
  text: string;
  editedBy: mongoose.Types.ObjectId;
  editedAt: Date;
}

export interface IQuestion extends Document {
  text: string;
  normalizedText: string;
  category: QuestionCategory;
  difficulty: QuestionDifficulty;
  company?: string;
  companySlug?: string;
  tags: string[];
  role?: string;
  experienceLevel?: 'fresher' | 'experienced';
  source?: string;
  createdBy: QuestionCreatedBy;
  createdByUserId?: mongoose.Types.ObjectId;
  usageCount: number;
  status: QuestionStatus;
  editHistory: IQuestionEditHistory[];
}

const editHistorySchema = new Schema<IQuestionEditHistory>(
  {
    text: { type: String, required: true },
    editedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    editedAt: { type: Date, required: true, default: Date.now },
  },
  { _id: false },
);

const questionSchema = new Schema<IQuestion>(
  {
    text: { type: String, required: true, trim: true, maxlength: 8000 },
    normalizedText: { type: String, required: true, index: true },
    category: { type: String, enum: QUESTION_CATEGORIES, required: true, index: true },
    difficulty: { type: String, enum: QUESTION_DIFFICULTIES, required: true, index: true },
    company: { type: String, trim: true, index: true },
    companySlug: { type: String, trim: true, index: true },
    tags: { type: [String], default: [] },
    role: { type: String, trim: true, index: true },
    experienceLevel: { type: String, enum: ['fresher', 'experienced'], index: true },
    source: { type: String, trim: true },
    createdBy: { type: String, enum: QUESTION_CREATED_BY, required: true, index: true },
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    usageCount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: QUESTION_STATUSES, default: 'active', index: true },
    editHistory: { type: [editHistorySchema], default: [] },
  },
  { timestamps: true },
);

questionSchema.index({ status: 1, category: 1, difficulty: 1 });
questionSchema.index({ status: 1, companySlug: 1, role: 1, experienceLevel: 1 });

export const Question =
  (mongoose.models.Question as Model<IQuestion> | undefined)
  ?? mongoose.model<IQuestion>('Question', questionSchema);
