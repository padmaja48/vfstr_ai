import mongoose, { Document, Model, Schema } from 'mongoose';

export type InterviewStatus = 'Setup' | 'In Progress' | 'Completed' | 'Pending Review' | 'Cancelled' | 'Terminated';
export type InterviewMode = 'sde' | 'frontend' | 'backend' | 'data_analyst' | 'ai_ml' | 'qa' | 'hr_behavioral';

export interface IInterviewQuestion {
  question: string;
  questionId?: string;
  conceptId?: string;
  bankQuestionId?: string;
  expectedSignals?: string[];
  userAnswer?: string;
  transcriptUrl?: string;
  feedback?: string;
  score?: number;
  idealAnswer?: string;
  samplePerfectAnswer?: string;
  conceptsCovered?: string[];
  missingConcepts?: string[];
  incorrectStatements?: string[];
  wrongTerminology?: string[];
  technicalMistakes?: string[];
  dynamicFeedback?: unknown;
  questionType?: 'behavioural' | 'technical' | 'situational';
  resumeReference?: string;
  difficulty?: 'easy' | 'easy-medium' | 'medium' | 'medium-hard' | 'scenario' | 'problem-solving' | 'behavioral';
  topic?: string;
  followUpIntent?: 'deepen' | 'clarify' | 'bridge-topic' | 'challenge' | 'recover-confidence';
}

export interface IInterviewViolation {
  type: string;
  timestamp: Date;
  description: string;
}

export interface IInterviewFaceIncident {
  type: 'no_face' | 'multiple_faces';
  startedAt: Date;
  durationMs: number;
  endedAt?: Date;
  description?: string;
}

export interface IInterview extends Document {
  userId: mongoose.Types.ObjectId;
  resumeId?: mongoose.Types.ObjectId;
  resumeUrl?: string;
  resumeText?: string;
  jobDescription?: string;
  roleLevel: 'Fresher' | 'Mid' | 'Senior' | 'Lead';
  roleDomain: string;
  interviewStyle: string;
  duration: number;
  questions: IInterviewQuestion[];
  askedQuestionIds: string[];
  askedConceptIds: string[];
  currentQuestionIndex: number;
  recordingUrl?: string;
  reportUrl?: string;
  totalScore?: number;
  scores: {
    communication?: number;
    technical?: number;
    behavioral?: number;
  };
  feedbackSummary: {
    strengths: string[];
    improvements: string[];
    overallFeedback?: string;
  };
  status: InterviewStatus;
  startedAt?: Date;
  completedAt?: Date;
  terminatedAt?: Date;
  terminationReason?: string;
  terminationQuestionIndex?: number;
  personaId?: 'us-american' | 'us-indian' | 'us-australian' | 'ru-russian';
  interviewType?: 'Behavioural' | 'Technical' | 'Mixed';
  interviewMode?: InterviewMode;
  complexity?: 'Beginner' | 'Intermediate' | 'Advanced';
  networkQualityTier?: 'good' | 'fair' | 'poor';
  targetCompany?: string;
  violations: IInterviewViolation[];
  faceIncidents: IInterviewFaceIncident[];
  resumeSkills: string[];
  resumeExperienceLevel?: string;
  resumeSuggestedQuestions: string[];
  resumeSummary?: string;
  jdProfile?: unknown;
  companyGuidance?: unknown;
  companyQuestionSource?: 'verified' | 'web_research' | 'role_based' | 'generic' | 'none';
  roleQuestionSource?: 'concept_pool' | 'none';
  companyQuestionComposition?: {
    culture?: number;
    technical?: number;
    coding?: number;
  };
  companyQuestionBank?: unknown;
  interviewRoadmap?: unknown;
  interviewState?: unknown;
  liveScores?: {
    confidence?: number;
    completeness?: number;
    depth?: number;
    terminology?: number;
    grammar?: number;
    vocabulary?: number;
    domain?: number;
  };
  totalPlannedQuestions?: number;
  speakerName?: string;
  speakerNameConfidence?: 'high' | 'medium' | 'low';
  accountOwnerName?: string;
}

