import React, { useContext, useEffect, useMemo, useState } from 'react';
import { AuthContext } from '../context/AuthContext';
import { COMPANY_OPTIONS } from '../lib/companyOptions';
import { interviewAPI } from '../services/api';
import { useToast } from '../context/ToastContext';

/* ── Helpers ─────────────────────────────────────────────────── */
const scoreToDeg = (s) => `${(Math.min(100, Math.max(0, s || 0)) / 100 * 360).toFixed(1)}deg`;
const fmtReportDate = (v) => v
  ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  : '—';

const cleanText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

const safeFilePart = (value) =>
  cleanText(value || 'interview-report')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'interview-report';

/* Score color — teal scale, muted for unevaluated / zeros */
const scoreColor = (v) => {
  if (v == null || Number.isNaN(Number(v))) return '#a8a29e';
  if (v >= 80) return '#1e3a8a';
  if (v >= 60) return '#2563eb';
  if (v >= 35) return '#57534e';
  return '#a8a29e';
};

const formatScore = (value) => (value == null || Number.isNaN(Number(value)) ? '—' : Number(value).toFixed(0));

const integrityReasonLabel = (reason = '') => {
  const value = String(reason).replace(/^integrity_violation:/, '').replace(/_/g, ' ');
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Integrity policy violation';
};

const faceIncidentLabel = (type) => type === 'multiple_faces' ? 'Multiple faces detected' : 'Face not visible';

