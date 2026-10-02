import mongoose from 'mongoose';
import { Interview } from '../models/Interview';
import { Institution } from '../models/Institution';
import { Report } from '../models/Report';
import { Schedule } from '../models/Schedule';
import { User } from '../models/User';
import { AdminScope, institutionQueryFilter, userFilterForScope } from '../middleware/adminScope';

export type InstitutionAnalytics = {
  institutionId?: string;
  institutionName?: string;
  scope: 'global' | 'institution';
  totals: {
    students: number;
    interviews: number;
    completedInterviews: number;
    scheduledInterviews: number;
    cancelledInterviews: number;
    terminatedInterviews: number;
    reports: number;
  };
  scores: {
    highest: number;
    lowest: number;
    average: number;
    technicalAverage: number;
    communicationAverage: number;
    readinessScore: number;
  };
  statusBreakdown: Record<string, number>;
};

const avg = (values: number[]) => {
  const nums = values.filter((n) => Number.isFinite(n));
  if (!nums.length) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
};

export const computeInstitutionAnalytics = async (
  scope: AdminScope,
  options: {
    institutionId?: string;
    institution?: string;
    batch?: string;
    branch?: string;
  } = {},
): Promise<InstitutionAnalytics> => {
  const instFilter = institutionQueryFilter(scope, options.institutionId, options.institution);
  const userFilter = userFilterForScope(scope, {
    role: { $in: ['student', 'candidate'] },
    ...(options.batch ? { batch: options.batch } : {}),
    ...(options.branch ? { branch: options.branch } : {}),
    ...(instFilter || {}),
  });

  const students = await User.find(userFilter).select('_id averageScore institution institutionId').lean();
  const userIds = students.map((s) => s._id as mongoose.Types.ObjectId);

  const [interviews, schedules, reports] = await Promise.all([
    userIds.length
      ? Interview.find({ userId: { $in: userIds } }).select('status totalScore scores userId').lean()
      : Promise.resolve([]),
    userIds.length
      ? Schedule.find({ userId: { $in: userIds } }).select('status userId').lean()
      : Promise.resolve([]),
    userIds.length
      ? Report.find({ userId: { $in: userIds } }).select('overallScore technicalScore communicationScore userId').lean()
      : Promise.resolve([]),
  ]);

  const interviewScores = interviews
    .map((iv) => Number(iv.totalScore))
    .filter((n) => Number.isFinite(n) && n > 0);
  const reportScores = reports.map((r) => Number(r.overallScore)).filter((n) => Number.isFinite(n));
  const allScores = interviewScores.length ? interviewScores : reportScores;

  const statusBreakdown: Record<string, number> = {};
  interviews.forEach((iv) => {
    const key = String(iv.status || 'Unknown');
    statusBreakdown[key] = (statusBreakdown[key] || 0) + 1;
  });

  const techScores = reports.map((r) => Number(r.technicalScore)).filter(Number.isFinite);
  const commScores = reports.map((r) => Number(r.communicationScore)).filter(Number.isFinite);

  let institutionId = scope.type === 'institution'
    ? (options.institutionId && scope.institutionIds.some((id) => String(id) === options.institutionId)
      ? options.institutionId
      : String(scope.institutionIds[0] || ''))
    : options.institutionId;
  let institutionName = scope.type === 'institution'
    ? (options.institution
      ? options.institution
      : scope.institutionNames.join(', '))
    : undefined;

  if (scope.type === 'global' && options.institutionId && mongoose.Types.ObjectId.isValid(options.institutionId)) {
    const inst = await Institution.findById(options.institutionId).select('name').lean();
    if (inst) {
      institutionId = options.institutionId;
      institutionName = inst.name;
    }
  } else if (scope.type === 'global' && options.institution) {
    institutionName = options.institution;
  }

  return {
    institutionId,
    institutionName,
    scope: scope.type === 'institution' ? 'institution' : (instFilter ? 'institution' : 'global'),
    totals: {
      students: students.length,
      interviews: interviews.length,
      completedInterviews: interviews.filter((iv) => iv.status === 'Completed').length,
      scheduledInterviews: schedules.filter((s) => s.status === 'Scheduled' || s.status === 'Rescheduled').length,
      cancelledInterviews: interviews.filter((iv) => iv.status === 'Cancelled').length,
      terminatedInterviews: interviews.filter((iv) => iv.status === 'Terminated').length,
      reports: reports.length,
    },
    scores: {
      highest: allScores.length ? Math.max(...allScores) : 0,
      lowest: allScores.length ? Math.min(...allScores) : 0,
      average: avg(allScores),
      technicalAverage: avg(techScores),
      communicationAverage: avg(commScores),
      readinessScore: avg(students.map((s) => Number(s.averageScore) || 0)),
    },
    statusBreakdown,
  };
};