const interviewQuestionSchema = new Schema<IInterviewQuestion>(
  {
    question: { type: String, required: true },
    questionId: String,
    conceptId: String,
    bankQuestionId: String,
    expectedSignals: [String],
    userAnswer: String,
    transcriptUrl: String,
    feedback: String,
    score: Number,
    idealAnswer: String,
    samplePerfectAnswer: String,
    conceptsCovered: [String],
    missingConcepts: [String],
    incorrectStatements: [String],
    wrongTerminology: [String],
    technicalMistakes: [String],
    dynamicFeedback: { type: Schema.Types.Mixed },
    questionType: { type: String, enum: ['behavioural', 'technical', 'situational'] },
    resumeReference: String,
    difficulty: { type: String, enum: ['easy', 'easy-medium', 'medium', 'medium-hard', 'scenario', 'problem-solving', 'behavioral'] },
    topic: String,
    followUpIntent: { type: String, enum: ['deepen', 'clarify', 'bridge-topic', 'challenge', 'recover-confidence'] },
  },
  { _id: false },
);

const interviewSchema = new Schema<IInterview>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    resumeId: { type: Schema.Types.ObjectId, ref: 'Resume' },
    resumeUrl: String,
    resumeText: String,
    jobDescription: { type: String, trim: true },
    roleLevel: { type: String, enum: ['Fresher', 'Mid', 'Senior', 'Lead'], required: true },
    roleDomain: { type: String, required: true },
    interviewStyle: { type: String, default: 'Mixed' },
    duration: { type: Number, enum: [15, 20, 30, 45, 60], default: 30 },
    questions: [interviewQuestionSchema],
    askedQuestionIds: { type: [String], default: [] },
    askedConceptIds: { type: [String], default: [] },
    currentQuestionIndex: { type: Number, default: 0 },
    recordingUrl: String,
    reportUrl: String,
    totalScore: Number,
    scores: {
      communication: Number,
      technical: Number,
      behavioral: Number,
    },
    feedbackSummary: {
      strengths: { type: [String], default: [] },
      improvements: { type: [String], default: [] },
      overallFeedback: String,
    },
    status: {
      type: String,
      enum: ['Setup', 'In Progress', 'Completed', 'Pending Review', 'Cancelled', 'Terminated'],
      default: 'Setup',
      index: true,
    },
    startedAt: Date,
    completedAt: Date,
    terminatedAt: Date,
    terminationReason: String,
    terminationQuestionIndex: Number,
    personaId: { type: String, enum: ['us-american', 'us-indian', 'us-australian', 'ru-russian'] },
    interviewType: { type: String, enum: ['Behavioural', 'Technical', 'Mixed'], default: 'Mixed' },
    interviewMode: { type: String, enum: ['sde', 'frontend', 'backend', 'data_analyst', 'ai_ml', 'qa', 'hr_behavioral'], default: 'sde' },
    complexity: { type: String, enum: ['Beginner', 'Intermediate', 'Advanced'], default: 'Intermediate' },
    networkQualityTier: { type: String, enum: ['good', 'fair', 'poor'] },
    targetCompany: { type: String, trim: true, lowercase: true },
    violations: [
      {
        type: { type: String },
        timestamp: { type: Date, default: Date.now },
        description: String,
      },
    ],
    faceIncidents: [
      {
        type: { type: String, enum: ['no_face', 'multiple_faces'], required: true },
        startedAt: { type: Date, required: true },
        durationMs: { type: Number, required: true, min: 0 },
        endedAt: Date,
        description: String,
      },
    ],
    resumeSkills: { type: [String], default: [] },
    resumeExperienceLevel: String,
    resumeSuggestedQuestions: { type: [String], default: [] },
    resumeSummary: String,
    jdProfile: { type: Schema.Types.Mixed },
    companyGuidance: { type: Schema.Types.Mixed },
    companyQuestionSource: {
      type: String,
      enum: ['verified', 'web_research', 'role_based', 'generic', 'concept_pool', 'none'],
    },
    roleQuestionSource: {
      type: String,
      enum: ['concept_pool', 'none'],
    },
    companyQuestionComposition: {
      culture: Number,
      technical: Number,
      coding: Number,
    },
    companyQuestionBank: { type: Schema.Types.Mixed },
    interviewRoadmap: { type: Schema.Types.Mixed },
    interviewState: { type: Schema.Types.Mixed },
    liveScores: {
      confidence: Number,
      completeness: Number,
      depth: Number,
      terminology: Number,
      grammar: Number,
      vocabulary: Number,
      domain: Number,
    },
    totalPlannedQuestions: Number,
    speakerName: { type: String, trim: true },
    speakerNameConfidence: { type: String, enum: ['high', 'medium', 'low'] },
    accountOwnerName: { type: String, trim: true },
  },
  { timestamps: true },
);

export const Interview =
  (mongoose.models.Interview as Model<IInterview> | undefined) ??
  mongoose.model<IInterview>('Interview', interviewSchema);
