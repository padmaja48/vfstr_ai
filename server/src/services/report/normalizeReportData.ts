import {
  fixEncodingArtifacts,
  splitListLikeText,
  splitVerdictAndNote,
} from './reportEncoding.utils';
import type {
  CleanReportData,
  CleanReportQuestion,
  CleanReportSectionReadiness,
  NormalizeReportInput,
} from './report.types';

const cleanText = (value: unknown) => fixEncodingArtifacts(value).replace(/\s+/g, ' ').trim();

const toNumber = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : fallback;
};

const toNullableScore = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
};

const fmtDate = (value: unknown): string => {
  if (!value) return '—';
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const parseDurationMinutes = (interview: Record<string, unknown>): number => {
  const raw = interview.duration ?? interview.durationMinutes;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
  const match = String(raw ?? '').match(/(\d+)/);
  return match ? Number(match[1]) : 0;
};

const isSkippedAnswer = (item: Record<string, unknown>) => {
  const answerText = cleanText(item.answer ?? item.userAnswer);
  return !answerText || /^\(?(skipped?|no answer)\)?$/i.test(answerText);
};

const isCodeAnswer = (answer: string, question: string) =>
  /^submitted code/i.test(answer)
  || /```/.test(answer)
  || /\b(function|const |let |class |def |public static|#include)\b/.test(answer)
  || /;\s*$/.test(answer.split('\n')[0] || '');

const sectionMatches = (item: Record<string, unknown>, pattern: RegExp) =>
  pattern.test(
    `${item.question || ''} ${item.questionType || ''} ${item.resumeReference || ''} ${item.topic || ''}`,
  );

const averageScore = (items: Record<string, unknown>[]) => {
  const scored = items.filter((item) => typeof item.score === 'number');
  if (!scored.length) return null;
  return Math.round(scored.reduce((sum, item) => sum + Number(item.score || 0), 0) / scored.length);
};

const pickName = (...candidates: unknown[]) => {
  const names = candidates.map(cleanText).filter(Boolean);
  if (!names.length) return 'Candidate';
  return [...names].sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length || b.length - a.length)[0];
};

const resolveQa = (report: Record<string, unknown>, interview: Record<string, unknown>) => {
  const fromReport = Array.isArray(report.questionAnalysis) ? report.questionAnalysis : [];
  if (fromReport.length) {
    return fromReport
      .filter((item) => item && typeof item === 'object')
      .map((item) => item as Record<string, unknown>)
      .filter((item) => {
        const answer = cleanText(item.answer ?? item.userAnswer);
        if (answer && answer !== '(no answer)') return true;
        return typeof item.score === 'number'
          && Number.isFinite(item.score)
          && cleanText(item.feedback ?? item.whatWorked);
      });
  }

  const questions = Array.isArray(interview.questions) ? interview.questions : [];
  return questions
    .filter((item) => item && typeof item === 'object')
    .map((item) => item as Record<string, unknown>)
    .filter((item) => {
      const answer = cleanText(item.userAnswer ?? item.answer);
      if (answer) return true;
      return typeof item.score === 'number' && cleanText(item.feedback);
    })
    .map((item) => ({
      question: item.question,
      answer: item.userAnswer ?? item.answer,
      score: item.score,
      feedback: item.feedback,
      whatWorked: item.whatWorked,
      whatToImprove: item.whatToImprove,
      questionType: item.questionType,
      resumeReference: item.resumeReference,
      topic: item.topic,
      idealAnswer: item.idealAnswer,
      samplePerfectAnswer: item.samplePerfectAnswer,
      missingConcepts: item.missingConcepts,
      conceptsCovered: item.conceptsCovered,
      dynamicFeedback: item.dynamicFeedback,
      difficulty: item.difficulty,
    }));
};

const deriveSectionReadiness = (
  report: Record<string, unknown>,
  qa: Record<string, unknown>[],
): CleanReportSectionReadiness[] => {
  const resumeItems = qa.filter((item) => sectionMatches(item, /resume|project|internship|experience|introduction|background/i));
  const problemItems = qa.filter((item) => sectionMatches(item, /scenario|problem|debug|scale|complexity|design|trade-off|production/i));
  const companyItems = qa.filter((item) => sectionMatches(item, /company|readiness|tcs|amazon|microsoft|google|accenture|deloitte|infosys|jpmorgan/i));
  const hrItems = qa.filter((item) => sectionMatches(item, /behavio|hr|star|conflict|team|communication|motivation|strength/i));

  const companyScore = toNullableScore(report.companyReadinessScore) ?? averageScore(companyItems);
  const hrScore = averageScore(hrItems) ?? toNullableScore(report.behavioralScore);
  const companyHrParts = [companyScore, hrScore].filter((v): v is number => v != null);
  const companyHr = companyHrParts.length
    ? Math.round(companyHrParts.reduce((a, b) => a + b, 0) / companyHrParts.length)
    : null;

  const sections: Array<{ category: string; score: number | null; measures: string }> = [
    {
      category: 'Resume / Project Explanation',
      score: averageScore(resumeItems),
      measures: 'Project and background clarity from resume-linked answers',
    },
    {
      category: 'Technical Depth',
      score: toNullableScore(report.technicalScore),
      measures: 'Concept accuracy and depth',
    },
    {
      category: 'Communication',
      score: toNullableScore(report.communicationScore),
      measures: 'Clarity, structure, and grammar',
    },
    {
      category: 'Confidence',
      score: toNullableScore(report.confidenceScore),
      measures: 'Answer control and certainty',
    },
    {
      category: 'Problem Solving',
      score: averageScore(problemItems),
      measures: 'Debugging steps, trade-offs, and validation',
    },
    {
      category: 'Company / HR Readiness',
      score: companyHr,
      measures: 'Company-specific and behavioral readiness',
    },
  ];

  return sections
    .filter((s) => s.score != null)
    .map((s) => ({
      category: s.category,
      score: s.score as number,
      measures: s.measures,
    }));
};

const splitFeedbackSentence = (feedback: string, label: string) => {
  const match = cleanText(feedback).match(new RegExp(`${label}:\\s*([^.]*(?:\\.[^A-Z]*)?)`, 'i'));
  return cleanText(match?.[1]);
};

const mapQuestion = (item: Record<string, unknown>, index: number): CleanReportQuestion => {
  const questionText = cleanText(item.question);
  let candidateAnswer = cleanText(item.answer ?? item.userAnswer);
  if (isSkippedAnswer(item)) candidateAnswer = '(skipped)';
  else candidateAnswer = fixEncodingArtifacts(candidateAnswer);

  const correct = cleanText(
    item.whatWorked
    || splitFeedbackSentence(String(item.feedback || ''), 'Correct')
    || (Array.isArray((item.dynamicFeedback as Record<string, unknown>)?.strengths)
      ? ((item.dynamicFeedback as Record<string, unknown>).strengths as string[])[0]
      : '')
    || ((item.conceptsCovered as string[] | undefined)?.length
      ? `Covered ${(item.conceptsCovered as string[]).slice(0, 3).join(', ')}.`
      : 'No clear correct concept was recorded.'),
  );

  const missing = cleanText(
    item.whatToImprove
    || splitFeedbackSentence(String(item.feedback || ''), 'Missing')
    || (Array.isArray((item.dynamicFeedback as Record<string, unknown>)?.areasToImprove)
      ? ((item.dynamicFeedback as Record<string, unknown>).areasToImprove as string[])[0]
      : '')
    || ((item.missingConcepts as string[] | undefined)?.length
      ? `Missing ${(item.missingConcepts as string[]).slice(0, 3).join(', ')}.`
      : 'No specific missing concept was recorded.'),
  );

  const conceptsToRevise = Array.from(new Set([
    ...(Array.isArray(item.missingConcepts) ? item.missingConcepts : []),
    ...(Array.isArray(item.technicalMistakes) ? item.technicalMistakes : []),
    ...(Array.isArray(item.wrongTerminology) ? item.wrongTerminology : []),
    ...(Array.isArray((item.dynamicFeedback as Record<string, unknown>)?.missingConcepts)
      ? (item.dynamicFeedback as Record<string, unknown>).missingConcepts as string[]
      : []),
  ].map(cleanText).filter(Boolean))).slice(0, 8);

  const projectHint = cleanText(item.resumeReference || item.topic).replace(/^[^:]+:\s*/, '');
  const idealAnswer = cleanText(
    item.idealAnswer
    || item.samplePerfectAnswer
    || `A strong answer would name ${projectHint || 'your project'} exactly, walk through problem → steps → validation, and only use technologies you actually used.`,
  );

  let suggestedImprovedAnswer = cleanText(item.samplePerfectAnswer || '');
  const isMeta = /are you ready to (proceed|continue)|process prompt|not an interview question/i.test(
    `${questionText} ${item.feedback || ''}`,
  );
  if (isMeta) {
    suggestedImprovedAnswer = 'No rewrite needed — this was not a scored interview question.';
  }

  const timeline = Array.isArray((item as { difficulty?: string }).difficulty)
    ? undefined
    : cleanText(item.difficulty);

  return {
    number: index + 1,
    difficulty: timeline || cleanText((item as { difficulty?: string }).difficulty) || 'Medium',
    score: toNumber(item.score, 0),
    questionText,
    candidateAnswer,
    isCode: isCodeAnswer(candidateAnswer, questionText),
    whatWasCorrect: correct,
    whatWasMissing: missing,
    conceptsToRevise,
    idealAnswer,
    suggestedImprovedAnswer,
  };
};

const deriveVerdictFields = (
  report: Record<string, unknown>,
  role: string,
  overallScore: number,
): { verdict: string; recommendationNote: string } => {
  const hire = cleanText(report.hiringRecommendation);
  const reason = cleanText(report.hiringRecommendationReason);

  if (hire) {
    const combined = reason ? `${hire} — ${reason}` : hire;
    const split = splitVerdictAndNote(combined);
    if (split.verdict) {
      return { verdict: split.verdict, recommendationNote: split.note };
    }
    return { verdict: hire, recommendationNote: reason };
  }

  if (overallScore >= 80) return { verdict: `Strong Hire signal for ${role}`, recommendationNote: reason };
  if (overallScore >= 65) return { verdict: `Hire for ${role} with focused practice`, recommendationNote: reason };
  if (overallScore >= 45) return { verdict: 'Borderline — key gaps need practice', recommendationNote: reason };
  return { verdict: 'Needs practice before the next interview loop', recommendationNote: reason };
};

const collectStrengths = (report: Record<string, unknown>, qa: Record<string, unknown>[]) => {
  const fromReport = splitListLikeText(
    [...(Array.isArray(report.strengths) ? report.strengths : []),
      ...(Array.isArray(report.skillWiseStrengths)
        ? (report.skillWiseStrengths as Array<{ evidence?: string }>).map((s) => s.evidence)
        : [])],
  );
  if (fromReport.length) return fromReport.slice(0, 8);

  const fromQa = qa.flatMap((item) => {
    const parts = splitListLikeText(item.whatWorked || item.feedback);
    return parts.filter((p) => /strong|good|clear|correct|well|solid/i.test(p));
  });
  if (fromQa.length) return Array.from(new Set(fromQa)).slice(0, 8);
  return ['Completed the interview session and provided answers for review.'];
};

const collectImprovements = (
  report: Record<string, unknown>,
  qa: Record<string, unknown>[],
  sections: CleanReportSectionReadiness[],
) => {
  const fromReport = splitListLikeText(
    [...(Array.isArray(report.improvements) ? report.improvements : []),
      ...(Array.isArray(report.areasForImprovement) ? report.areasForImprovement : [])],
  );
  if (fromReport.length) return fromReport.slice(0, 8);

  const weak = sections
    .filter((s) => s.score < 55)
    .map((s) => `Strengthen ${s.category.toLowerCase()} — ${s.measures}.`);
  const skipped = qa.filter(isSkippedAnswer).length;
  if (skipped > 0) weak.unshift(`Answer all questions — ${skipped} were skipped or empty.`);
  if (weak.length) return weak.slice(0, 8);
  return ['Add clearer problem → steps → result structure and one concrete validation point in each answer.'];
};

const collectPracticeNext = (
  report: Record<string, unknown>,
  sections: CleanReportSectionReadiness[],
  qa: Record<string, unknown>[],
) => {
  const roadmap: string[] = [];
  sections.filter((s) => s.score < 70).sort((a, b) => a.score - b.score).forEach((section) => {
    if (/technical/i.test(section.category)) roadmap.push('Revise the weakest technical concepts and explain each with one project example.');
    else if (/resume|project/i.test(section.category)) roadmap.push('Practice a 90-second project architecture explanation from problem to outcome.');
    else if (/communication/i.test(section.category)) roadmap.push('Practice answers aloud using a clear opening, evidence, and conclusion.');
    else if (/confidence/i.test(section.category)) roadmap.push('Reduce hesitant language and state assumptions before answering.');
    else if (/problem/i.test(section.category)) roadmap.push('Practice debugging scenarios with steps, metrics, trade-offs, and rollback plan.');
    else roadmap.push('Prepare company-specific talking points and STAR stories for conflict, ownership, and learning.');
  });

  splitListLikeText(report.missedConcepts).slice(0, 4).forEach((item) => roadmap.push(`Revise ${item}.`));
  splitListLikeText(report.recommendedLearningResources || report.recommendations).slice(0, 3).forEach((item) => {
    roadmap.push(item);
  });
  qa.flatMap((item) => splitListLikeText(item.missingConcepts)).slice(0, 3).forEach((item) => {
    if (!roadmap.some((r) => r.includes(item))) roadmap.push(`Revise ${item}.`);
  });

  if (!roadmap.length) {
    roadmap.push('Re-run a timed mock and aim for a concrete example in every answer.');
    roadmap.push('Record one STAR story for teamwork, conflict, and ownership.');
  }

  return Array.from(new Set(roadmap.map(cleanText).filter(Boolean))).slice(0, 7);
};

const buildExecutiveSummary = (
  report: Record<string, unknown>,
  role: string,
  interviewType: string,
  strengths: string[],
  improvements: string[],
  qa: Record<string, unknown>[],
  overallScore: number,
) => {
  const existing = cleanText(report.transcriptSummary || report.overallFeedback);
  if (existing && existing.split(/[.!?]/).filter(Boolean).length >= 2) {
    return fixEncodingArtifacts(existing);
  }

  const answered = qa.filter((item) => !isSkippedAnswer(item)).length;
  const total = qa.length;
  const topStrength = strengths[0] || 'Completed the session';
  const topGap = improvements[0] || 'add more structure and evidence';
  const parts = [
    `In this ${interviewType.toLowerCase()} for ${role}, the overall score was ${overallScore}/100 across ${answered}/${total || 0} answered questions.`,
    `Main pattern: ${topStrength.replace(/\.$/, '')}.`,
    `Biggest gap: ${topGap.replace(/\.$/, '')}.`,
    cleanText(report.hiringRecommendationReason) || null,
  ].filter(Boolean);

  return fixEncodingArtifacts(parts.join(' '));
};

/**
 * Pure data transform: raw report + interview → clean schema for PDF rendering.
 * Does not alter scores or rewrite candidate answers (encoding fixes only).
 */
export const normalizeReportData = (input: NormalizeReportInput): CleanReportData => {
  const { report, interview, user, previousOverallScore = null } = input;
  const interviewUser = typeof interview.userId === 'object' && interview.userId !== null
    ? interview.userId as Record<string, unknown>
    : {};

  const qa = resolveQa(report, interview);
  const sectionReadiness = deriveSectionReadiness(report, qa);
  const overallScore = toNumber(report.overallScore, averageScore(qa) ?? 0);
  const role = cleanText(interview.roleDomain) || 'Role Not Selected';
  const interviewType = cleanText(interview.interviewType || interview.interviewStyle) || 'Interview';
  const level = cleanText(interview.complexity || interview.roleLevel) || 'Standard';

  const strengths = collectStrengths(report, qa);
  const areasToImprove = collectImprovements(report, qa, sectionReadiness);
  const practiceNext = collectPracticeNext(report, sectionReadiness, qa);
  const { verdict, recommendationNote } = deriveVerdictFields(report, role, overallScore);
  const executiveSummaryText = buildExecutiveSummary(
    report,
    role,
    interviewType,
    strengths,
    areasToImprove,
    qa,
    overallScore,
  );

  const questionsTotal = toNumber(
    report.totalPlannedQuestions ?? interview.totalPlannedQuestions ?? qa.length,
    qa.length,
  );
  const questionsAnswered = qa.filter((item) => !isSkippedAnswer(item)).length;
  const questionsReached = qa.length;

  const scored = qa.filter((item) => typeof item.score === 'number');
  const averageEvaluatedScore = scored.length
    ? Math.round(scored.reduce((sum, item) => sum + Number(item.score || 0), 0) / scored.length)
    : overallScore;

  const difficultyProgression = splitListLikeText(report.difficultyProgression).length
    ? splitListLikeText(report.difficultyProgression)
    : qa.map((item, i) => cleanText(item.difficulty) || `Q${i + 1}`);

  return {
    candidate: {
      name: pickName(user?.name, interviewUser.name, interview.accountOwnerName, report.accountOwnerName, interview.speakerName),
      email: cleanText(interview.candidateEmail || interviewUser.email || user?.email),
      role,
      date: fmtDate(interview.completedAt || interview.createdAt),
      durationMinutes: parseDurationMinutes(interview),
    },
    summary: {
      overallScore,
      type: interviewType,
      level,
      questionsAnswered,
      questionsTotal,
      questionsReached,
      averageEvaluatedScore,
      verdict: fixEncodingArtifacts(verdict),
      recommendationNote: fixEncodingArtifacts(recommendationNote),
      executiveSummaryText,
    },
    sectionReadiness,
    strengths: strengths.map(fixEncodingArtifacts),
    areasToImprove: areasToImprove.map(fixEncodingArtifacts),
    practiceNext: practiceNext.map(fixEncodingArtifacts),
    hiringSignal: cleanText(report.hiringRecommendation) || verdict,
    hiringSignalNote: fixEncodingArtifacts(report.hiringRecommendationReason || recommendationNote),
    missedConcepts: splitListLikeText(report.missedConcepts).map(fixEncodingArtifacts).slice(0, 12),
    trend: {
      previousScore: previousOverallScore != null ? toNumber(previousOverallScore) : null,
      currentScore: overallScore,
    },
    difficultyProgression: difficultyProgression.map(fixEncodingArtifacts),
    questions: qa.map(mapQuestion),
  };
};

export default normalizeReportData;
