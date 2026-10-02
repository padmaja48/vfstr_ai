/**
 * Institution / student performance report metrics — real data only.
 *
 * Placement readiness % (platform admin definition, no separate DB field):
 *   round(mean of User.averageScore for students in scope with averageScore > 0),
 *   falling back to mean of completed Interview.totalScore values when no student
 *   averages exist. Matches `buildInstitutionsFromUsers` → placementReadinessPct.
 *
 * Readiness bands (same as mapUserToStudent):
 *   Ready ≥ 75 · Intermediate ≥ 50 · Beginner < 50  (on student.averageScore)
 */

import { skillsFromScores } from './mappers';

const avg = (nums) => {
  const list = nums.filter((n) => Number.isFinite(n));
  if (!list.length) return null;
  return list.reduce((a, b) => a + b, 0) / list.length;
};

const round1 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);

const readinessFromScore = (score) => {
  const n = Number(score) || 0;
  if (n >= 75) return 'Ready';
  if (n >= 50) return 'Intermediate';
  return 'Beginner';
};

const isCompleted = (iv) => iv.status === 'completed' || iv.rawStatus === 'Completed';

const monthKey = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const monthLabel = (key) => {
  if (!key) return '';
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
};

/**
 * Date range covered by interview activity (or student createdAt fallback).
 */
export const computeDateRange = (interviews, students = []) => {
  const dates = [
    ...interviews.map((i) => i.date).filter(Boolean),
    ...students.map((s) => s.createdAt).filter(Boolean),
  ]
    .map((d) => new Date(d))
    .filter((d) => !Number.isNaN(d.getTime()))
    .sort((a, b) => a - b);

  if (!dates.length) {
    return { from: null, to: null, label: 'No dated activity' };
  }
  const from = dates[0];
  const to = dates[dates.length - 1];
  const fmt = (d) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  return { from, to, label: `${fmt(from)} – ${fmt(to)}` };
};

/**
 * Average sub-scores from real interview.scores / report-like fields on mapped interviews.
 */
export const computeSubScoreAverages = (interviews) => {
  const buckets = {
    technical: [],
    problemSolving: [],
    communication: [],
    confidence: [],
    answerRelevance: [],
  };

  interviews.filter(isCompleted).forEach((iv) => {
    const breakdown = skillsFromScores(iv.scores || {}, Number(iv.score) || 40);
    buckets.technical.push(breakdown.technical);
    buckets.problemSolving.push(breakdown.problemSolving);
    buckets.communication.push(breakdown.communication);
    buckets.confidence.push(breakdown.confidence);
    buckets.answerRelevance.push(breakdown.answerRelevance);
  });

  const hasAny = Object.values(buckets).some((arr) => arr.length > 0);
  if (!hasAny) return null;

  return {
    technical: round1(avg(buckets.technical)),
    problemSolving: round1(avg(buckets.problemSolving)),
    communication: round1(avg(buckets.communication)),
    confidence: round1(avg(buckets.confidence)),
    answerRelevance: round1(avg(buckets.answerRelevance)),
  };
};

/**
 * Free-text improvement themes (not tagged categories). Returns null when sparse —
 * report UI omits the section when null (backend does not tag weakness categories).
 */
export const computeCommonWeaknesses = (interviews, { minCount = 2, limit = 8 } = {}) => {
  const counts = new Map();
  interviews.forEach((iv) => {
    (iv.aiFeedback?.improvements || []).forEach((text) => {
      const label = String(text || '').trim();
      if (!label || label.length < 4) return;
      counts.set(label, (counts.get(label) || 0) + 1);
    });
  });
  const ranked = [...counts.entries()]
    .filter(([, count]) => count >= minCount)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  // No structured weaknessCategory tags in the API — only include when repeated themes exist.
  return ranked.length ? ranked : null;
};

export const computeMonthOverMonth = (interviews) => {
  const completed = interviews.filter(isCompleted).filter((iv) => iv.date && Number.isFinite(Number(iv.score)));
  if (completed.length < 2) return null;

  const byMonth = new Map();
  completed.forEach((iv) => {
    const key = monthKey(iv.date);
    if (!key) return;
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(Number(iv.score));
  });

  const keys = [...byMonth.keys()].sort();
  if (keys.length < 2) return null;

  const prevKey = keys[keys.length - 2];
  const currKey = keys[keys.length - 1];
  const prevAvg = avg(byMonth.get(prevKey));
  const currAvg = avg(byMonth.get(currKey));
  if (prevAvg == null || currAvg == null) return null;

  return {
    previousMonth: monthLabel(prevKey),
    currentMonth: monthLabel(currKey),
    previousAvg: round1(prevAvg),
    currentAvg: round1(currAvg),
    delta: round1(currAvg - prevAvg),
    previousCount: byMonth.get(prevKey).length,
    currentCount: byMonth.get(currKey).length,
  };
};

/**
 * @param {{ name: string, id?: string }} institution
 * @param {Array} students mapped students for this institution
 * @param {Array} interviews mapped interviews for this institution
 */
