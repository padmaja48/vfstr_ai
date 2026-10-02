import mongoose, { Document, Model, Schema } from 'mongoose';

export interface IReport extends Document {
  userId: mongoose.Types.ObjectId;
  interviewId?: mongoose.Types.ObjectId;
  reportUrl?: string;
  communicationScore: number;
  technicalScore: number;
  behavioralScore: number;
  confidenceScore?: number;
  grammarScore?: number;
  vocabularyScore?: number;
  domainExpertiseScore?: number;
  overallScore: number;
  strengths: string[];
  improvements: string[];
  recommendations: string[];
  transcriptSummary?: string;
  questionAnalysis: unknown[];
  skillWiseStrengths?: unknown[];
  areasForImprovement?: string[];
  missedConcepts?: string[];
  recommendedLearningResources?: string[];
  difficultyProgression?: string[];
  questionTimeline?: unknown[];
  followUpQuality?: string;
  hiringRecommendation?: string;
  hiringRecommendationReason?: string;
  speakerName?: string;
  accountOwnerName?: string;
  companyReadinessScore?: number;
  totalPlannedQuestions?: number;
  questionsAttempted?: number;
  questionsAnswered?: number;
  endedEarly?: boolean;
  endReason?: string;
  terminationReason?: string;
  scoreConfidenceNote?: string;
  sessionNote?: string;
}

const reportSchema = new Schema<IReport>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    interviewId: { type: Schema.Types.ObjectId, ref: 'Interview', index: true },
    reportUrl: String,
    communicationScore: { type: Number, required: true },
    technicalScore: { type: Number, required: true },
    behavioralScore: { type: Number, required: true },
    confidenceScore: Number,
    grammarScore: Number,
    vocabularyScore: Number,
    domainExpertiseScore: Number,
    overallScore: { type: Number, required: true },
    strengths: { type: [String], default: [] },
    improvements: { type: [String], default: [] },
    recommendations: { type: [String], default: [] },
    transcriptSummary: String,
    questionAnalysis: { type: Schema.Types.Mixed, default: [] },
    skillWiseStrengths: { type: Schema.Types.Mixed, default: [] },
    areasForImprovement: { type: [String], default: [] },
    missedConcepts: { type: [String], default: [] },
    recommendedLearningResources: { type: [String], default: [] },
    difficultyProgression: { type: [String], default: [] },
    questionTimeline: { type: Schema.Types.Mixed, default: [] },
    followUpQuality: String,
    hiringRecommendation: String,
    hiringRecommendationReason: String,
    speakerName: String,
    accountOwnerName: String,
    companyReadinessScore: Number,
    totalPlannedQuestions: Number,
    questionsAttempted: Number,
    questionsAnswered: Number,
    endedEarly: Boolean,
    endReason: String,
    terminationReason: String,
    scoreConfidenceNote: String,
    sessionNote: String,
  },
  { timestamps: true },
);

export const Report =
  (mongoose.models.Report as Model<IReport> | undefined) ??
  mongoose.model<IReport>('Report', reportSchema);
