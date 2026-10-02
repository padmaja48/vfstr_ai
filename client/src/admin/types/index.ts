/**
 * Admin Panel domain types.
 * Field names are aligned with the existing interview platform where useful
 * (e.g. targetCompany, score ≈ Interview.totalScore, institution linkage).
 */

export type ReadinessLevel = 'Beginner' | 'Intermediate' | 'Ready';
export type StudentStatus = 'active' | 'suspended' | 'banned';

export interface Student {
  id: string;
  name: string;
  email: string;
  institutionId: string;
  batchYear: number;
  readinessLevel: ReadinessLevel;
  /** Maps conceptually to user interview history / Interview.totalScore averages */
  totalInterviews: number;
  averageScore: number;
  status: StudentStatus;
  resumeId?: string;
  createdAt: string;
}

export interface Institution {
  id: string;
  name: string;
  contactEmail: string;
  studentCount: number;
  interviewCount: number;
  averageScore: number;
  placementReadinessPct: number;
  createdAt: string;
}

/** Aligns with platform Interview.interviewType / Mixed flows, extended for admin taxonomy */
export type AdminInterviewType = 'Technical' | 'HR' | 'Coding' | 'Behavioral' | 'Aptitude';
export type AdminInterviewStatus = 'live' | 'completed' | 'flagged' | 'abandoned' | 'terminated';

export interface InterviewAiFeedback {
  strengths: string[];
  improvements: string[];
}

export interface Interview {
  id: string;
  studentId: string;
  studentName: string;
  institutionId: string;
  /** Same concept as Interview.targetCompany on the server */
  targetCompany: string;
  type: AdminInterviewType;
  /** Same concept as Interview.totalScore (0–100) */
  score: number;
  /** Minutes — same concept as Interview.duration */
  duration: number;
  status: AdminInterviewStatus;
  date: string;
  questionsAsked: string[];
  aiFeedback: InterviewAiFeedback;
  transcriptExcerpt: string;
  violations?: Array<{ type: string; timestamp: string; description?: string }>;
  faceIncidents?: Array<{ type: 'no_face' | 'multiple_faces'; startedAt: string; endedAt?: string; durationMs: number; description?: string }>;
  terminationReason?: string;
  terminatedAt?: string;
  terminationQuestionIndex?: number;
}

export type QuestionCategory =
  | 'Company-specific'
  | 'Technical'
  | 'HR'
  | 'Coding'
  | 'Aptitude'
  | 'Behavioral';

export type QuestionDifficulty = 'Easy' | 'Medium' | 'Hard';
export type QuestionAuthor = 'admin' | 'ai';

export interface Question {
  id: string;
  text: string;
  category: QuestionCategory;
  difficulty: QuestionDifficulty;
  company?: string;
  createdBy: QuestionAuthor;
  usageCount: number;
}

export interface Resume {
  id: string;
  studentId: string;
  fileName: string;
  uploadedAt: string;
  atsScore: number;
  resumeScore: number;
  missingSkills: string[];
  weakSections: string[];
  jdMatchScore?: number;
}

export interface WeeklyActivityPoint {
  weekLabel: string;
  interviewCount: number;
  completedCount: number;
}

export interface ScoreDistributionBucket {
  label: string;
  min: number;
  max: number;
  count: number;
}

export interface WeaknessStat {
  label: string;
  count: number;
}

export interface StudentSkillBreakdown {
  studentId: string;
  studentName: string;
  technical: number;
  problemSolving: number;
  communication: number;
  confidence: number;
  answerRelevance: number;
  overall: number;
}

export interface PerformanceAggregates {
  weeklyActivity: WeeklyActivityPoint[];
  scoreDistribution: ScoreDistributionBucket[];
  topWeaknesses: WeaknessStat[];
  skillBreakdown: StudentSkillBreakdown[];
}

export interface Plan {
  id: string;
  name: string;
  price: number;
  interviewLimit: number;
  resumeScanLimit: number;
  activeSubscribers: number;
}

export type BillingStatus = 'paid' | 'pending' | 'failed' | 'refunded';

export interface BillingTransaction {
  id: string;
  planId: string;
  planName: string;
  institutionId: string;
  institutionName: string;
  amount: number;
  status: BillingStatus;
  billedAt: string;
  invoiceRef: string;
}

export type NotificationChannel = 'email' | 'in-app' | 'sms' | 'push';
export type NotificationStatus = 'draft' | 'scheduled' | 'sent' | 'failed';

export interface Notification {
  id: string;
  title: string;
  body: string;
  audience: string;
  channel: NotificationChannel;
  sentAt: string;
  status: NotificationStatus;
}

export type InstitutionAdminStatus = 'active' | 'invited' | 'suspended';
export type InstitutionAdminRoleScope = 'Institution Admin' | 'Placement Officer' | 'Coach' | 'Viewer';

export interface InstitutionAdmin {
  id: string;
  name: string;
  email: string;
  institutionId: string;
  institutionName: string;
  roleScope: InstitutionAdminRoleScope;
  status: InstitutionAdminStatus;
  invitedAt: string;
}