/** Super-admin: metrics for every active institution (for comparison dashboards). */
export const computeInstitutionComparison = async () => {
  const globalScope: AdminScope = { type: 'global' };
  const institutions = await Institution.find({ status: 'active' }).sort({ name: 1 }).lean();
  const rows = await Promise.all(
    institutions.map(async (inst) => {
      const analytics = await computeInstitutionAnalytics(globalScope, {
        institutionId: String(inst._id),
      });
      return {
        institutionId: String(inst._id),
        institutionName: inst.name,
        ...analytics,
      };
    }),
  );
  return { institutions: rows, generatedAt: new Date().toISOString() };
};

export type Candidate360Report = {
  user: Record<string, unknown>;
  interviews: unknown[];
  reports: unknown[];
  schedules: unknown[];
  terminationHistory: unknown[];
  aggregates: {
    totalInterviews: number;
    completedInterviews: number;
    averageScore: number;
    technicalAverage: number;
    communicationAverage: number;
    readinessScore: number;
    strengths: string[];
    weaknesses: string[];
    improvements: string[];
    scoreHistory: Array<{ date: string; score: number; interviewId: string; company?: string }>;
  };
};

export const buildCandidate360 = async (userId: string): Promise<Candidate360Report> => {
  const user = await User.findById(userId).select('-password').lean();
  if (!user) throw new Error('USER_NOT_FOUND');

  const [interviews, reports, schedules] = await Promise.all([
    Interview.find({ userId }).sort({ createdAt: -1 }).lean(),
    Report.find({ userId }).sort({ createdAt: -1 }).lean(),
    Schedule.find({ userId }).sort({ scheduledFor: -1 }).lean(),
  ]);

  const reportScores = reports.map((r) => Number(r.overallScore)).filter(Number.isFinite);
  const techScores = reports.map((r) => Number(r.technicalScore)).filter(Number.isFinite);
  const commScores = reports.map((r) => Number(r.communicationScore)).filter(Number.isFinite);

  const strengthSet = new Set<string>();
  const weaknessSet = new Set<string>();
  const improvementSet = new Set<string>();

  reports.slice(0, 5).forEach((r) => {
    (r.strengths || []).forEach((s: string) => strengthSet.add(s));
    (r.areasForImprovement || r.improvements || []).forEach((s: string) => weaknessSet.add(s));
    (r.recommendations || []).forEach((s: string) => improvementSet.add(s));
  });

  interviews.slice(0, 5).forEach((iv) => {
    (iv.feedbackSummary?.strengths || []).forEach((s: string) => strengthSet.add(s));
    (iv.feedbackSummary?.improvements || []).forEach((s: string) => weaknessSet.add(s));
  });

  const scoreHistory = interviews
    .filter((iv) => Number.isFinite(Number(iv.totalScore)) && Number(iv.totalScore) > 0)
    .map((iv) => ({
      date: String(iv.completedAt || iv.startedAt || (iv as { createdAt?: Date }).createdAt),
      score: Number(iv.totalScore),
      interviewId: String(iv._id),
      company: iv.targetCompany,
    }))
    .reverse();

  return {
    user,
    interviews,
    reports,
    schedules,
    terminationHistory: user.terminationHistory || [],
    aggregates: {
      totalInterviews: interviews.length,
      completedInterviews: interviews.filter((iv) => iv.status === 'Completed').length,
      averageScore: reportScores.length ? avg(reportScores) : Number(user.averageScore) || 0,
      technicalAverage: avg(techScores),
      communicationAverage: avg(commScores),
      readinessScore: Number(user.averageScore) || avg(reportScores),
      strengths: [...strengthSet].slice(0, 12),
      weaknesses: [...weaknessSet].slice(0, 12),
      improvements: [...improvementSet].slice(0, 12),
      scoreHistory,
    },
  };
};

export type ExportRow = Record<string, string | number | null>;

export const buildStudentExportRows = async (
  scope: AdminScope,
  options: {
    institutionId?: string;
    institution?: string;
    batch?: string;
    branch?: string;
  } = {},
): Promise<ExportRow[]> => {
  const instFilter = institutionQueryFilter(scope, options.institutionId, options.institution);
  const filter = userFilterForScope(scope, {
    role: { $in: ['student', 'candidate'] },
    ...(options.batch ? { batch: options.batch } : {}),
    ...(options.branch ? { branch: options.branch } : {}),
    ...(instFilter || {}),
  });
  const students = await User.find(filter).select('-password').sort({ name: 1 }).lean();

  return students.map((s) => ({
    id: String(s._id),
    name: s.name,
    email: s.email,
    username: s.username || '',
    institution: s.institution || '',
    batch: s.batch || '',
    branch: s.branch || '',
    averageScore: Number(s.averageScore) || 0,
    totalSessions: Number(s.totalSessions) || 0,
    status: s.isActive === false ? 'deactivated' : s.requiresAccountSetup ? 'pending_setup' : 'active',
    createdAt: (s as { createdAt?: Date }).createdAt ? new Date((s as { createdAt?: Date }).createdAt!).toISOString() : '',
  }));
};

export const rowsToCsv = (rows: ExportRow[]): string => {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
  ].join('\n');
};