export const buildInstitutionReport = (institution, students, interviews) => {
  if (!institution?.name) {
    const err = new Error('Institution name is required to build a report.');
    err.code = 'REPORT_MISSING_DATA';
    throw err;
  }

  const totalStudents = students.length;
  const totalInterviews = interviews.length;
  const completed = interviews.filter(isCompleted);
  const completionRate = totalInterviews
    ? Math.round((completed.length / totalInterviews) * 1000) / 10
    : null;

  const studentScoreValues = students
    .map((s) => Number(s.averageScore))
    .filter((n) => Number.isFinite(n) && n > 0);
  const interviewScoreValues = completed
    .map((iv) => Number(iv.score))
    .filter((n) => Number.isFinite(n) && n > 0);

  const readinessSource = studentScoreValues.length ? studentScoreValues : interviewScoreValues;
  const fluentReadinessAvg = round1(avg(readinessSource));
  const placementReadinessPct = fluentReadinessAvg == null
    ? null
    : Math.round(fluentReadinessAvg);

  const bandCounts = { Beginner: 0, Intermediate: 0, Ready: 0 };
  students.forEach((s) => {
    const band = s.readinessLevel || readinessFromScore(s.averageScore);
    if (bandCounts[band] != null) bandCounts[band] += 1;
  });

  const ranked = [...students]
    .map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      averageScore: Number(s.averageScore) || 0,
      totalInterviews: Number(s.totalInterviews) || 0,
      readinessLevel: s.readinessLevel || readinessFromScore(s.averageScore),
    }))
    .sort((a, b) => b.averageScore - a.averageScore);

  const topPerformers = ranked.filter((s) => s.averageScore > 0).slice(0, 5);
  const bottomPerformers = [...ranked]
    .filter((s) => s.averageScore > 0)
    .sort((a, b) => a.averageScore - b.averageScore)
    .slice(0, 5);

  const dateRange = computeDateRange(interviews, students);
  const subScores = computeSubScoreAverages(interviews);
  const weaknesses = computeCommonWeaknesses(interviews);
  const monthOverMonth = computeMonthOverMonth(interviews);

  return {
    type: 'institution',
    institutionName: institution.name,
    institutionId: institution.id || null,
    generatedAt: new Date().toISOString(),
    dateRange,
    summary: {
      totalStudents,
      totalInterviews,
      completedInterviews: completed.length,
      completionRate,
      fluentReadinessAvg,
      placementReadinessPct,
    },
    readinessBands: bandCounts,
    subScores,
    weaknesses,
    topPerformers,
    bottomPerformers,
    monthOverMonth,
    placementReadinessFormula:
      'round(mean of User.averageScore for institution students with score > 0; else mean of completed Interview.totalScore)',
  };
};

/**
 * Student performance report (same metric helpers, no institution rollup).
 */
export const buildStudentReport = (student, interviews) => {
  if (!student?.id || !student?.name) {
    const err = new Error('A student with name and id is required to build a report.');
    err.code = 'REPORT_MISSING_DATA';
    throw err;
  }

  const scoped = interviews.filter((iv) => iv.studentId === student.id);
  const completed = scoped.filter(isCompleted);
  const scores = completed.map((iv) => Number(iv.score)).filter((n) => Number.isFinite(n));
  const dateRange = computeDateRange(scoped, [student]);
  const subScores = computeSubScoreAverages(scoped);
  const weaknesses = computeCommonWeaknesses(scoped, { minCount: 1, limit: 6 });
  const monthOverMonth = computeMonthOverMonth(scoped);
  const fluentReadinessAvg = round1(
    Number.isFinite(Number(student.averageScore)) && Number(student.averageScore) > 0
      ? Number(student.averageScore)
      : avg(scores),
  );

  return {
    type: 'student',
    studentName: student.name,
    studentEmail: student.email || '',
    institutionName: student.institution || '—',
    generatedAt: new Date().toISOString(),
    dateRange,
    summary: {
      totalInterviews: scoped.length,
      completedInterviews: completed.length,
      completionRate: scoped.length
        ? Math.round((completed.length / scoped.length) * 1000) / 10
        : null,
      fluentReadinessAvg,
      placementReadinessPct: fluentReadinessAvg == null ? null : Math.round(fluentReadinessAvg),
      readinessLevel: student.readinessLevel || readinessFromScore(fluentReadinessAvg || 0),
    },
    readinessBands: null,
    subScores,
    weaknesses,
    recentInterviews: [...completed]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 10)
      .map((iv) => ({
        company: iv.targetCompany || '—',
        type: iv.type || '—',
        score: Number(iv.score) || 0,
        date: iv.date,
      })),
    monthOverMonth,
    topPerformers: null,
    bottomPerformers: null,
  };
};

/**
 * Comparison summary across institutions for the combined PDF cover page.
 */
export const buildCombinedComparison = (institutionReports) => {
  const rows = institutionReports.map((r) => ({
    name: r.institutionName,
    students: r.summary.totalStudents,
    interviews: r.summary.totalInterviews,
    completionRate: r.summary.completionRate,
    readiness: r.summary.placementReadinessPct,
    fluentAvg: r.summary.fluentReadinessAvg,
  }));

  const readinessValues = rows.map((r) => r.readiness).filter((n) => n != null);
  return {
    generatedAt: new Date().toISOString(),
    institutionCount: rows.length,
    totalStudents: rows.reduce((a, r) => a + r.students, 0),
    totalInterviews: rows.reduce((a, r) => a + r.interviews, 0),
    overallReadiness: readinessValues.length
      ? Math.round(avg(readinessValues))
      : null,
    rows: rows.sort((a, b) => (b.readiness || 0) - (a.readiness || 0)),
  };
};

export default buildInstitutionReport;
