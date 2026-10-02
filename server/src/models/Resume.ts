import mongoose, { Document, Model, Schema } from 'mongoose';

export interface IResume extends Document {
  userId: mongoose.Types.ObjectId;
  fileUrl: string;
  filePublicId?: string;
  fileName: string;
  rawText?: string;
  contentHash?: string;   // SHA-256 of normalised text — detects duplicate uploads
  analysis: {
    summary?: string;
    skills: string[];
    experienceLevel?: string;
    yearsOfExperience?: number;
    score?: number;
    strengths: string[];
    gaps: string[];
    suggestedQuestions: string[];
  };
}

const resumeSchema = new Schema<IResume>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    fileUrl: { type: String, required: true },
    filePublicId: String,
    fileName: { type: String, required: true },
    rawText: String,
    contentHash: { type: String, index: true },
    analysis: {
      summary: String,
      skills: { type: [String], default: [] },
      experienceLevel: String,
      yearsOfExperience: Number,
      score: Number,
      strengths: { type: [String], default: [] },
      gaps: { type: [String], default: [] },
      suggestedQuestions: { type: [String], default: [] },
    },
  },
  { timestamps: true },
);

export const Resume =
  (mongoose.models.Resume as Model<IResume> | undefined) ??
  mongoose.model<IResume>('Resume', resumeSchema);