const formatIncidentDuration = (durationMs = 0) => {
  const seconds = Math.max(0, Math.round(Number(durationMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

const companyLabelByValue = new Map(COMPANY_OPTIONS.map((company) => [company.value, company.label]));

const titleFromSlug = (value) =>
  cleanText(value)
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const pickFullName = (...candidates) => {
  const names = candidates.map(cleanText).filter(Boolean);
  if (!names.length) return '';
  return [...names].sort((a, b) => {
    const aParts = a.split(/\s+/).length;
    const bParts = b.split(/\s+/).length;
    if (bParts !== aParts) return bParts - aParts;
    return b.length - a.length;
  })[0];
};

const getCandidateInfo = (interview = {}, report = {}, fallbackUser = {}) => {
  const user = typeof interview.userId === 'object' && interview.userId !== null ? interview.userId : {};
  const accountOwner = pickFullName(
    fallbackUser.name,
    user.name,
    interview.accountOwnerName,
    report.accountOwnerName,
  );
  const speaker = cleanText(interview.speakerName || report.speakerName);
  const displayName = accountOwner || speaker || 'Candidate';

  return {
    name: displayName,
    accountOwner,
    speaker,
    email: cleanText(interview.candidateEmail || user.email || fallbackUser.email),
    role: cleanText(interview.roleDomain) || 'Role Not Selected',
    company: cleanText(companyLabelByValue.get(interview.targetCompany) || titleFromSlug(interview.targetCompany)) || 'General Interview',
    interviewType: cleanText(interview.interviewType || interview.interviewStyle) || 'Interview',
    duration: interview.duration ? `${interview.duration} Minutes` : 'Duration Not Selected',
    difficulty: cleanText(interview.complexity) || cleanText(interview.roleLevel) || 'Difficulty Not Selected',
    date: fmtReportDate(interview.completedAt || interview.createdAt),
    dateValue: interview.completedAt || interview.createdAt || null,
  };
};

const getInitials = (name = '') => {
  const parts = cleanText(name).split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
};

const toDateKey = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const averageScore = (items) => {
  const scored = (items || []).filter((item) => typeof item.score === 'number');
  if (!scored.length) return null;
  return Math.round(scored.reduce((sum, item) => sum + Number(item.score || 0), 0) / scored.length);
};

const sectionMatches = (item, pattern) =>
  pattern.test(`${item.question || ''} ${item.questionType || ''} ${item.resumeReference || ''} ${item.topic || ''}`);

/** Honest score: null = not evaluated (do not invent from overall). */
const toHonestScore = (...candidates) => {
  for (const value of candidates) {
    if (value == null || value === '') continue;
    const n = Number(value);
    if (Number.isNaN(n)) continue;
    return Math.max(0, Math.min(100, Math.round(n)));
  }
  return null;
};

const formatHiringChance = (report) => {
  const score = toHonestScore(report?.overallScore);
  return score == null ? '—' : `${score}%`;
};

const isSkippedAnswer = (item) => {
  const answerText = cleanText(item?.answer || item?.userAnswer);
  return !answerText || /^\(?(skipped?|no answer)\)?$/i.test(answerText);
};

const getStoredSuggestedImprovedAnswer = (item) =>
  cleanText(item?.samplePerfectAnswer || item?.suggestedImprovedAnswer);

const getConceptsToRevise = (item) => Array.from(new Set([
  ...(item?.missingConcepts || []),
  ...(item?.technicalMistakes || []),
  ...(item?.wrongTerminology || []),
  ...(Array.isArray(item?.dynamicFeedback?.missingConcepts) ? item.dynamicFeedback.missingConcepts : []),
].map(cleanText).filter(Boolean))).slice(0, 8);

const getSnapshotExplanation = (report) =>
  cleanText(report?.hiringRecommendationReason || report?.scoreConfidenceNote);

const deriveSectionScores = ({ report, qa, selectedInterview }) => {
  const resumeItems = qa.filter((item) => sectionMatches(item, /resume|project|internship|experience|introduction|background/i));
  const problemItems = qa.filter((item) => sectionMatches(item, /scenario|problem|debug|scale|complexity|design|trade-off|production/i));
  const companyItems = qa.filter((item) => sectionMatches(item, /company|readiness|tcs|amazon|microsoft|google|accenture|deloitte|infosys|jpmorgan/i));
  const hrItems = qa.filter((item) => sectionMatches(item, /behavio|hr|star|conflict|team|communication|motivation|strength/i));

  const companyScore = toHonestScore(
    report.companyReadinessScore,
    averageScore(companyItems),
    selectedInterview?.targetCompany ? null : report.behavioralScore,
  );
  const hrScore = toHonestScore(averageScore(hrItems), report.behavioralScore);
  const companyHrParts = [companyScore, hrScore].filter((v) => v != null);
  const companyHr = companyHrParts.length
    ? Math.round(companyHrParts.reduce((a, b) => a + b, 0) / companyHrParts.length)
    : null;

  const noteFor = (value, evaluatedNote, emptyNote) =>
    (value == null ? emptyNote : evaluatedNote);

  return [
    {
      key: 'resume',
      label: 'Resume / Project Explanation',
      value: toHonestScore(averageScore(resumeItems)),
      note: noteFor(
        toHonestScore(averageScore(resumeItems)),
        'Project and background clarity from resume-linked answers',
        'Not evaluated — no matching resume/project answers',
      ),
    },
    {
      key: 'technical',
      label: 'Technical Depth',
      value: toHonestScore(report.technicalScore),
      note: noteFor(
        toHonestScore(report.technicalScore),
        'Concept accuracy and depth',
        'Not evaluated — technical score unavailable',
      ),
    },
    {
      key: 'communication',
      label: 'Communication',
      value: toHonestScore(report.communicationScore),
      note: noteFor(
        toHonestScore(report.communicationScore),
        'Clarity, structure, and grammar',
        'Not evaluated — communication score unavailable',
      ),
    },
    {
      key: 'confidence',
      label: 'Confidence',
      value: toHonestScore(report.confidenceScore),
      note: noteFor(
        toHonestScore(report.confidenceScore),
        'Answer control and certainty',
        'Not evaluated — confidence score unavailable',
      ),
    },
    {
      key: 'problem',
      label: 'Problem Solving',
      value: toHonestScore(averageScore(problemItems)),
      note: noteFor(
        toHonestScore(averageScore(problemItems)),
        'Debugging steps, trade-offs, and validation',
        'Not evaluated — no problem-solving questions answered',
      ),
    },
    {
      key: 'companyHr',
      label: 'Company / HR Readiness',
      value: companyHr,
      note: noteFor(
        companyHr,
        'Company fit, STAR maturity, and role motivation',
        'Not evaluated — company/HR signals missing',
      ),
    },
  ];
};

const VAGUE_STRENGTH = /^(good|great|nice|solid|decent)\s+(communication|answers?|performance|skills?)[.!]?$/i;

const collectStrengths = (report, qa) => {
  const fromReport = (report.strengths || []).map(cleanText).filter(Boolean).filter((s) => !VAGUE_STRENGTH.test(s));
  const fromQuestions = qa.flatMap((item) => {
    if (item.dynamicFeedback?.strengths?.length) return item.dynamicFeedback.strengths.slice(0, 1).map(cleanText);
    if (item.whatWorked && !/nothing|no clear|not recorded/i.test(item.whatWorked)) return [cleanText(item.whatWorked)];
    return [];
  }).filter(Boolean);
  const merged = Array.from(new Set([...fromReport, ...fromQuestions])).slice(0, 5);
  if (merged.length) return merged;
  const answered = qa.filter((item) => !isSkippedAnswer(item)).length;
  if (answered > 0) return ['Stayed engaged and attempted role-relevant answers during the session.'];
  return ['Completed the interview session — next focus on answering every question with a concrete example.'];
};

const collectImprovements = (report, qa, sectionScores) => {
  const fromReport = [
    ...(report.improvements || []),
    ...(report.areasForImprovement || []),
  ].map(cleanText).filter(Boolean);
  if (fromReport.length) return Array.from(new Set(fromReport)).slice(0, 5);

  const fromWeak = sectionScores
    .filter((s) => s.value != null && s.value < 55)
    .map((s) => `Strengthen ${s.label.toLowerCase()} — ${s.note.replace(/^Not evaluated — /, '')}.`);
  const skipped = qa.filter(isSkippedAnswer).length;
  if (skipped > 0) fromWeak.unshift(`Answer all questions — ${skipped} were skipped or empty.`);
  if (fromWeak.length) return fromWeak.slice(0, 5);
  return ['Add a clearer problem → steps → result structure and one concrete validation point in each answer.'];
};

const deriveVerdict = ({ report, sectionScores, candidate }) => {
  const hire = cleanText(report.hiringRecommendation);
  const reason = cleanText(report.hiringRecommendationReason);
  if (hire) {
    const shortReason = reason
      ? reason.replace(/\.$/, '').slice(0, 110)
      : null;
    if (/strong hire/i.test(hire)) return shortReason ? `Strong Hire — ${shortReason}` : `Strong Hire for ${candidate.role}`;
    if (/^hire$/i.test(hire)) return shortReason ? `Hire — ${shortReason}` : `Hire-ready for ${candidate.role} with focused practice`;
    if (/borderline/i.test(hire)) return shortReason ? `Borderline — ${shortReason}` : 'Borderline — close, but key gaps need practice';
    if (/no hire/i.test(hire)) return shortReason ? `Needs practice — ${shortReason}` : 'Needs practice before the next interview loop';
  }

  const score = toHonestScore(report.overallScore);
  const weakest = [...sectionScores]
    .filter((s) => s.value != null)
    .sort((a, b) => a.value - b.value)[0];

  if (score == null) return 'Report incomplete — scores could not be fully evaluated';
  if (score >= 80) return weakest ? `Strong performance — keep sharpening ${weakest.label.toLowerCase()}` : `Strong Hire signal for ${candidate.role}`;
  if (score >= 65) return weakest ? `Hire for ${candidate.role} with practice on ${weakest.label.toLowerCase()}` : `Solid interview — continue polishing weak spots`;
  if (score >= 45) return weakest ? `Needs practice on ${weakest.label.toLowerCase()}` : 'Needs practice before the next interview';
  return weakest ? `Needs focused practice on ${weakest.label.toLowerCase()}` : 'Needs foundational practice before reattempting';
};

const buildExecutiveSummary = ({ report, candidate, strengths, improvements, qa }) => {
  const existing = cleanText(report.transcriptSummary || report.overallFeedback);
  if (existing && existing.split(/[.!?]/).filter(Boolean).length >= 2) return existing;

  const answered = qa.filter((item) => !isSkippedAnswer(item)).length;
  const total = qa.length;
  const score = formatScore(report.overallScore);
  const topStrength = strengths[0] || 'Completed the session';
  const topGap = improvements[0] || 'add more structure and evidence';
  return [
    `In this ${candidate.interviewType.toLowerCase()} for ${candidate.role} at ${candidate.company}, the overall score was ${score}/100 across ${answered}/${total || 0} answered questions.`,
    `Main pattern: ${topStrength.replace(/\.$/, '')}.`,
    `Biggest gap: ${topGap.replace(/\.$/, '')}.`,
    report.hiringRecommendationReason ? cleanText(report.hiringRecommendationReason) : null,
  ].filter(Boolean).join(' ');
};

const splitFeedbackSentence = (feedback, label) => {
  const match = cleanText(feedback).match(new RegExp(`${label}:\\s*([^.]*(?:\\.[^A-Z]*)?)`, 'i'));
  return cleanText(match?.[1]);
};

const getQuestionFeedbackParts = (item) => {
  const correct = item.whatWorked ||
    splitFeedbackSentence(item.feedback, 'Correct') ||
    item.dynamicFeedback?.strengths?.[0] ||
    ((item.conceptsCovered || []).length ? `Covered ${(item.conceptsCovered || []).slice(0, 3).join(', ')}.` : 'No clear correct concept was recorded.');
  const missing = item.whatToImprove ||
    splitFeedbackSentence(item.feedback, 'Missing') ||
    item.dynamicFeedback?.areasToImprove?.[0] ||
    ((item.missingConcepts || []).length ? `Missing ${(item.missingConcepts || []).slice(0, 3).join(', ')}.` : 'No specific missing concept was recorded.');
  const concepts = Array.from(new Set([
    ...(item.missingConcepts || []),
    ...(item.technicalMistakes || []),
    ...(item.wrongTerminology || []),
    ...(item.dynamicFeedback?.missingConcepts || []),
  ].filter(Boolean))).slice(0, 5);
  const projectHint = cleanText(item.resumeReference || item.topic || '').replace(/^[^:]+:\s*/, '');
  const ideal = item.idealAnswer
    || `A strong answer would name ${projectHint || 'your project'} exactly, walk through the problem → steps → validation, and only use technologies you actually used.`;
  const candidateAnswer = cleanText(item.answer || item.userAnswer)
    .replace(/^Submitted code[\s\S]*/i, '')
    .trim();
  const isMeta = /are you ready to (proceed|continue)|process prompt|not an interview question/i.test(
    `${item.question || ''} ${item.feedback || ''}`,
  );
  let improved = item.samplePerfectAnswer || '';
  if (isMeta) {
    improved = 'No rewrite needed — this was not a scored interview question.';
  } else if (!improved || improved === ideal || /define .+ in one or two clear sentences/i.test(improved)) {
    const gaps = concepts
      .filter((c) => !/voltage|named entity|part-of-speech|no answer/i.test(c))
      .join(', ') || 'clearer structure and one validation step';
    improved = candidateAnswer
      ? `Improved rewrite of your answer on ${projectHint || 'this topic'}: keep your core idea ("${candidateAnswer.slice(0, 140)}${candidateAnswer.length > 140 ? '…' : ''}"), say it in order (problem → steps → result), and explicitly cover ${gaps}. Do not invent tools you did not use.`
      : `Practice a 60-second answer on ${projectHint || 'this topic'}: problem, 3 real steps from your stack, and how you validated it. Cover ${gaps}.`;
  }

  return { correct, missing, ideal, concepts, improved };
};

const deriveLearningRoadmap = ({ report, sectionScores, qa }) => {
  const weakSections = [...sectionScores]
    .filter((section) => section.value != null && section.value < 70)
    .sort((a, b) => a.value - b.value);
  const missed = Array.from(new Set([
    ...(report.missedConcepts || []),
    ...(report.areasForImprovement || []),
    ...qa.flatMap((item) => item.missingConcepts || []),
  ].filter(Boolean))).slice(0, 6);
  const roadmap = [];

  weakSections.forEach((section) => {
    if (section.key === 'technical') roadmap.push('Revise the weakest technical concepts and explain each with one project example.');
    else if (section.key === 'resume') roadmap.push('Practice a 90-second project architecture explanation from problem to outcome.');
    else if (section.key === 'communication') roadmap.push('Practice answers aloud using a clear opening, evidence, and conclusion.');
    else if (section.key === 'confidence') roadmap.push('Reduce hesitant language and state assumptions before answering.');
    else if (section.key === 'problem') roadmap.push('Practice debugging scenarios with steps, metrics, trade-offs, and rollback plan.');
    else if (section.key === 'companyHr') roadmap.push('Prepare company-specific talking points and STAR stories for conflict, ownership, and learning.');
  });

  missed.slice(0, 4).forEach((item) => roadmap.push(`Revise ${item}.`));
  (report.recommendedLearningResources || report.recommendations || []).slice(0, 3).forEach((item) => roadmap.push(item));

  if (!roadmap.length) {
    roadmap.push('Re-run a timed mock and aim for a concrete example in every answer.');
    roadmap.push('Record one STAR story for teamwork, conflict, and ownership.');
  }

  return Array.from(new Set(roadmap)).slice(0, 7);
};

const deriveScoreTrend = (interviews, selectedInterview) => {
  if (!selectedInterview?._id || !interviews?.length) return null;
  const sameRole = interviews
    .filter((iv) => cleanText(iv.roleDomain) === cleanText(selectedInterview.roleDomain))
    .filter((iv) => iv.totalScore != null)
    .sort((a, b) => new Date(a.completedAt || a.createdAt || 0) - new Date(b.completedAt || b.createdAt || 0));

  if (sameRole.length < 2) return null;

  const idx = sameRole.findIndex((iv) => iv._id === selectedInterview._id);
  if (idx < 0) return null;

  const current = Number(sameRole[idx].totalScore);
  const previous = idx > 0 ? Number(sameRole[idx - 1].totalScore) : null;
  const delta = previous != null ? Math.round(current - previous) : null;
  const recent = sameRole.slice(Math.max(0, sameRole.length - 5)).map((iv) => ({
    id: iv._id,
    score: Math.round(Number(iv.totalScore)),
    date: fmtReportDate(iv.completedAt || iv.createdAt),
    isCurrent: iv._id === selectedInterview._id,
  }));

  return {
    role: cleanText(selectedInterview.roleDomain) || 'this role',
    previous,
    current,
    delta,
    recent,
    count: sameRole.length,
  };
};

const downloadBrandedReportPdf = async ({ interviewId, candidateName, role, onError }) => {
  try {
    const response = await interviewAPI.getReportPdf(interviewId);
    const blob = new Blob([response.data], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `VFSTR_AI_${safeFilePart(candidateName)}-${safeFilePart(role)}-report.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    onError?.(err?.response?.data?.message || err?.message || 'Could not generate PDF report.');
  }
};

/* ── Main Panel ──────────────────────────────────────────────── */
export const InterviewReportPanel = ({ interviews, selectedInterview, report, onSelect, loading, onStartInterview }) => {
  const { user } = useContext(AuthContext);
  const toast = useToast();
  const [roleFilter, setRoleFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [listPage, setListPage] = useState(1);
  const [openQuestions, setOpenQuestions] = useState(() => new Set([0]));
  const [pdfDownloading, setPdfDownloading] = useState(false);
  const PAGE_SIZE = 5;

  const roleOptions = useMemo(() => {
    const roles = new Set();
    (interviews || []).forEach((iv) => {
      const role = cleanText(iv.roleDomain);
      if (role) roles.add(role);
    });
    return Array.from(roles).sort((a, b) => a.localeCompare(b));
  }, [interviews]);

  const filteredInterviews = useMemo(() => {
    return (interviews || []).filter((iv) => {
      const role = cleanText(iv.roleDomain) || 'Role Not Selected';
      if (roleFilter !== 'all' && role !== roleFilter) return false;

      const key = toDateKey(iv.completedAt || iv.createdAt);
      if (dateFrom && (!key || key < dateFrom)) return false;
      if (dateTo && (!key || key > dateTo)) return false;
      return true;
    });
  }, [interviews, roleFilter, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(filteredInterviews.length / PAGE_SIZE));
  const currentPage = Math.min(listPage, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pagedInterviews = filteredInterviews.slice(pageStart, pageStart + PAGE_SIZE);

  useEffect(() => {
    setListPage(1);
  }, [roleFilter, dateFrom, dateTo]);

  useEffect(() => {
    if (!filteredInterviews.length) return;
    const stillVisible = filteredInterviews.some((iv) => iv._id === selectedInterview?._id);
    if (!stillVisible) {
      onSelect?.(filteredInterviews[0]._id);
    }
  }, [filteredInterviews, selectedInterview?._id, onSelect]);

  useEffect(() => {
    if (!selectedInterview?._id) return;
    const idx = filteredInterviews.findIndex((iv) => iv._id === selectedInterview._id);
    if (idx < 0) return;
    const pageForSelected = Math.floor(idx / PAGE_SIZE) + 1;
    setListPage((page) => (page === pageForSelected ? page : pageForSelected));
  }, [selectedInterview?._id, filteredInterviews]);

  useEffect(() => {
    setOpenQuestions(new Set([0]));
  }, [selectedInterview?._id]);

  if (!interviews || interviews.length === 0) {
    return (
      <div className="results-empty results-empty--pro">
        <div className="results-empty-copy">
          <p className="results-empty-kicker">Reports</p>
          <h2>No interview reports yet</h2>
          <p>Complete a VFSTR.AI mock interview to see your scorecard, feedback, and practice plan here.</p>
          {onStartInterview ? (
            <button type="button" className="results-empty-cta" onClick={onStartInterview}>
              Start interview
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const clearFilters = () => {
    setRoleFilter('all');
    setDateFrom('');
    setDateTo('');
  };

  const hasActiveFilters = roleFilter !== 'all' || dateFrom || dateTo;

  const toggleQuestion = (idx) => {
    setOpenQuestions((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const expandAllQuestions = (count) => {
    setOpenQuestions(new Set(Array.from({ length: count }, (_, i) => i)));
  };

  const collapseAllQuestions = () => setOpenQuestions(new Set());

  return (
    <div className="practice-layout practice-layout--stack">

      {/* ── TOP: Interview chooser ─────────────────────── */}
      <div className="sessions-panel sessions-panel--strip">
        <div className="sessions-panel-header">
          <h3>Your sessions</h3>
          <span className="sessions-panel-count">{filteredInterviews.length}</span>
        </div>

        <div className="sessions-filters sessions-filters--inline">
          <label className="sessions-filter sessions-filter--role">
            <span>Role</span>
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              <option value="all">All roles</option>
              {roleOptions.map((role) => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>
          </label>
          <div className="sessions-filters-row">
            <label className="sessions-filter">
              <span>From</span>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </label>
            <label className="sessions-filter">
              <span>To</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </label>
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              className="sessions-filter-clear"
              onClick={clearFilters}
            >
              Clear filters
            </button>
          )}
        </div>

        <div className="sessions-list sessions-list--horizontal">
          {filteredInterviews.length === 0 ? (
            <div className="sessions-empty-filter">
              No interviews match these filters.
            </div>
          ) : (
            pagedInterviews.map((iv) => {
              const candidate = getCandidateInfo(iv, {}, user);
              const score = iv.totalScore != null ? Number(iv.totalScore) : null;
              const isActive = selectedInterview?._id === iv._id;
              const tone = score == null ? 'muted' : score >= 70 ? 'good' : score >= 40 ? 'ok' : 'muted';
              return (
                <button
                  key={iv._id}
                  type="button"
                  className={`session-item session-item--chip${isActive ? ' active' : ''}`}
                  onClick={() => onSelect(iv._id)}
                >
                  <span className="session-item-avatar" aria-hidden="true">{getInitials(candidate.name)}</span>
                  <div className="session-item-body">
                    <div className="session-item-top">
                      <span className="session-item-title" title={candidate.name}>{candidate.name}</span>
                      <span className={`session-item-score session-item-score--${tone}`}>
                        {score != null ? score.toFixed(0) : '—'}
                      </span>
                    </div>
                    <p className="session-item-line">
                      {candidate.role}
                      <span aria-hidden="true"> · </span>
                      {candidate.company}
                    </p>
                    <p className="session-item-line session-item-line--soft">{candidate.date}</p>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {filteredInterviews.length > PAGE_SIZE && (
          <div className="sessions-pagination">
            <span className="sessions-page-info">
              {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, filteredInterviews.length)} of {filteredInterviews.length}
            </span>
            <div className="sessions-page-controls">
              <button
                type="button"
                className="sessions-page-btn"
                disabled={currentPage <= 1}
                onClick={() => setListPage((p) => Math.max(1, p - 1))}
              >
                Prev
              </button>
              <span className="sessions-page-count">
                {currentPage}/{totalPages}
              </span>
              <button
                type="button"
                className="sessions-page-btn"
                disabled={currentPage >= totalPages}
                onClick={() => setListPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── BELOW: Report detail ─────────────────────── */}
      <div className="results-detail">

        {loading && (
          <div className="results-loading-card results-loading-card--inline">
            <span className="results-loading-spinner" aria-hidden="true" />
            <p>Loading report…</p>
          </div>
        )}

        {!loading && report && selectedInterview && (() => {
          const candidate = getCandidateInfo(selectedInterview, report, user);
          const attemptedFallback = (selectedInterview.questions || [])
            .slice(0, Math.min(
              selectedInterview.questions?.length ?? 0,
              selectedInterview.status === 'Terminated'
                && selectedInterview.terminationQuestionIndex != null
                ? Math.max(
                  Number(selectedInterview.currentQuestionIndex ?? 0),
                  Number(selectedInterview.terminationQuestionIndex) + 1,
                )
                : Number(selectedInterview.currentQuestionIndex ?? selectedInterview.questions?.length ?? 0),
            ))
            .filter((item) => {
              const answer = String(item.userAnswer ?? '').trim();
              if (answer) return true;
              return typeof item.score === 'number'
                && Number.isFinite(item.score)
                && String(item.feedback ?? '').trim();
            });
          const qa = (report.questionAnalysis?.length ? report.questionAnalysis : attemptedFallback)
            .filter((item) => {
              const answer = String(item.answer ?? item.userAnswer ?? '').trim();
              if (answer && answer !== '(no answer)') return true;
              return typeof item.score === 'number'
                && Number.isFinite(item.score)
                && String(item.feedback ?? item.whatWorked ?? '').trim();
            });
          const sectionScores = deriveSectionScores({ report, qa, selectedInterview });
          const strengths = collectStrengths(report, qa);
          const improvements = collectImprovements(report, qa, sectionScores);
          const learningRoadmap = deriveLearningRoadmap({ report, sectionScores, qa });
          const totalPlanned = report.totalPlannedQuestions
            || selectedInterview.totalPlannedQuestions
            || qa.length;
          const questionsAnswered = report.questionsAnswered ?? qa.filter((item) => !isSkippedAnswer(item)).length;
          const endedEarly = report.endedEarly || selectedInterview.status === 'Terminated' || questionsAnswered < totalPlanned;

          return (
            <>
              {/* 1. Snapshot */}
              <section className="report-scorecard-section report-snapshot-section">
                <div className="report-section-heading">
                  <span>01 · Snapshot</span>
                  <h3>Interview overview</h3>
                </div>
              <div className="results-hero report-scorecard-hero report-brief-hero">
                <div className="results-hero-top">
                  <div className="report-candidate-heading">
                    <div className="report-hero-title-row">
                      <p className="report-hero-kicker">Interview report</p>
                      {endedEarly && (
                        <span className="report-status-badge report-status-badge--warning">Ended early</span>
                      )}
                      {!endedEarly && (
                        <span className="report-status-badge report-status-badge--complete">Completed</span>
                      )}
                    </div>
                    <h3>{candidate.name}</h3>
                    <p className="report-candidate-role">{candidate.role} · {candidate.company}</p>
                    {candidate.email && <span className="report-candidate-email">{candidate.email}</span>}
                    {endedEarly && (
                      <div className="report-integrity-alert report-early-end-note">
                        <strong>Interview ended early</strong>
                        <p>
                          {report.sessionNote
                            || `${report.questionsAnswered ?? qa.length} of ${totalPlanned} questions answered.`}
                          {selectedInterview.terminationReason
                            ? ` · ${integrityReasonLabel(selectedInterview.terminationReason)}`
                            : ''}
                        </p>
                        {report.scoreConfidenceNote ? <p>{report.scoreConfidenceNote}</p> : null}
                      </div>
                    )}
                    <p className="report-hiring-chance">
                      <span>Hiring chance</span>
                      <strong>{formatHiringChance(report)}</strong>
                    </p>
                    {getSnapshotExplanation(report) ? (
                      <p className="report-hiring-chance-note">{getSnapshotExplanation(report)}</p>
                    ) : null}
                  </div>
                  <div className="results-hero-score-block">
                    <div
                      className="score-ring"
                      style={{
                        '--score-deg': scoreToDeg(report.overallScore),
                        '--score-color': scoreColor(report.overallScore),
                      }}
                    >
                      <div className="score-text">
                        {formatScore(report.overallScore)}
                        <span className="score-text-label">/ 100</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="report-download-btn"
                      disabled={pdfDownloading}
                      aria-busy={pdfDownloading}
                      onClick={async () => {
                        setPdfDownloading(true);
                        await downloadBrandedReportPdf({
                          interviewId: selectedInterview._id,
                          candidateName: candidate.name,
                          role: candidate.role,
                          onError: (message) => toast.error(message),
                        });
                        setPdfDownloading(false);
                      }}
                    >
                      {pdfDownloading ? 'Generating PDF…' : 'Download PDF'}
                    </button>
                  </div>
                </div>
                <ul className="report-meta-chips">
                  <li><span>Role</span><strong>{candidate.role}</strong></li>
                  <li><span>Company</span><strong>{candidate.company}</strong></li>
                  <li><span>Date</span><strong>{candidate.date}</strong></li>
                  <li><span>Duration</span><strong>{candidate.duration}</strong></li>
                  <li><span>Type</span><strong>{candidate.interviewType}</strong></li>
                  <li><span>Level</span><strong>{candidate.difficulty}</strong></li>
                  <li><span>Questions answered</span><strong>{questionsAnswered}/{totalPlanned}</strong></li>
                </ul>
              </div>
              </section>

              {/* 2. Section readiness */}
              <section className="report-scorecard-section">
                <div className="report-section-heading">
                  <span>02 · Section readiness</span>
                  <h3>Section readiness</h3>
                </div>
                <div className="report-section-score-grid">
                  {sectionScores.map((section) => {
                    const evaluated = section.value != null;
                    return (
                      <div
                        key={section.key}
                        className={`report-section-score-card${evaluated ? '' : ' report-section-score-card--empty'}`}
                      >
                        <div className="report-section-score-copy">
                          <h4>{section.label}</h4>
                          <p>{section.note}</p>
                        </div>
                        <div className="report-section-score-track-wrap">
                          <div className="report-section-score-track">
                            <div
                              className="report-section-score-fill"
                              style={{
                                width: evaluated ? `${Math.min(100, section.value)}%` : '0%',
                                background: scoreColor(section.value),
                                opacity: evaluated && section.value > 0 ? 1 : 0.25,
                              }}
                            />
                          </div>
                          <strong style={{ color: scoreColor(section.value) }}>
                            {evaluated ? section.value : '—'}
                          </strong>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* 3 + 4. Strengths / Improvements */}
              <div className="feedback-cards report-brief-feedback">
                <div className="feedback-card feedback-card--strengths">
                  <h4>03 · Strengths</h4>
                  <ul>
                    {strengths.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
                <div className="feedback-card feedback-card--focus">
                  <h4>04 · Areas to improve</h4>
                  <ul>
                    {improvements.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              </div>

              {/* 5. Learning roadmap */}
              <section className="report-scorecard-section report-roadmap-section">
                <div className="report-section-heading">
                  <span>05 · Practice plan</span>
                  <h3>What to practice next</h3>
                </div>
                <ol className="report-roadmap-list">
                  {learningRoadmap.map((item, index) => (
                    <li key={`${item}-${index}`}>{item}</li>
                  ))}
                </ol>
              </section>

              {/* 6. Question-by-question */}
              {qa.length > 0 && (
                <section className="report-scorecard-section report-qa-section">
                  <div className="report-section-heading report-qa-heading-row">
                    <div>
                      <span>06 · Question review</span>
                      <h3>Question-by-question review</h3>
                    </div>
                    <div className="report-qa-toolbar">
                      <button type="button" className="report-qa-tool-btn" onClick={() => expandAllQuestions(qa.length)}>
                        Expand all
                      </button>
                      <button type="button" className="report-qa-tool-btn" onClick={collapseAllQuestions}>
                        Collapse
                      </button>
                    </div>
                  </div>

                  <div className="report-qa-list">
                    {qa.map((item, idx) => {
                      const qScore = typeof item.score === 'number' ? item.score : null;
                      const qColor = scoreColor(qScore);
                      const isOpen = openQuestions.has(idx);
                      const skipped = isSkippedAnswer(item);
                      const answerText = skipped
                        ? null
                        : cleanText(item.answer || item.userAnswer);
                      const suggestedImprovedAnswer = getStoredSuggestedImprovedAnswer(item);
                      const conceptsToRevise = getConceptsToRevise(item);

                      return (
                        <div key={idx} className={`report-qa-card${isOpen ? ' is-open' : ''}`}>
                          <button
                            type="button"
                            className="report-qa-summary"
                            onClick={() => toggleQuestion(idx)}
                            aria-expanded={isOpen}
                          >
                            <span className="report-q-num">Q{idx + 1}</span>
                            <span className="report-qa-summary-question">{item.question}</span>
                            <span className="report-q-score" style={{ color: qColor }}>
                              {qScore != null ? `${qScore}/100` : '—'}
                            </span>
                            <span className="report-qa-chevron" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                          </button>

                          {isOpen && (
                            <div className="report-qa-body">
                              <div className="report-qa-detail-block">
                                <span className="report-answer-label">Question</span>
                                <p>{item.question}</p>
                              </div>
                              <div className="report-answer">
                                <span className="report-answer-label">Candidate&apos;s answer</span>
                                {skipped
                                  ? <em className="report-skipped-badge">Skipped</em>
                                  : answerText}
                              </div>
                              {suggestedImprovedAnswer ? (
                                <div className="report-feedback-box report-feedback-box--wide">
                                  <span>Suggested improved answer</span>
                                  <p>{suggestedImprovedAnswer}</p>
                                </div>
                              ) : null}
                              {conceptsToRevise.length > 0 ? (
                                <div className="report-feedback-box">
                                  <span>Concepts to revise</span>
                                  <div className="report-concept-tags">
                                    {conceptsToRevise.map((concept) => <em key={concept}>{concept}</em>)}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
            </>
          );
        })()}

        {!loading && !report && selectedInterview && (
          <div className="results-empty results-empty--inline">
            <span className="results-empty-icon" aria-hidden="true">📋</span>
            <h2>Report not available</h2>
            <p>The report for this interview could not be loaded. Try again in a moment.</p>
          </div>
        )}
      </div>
    </div>
  );
};
