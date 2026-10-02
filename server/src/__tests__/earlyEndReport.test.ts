import {
  buildReportSessionMeta,
  buildReportTranscriptFromInterview,
  deriveReportScoresFromTranscript,
  isAttemptedInterviewQuestion,
  refineInterviewReport,
  sanitizeStoredReportForInterview,
} from '../services/interviewReport.utils';

describe('early-ended interview report scope', () => {
  const plannedQuestion = (index: number, overrides: Record<string, unknown> = {}) => ({
    question: [
      'Explain how you designed the PDF chatbot retrieval pipeline.',
      'Tell me about a time you resolved a production incident under deadline pressure.',
      'Walk through how you would design a rate limiter for a public API.',
      'Describe your approach to unit testing a React payment checkout flow.',
    ][index] || `Unique behavioral question ${index + 1} about leadership and metrics.`,
    questionType: index % 2 === 0 ? 'technical' : 'behavioural',
    score: 80 - index * 5,
    userAnswer: `Detailed answer for question ${index + 1} with enough content to score properly.`,
    feedback: 'Solid answer.',
    ...overrides,
  });

  const unreachedQuestion = (index: number) => ({
    question: `Planned unreached systems-design prompt ${index + 1} about sharding and replication trade-offs.`,
    questionType: 'technical',
  });

  it('ignores phantom score-zero slots without answers or feedback (Q1-only bug)', () => {
    const q1 = plannedQuestion(0, { score: 72 });
    const phantoms = Array.from({ length: 7 }, (_, i) => ({
      question: `Phantom planned question ${i + 2} about distributed cache invalidation strategies.`,
      questionType: 'technical',
      score: 0,
      userAnswer: '',
    }));

    const interview = {
      status: 'Completed',
      currentQuestionIndex: 1,
      totalPlannedQuestions: 18,
      questions: [q1, ...phantoms, ...Array.from({ length: 10 }, (_, i) => unreachedQuestion(i + 8))],
    };

    const transcript = buildReportTranscriptFromInterview(interview);
    expect(transcript).toHaveLength(1);
    expect(transcript[0].score).toBe(72);

    const derived = deriveReportScoresFromTranscript(transcript);
    expect(derived.overallScore).toBe(72);

    const meta = buildReportSessionMeta(interview, transcript);
    expect(meta.sessionNote).toMatch(/1 of 18 questions answered/);
  });

  it('sanitizeStoredReportForInterview strips legacy phantom questionAnalysis rows', () => {
    const q1 = plannedQuestion(0, { score: 65 });
    const interview = {
      status: 'Completed',
      currentQuestionIndex: 1,
      totalPlannedQuestions: 18,
      questions: [
        q1,
        ...Array.from({ length: 7 }, (_, i) => ({
          question: `Legacy phantom ${i + 2}`,
          score: 0,
          userAnswer: '',
        })),
      ],
    };
    const legacyReport = {
      overallScore: 8,
      communicationScore: 8,
      technicalScore: 8,
      behavioralScore: 8,
      questionAnalysis: Array.from({ length: 8 }, (_, i) => ({
        question: i === 0 ? q1.question : `Legacy phantom ${i + 1}`,
        answer: i === 0 ? q1.userAnswer : '(no answer)',
        score: i === 0 ? 65 : 0,
        feedback: i === 0 ? q1.feedback : 'No answer was provided.',
      })),
    };

    const sanitized = sanitizeStoredReportForInterview(legacyReport, interview) as Record<string, any>;
    expect(sanitized.questionAnalysis).toHaveLength(1);
    expect(sanitized.overallScore).toBe(65);
    expect(sanitized.sessionNote).toMatch(/1 of 18 questions answered/);
  });

  it('filters transcript to attempted questions only', () => {
    const interview = {
      totalPlannedQuestions: 18,
      currentQuestionIndex: 3,
      questions: [
        plannedQuestion(0),
        plannedQuestion(1),
        plannedQuestion(2),
        ...Array.from({ length: 15 }, (_, i) => unreachedQuestion(i + 3)),
      ],
    };

    const transcript = buildReportTranscriptFromInterview(interview);
    expect(transcript).toHaveLength(3);
    expect(isAttemptedInterviewQuestion(unreachedQuestion(0) as { userAnswer?: string; score?: number; feedback?: string })).toBe(false);
  });

  it('scores only attempted questions — no dilution from unreached planned slots', () => {
    const transcript = buildReportTranscriptFromInterview({
      questions: [
        plannedQuestion(0, { score: 90 }),
        plannedQuestion(1, { score: 60 }),
        plannedQuestion(2, { score: 30 }),
        ...Array.from({ length: 15 }, (_, i) => unreachedQuestion(i)),
      ],
    });

    const derived = deriveReportScoresFromTranscript(transcript);
    expect(derived.overallScore).toBe(60);
    expect(derived.technicalScore).toBe(60);
  });

  it('builds early-end session metadata for manual end and termination', () => {
    const transcript = buildReportTranscriptFromInterview({
      totalPlannedQuestions: 18,
      status: 'Completed',
      questions: [plannedQuestion(0), plannedQuestion(1), plannedQuestion(2), unreachedQuestion(0)],
    });

    const manualMeta = buildReportSessionMeta(
      { status: 'Completed', totalPlannedQuestions: 18, questions: [] },
      transcript,
    );
    expect(manualMeta.endedEarly).toBe(true);
    expect(manualMeta.endReason).toBe('manual_early');
    expect(manualMeta.sessionNote).toMatch(/3 of 18 questions answered/);

    const terminatedMeta = buildReportSessionMeta(
      {
        status: 'Terminated',
        totalPlannedQuestions: 18,
        terminationReason: 'integrity_violation:tab_switch',
        questions: [],
      },
      transcript,
    );
    expect(terminatedMeta.endReason).toBe('terminated');
    expect(terminatedMeta.sessionNote).toMatch(/tab switch/i);
  });

  it('adds low-confidence note when only 1-2 substantive answers exist', () => {
    const transcript = buildReportTranscriptFromInterview({
      totalPlannedQuestions: 18,
      questions: [plannedQuestion(0), unreachedQuestion(0)],
    });
    const meta = buildReportSessionMeta({ totalPlannedQuestions: 18, questions: [] }, transcript);
    expect(meta.scoreConfidenceNote).toMatch(/Limited data/i);
  });

  it('refineInterviewReport prepends early-end session note to summary', () => {
    const transcript = buildReportTranscriptFromInterview({
      totalPlannedQuestions: 18,
      questions: [plannedQuestion(0), plannedQuestion(1), plannedQuestion(2), unreachedQuestion(0)],
    });
    const sessionMeta = buildReportSessionMeta(
      { status: 'Terminated', totalPlannedQuestions: 18, terminationReason: 'integrity_violation:fullscreen_exit' },
      transcript,
    );

    const refined = refineInterviewReport(
      {
        overallScore: 70,
        transcriptSummary: 'You showed solid fundamentals in the answers you gave.',
        questionAnalysis: [],
      },
      {
        transcript,
        answeredCount: sessionMeta.questionsAnswered,
        totalCount: sessionMeta.totalPlannedQuestions,
        participationRatio: sessionMeta.questionsAnswered / sessionMeta.totalPlannedQuestions,
        endedEarly: sessionMeta.endedEarly,
        sessionNote: sessionMeta.sessionNote,
      },
    );

    expect(refined.overallScore).toBe(75);
    expect(refined.transcriptSummary).toMatch(/3 of 18 questions answered/i);
    expect(refined.transcriptSummary).toMatch(/fullscreen exit/i);
  });

  it('fully completed sessions are not marked ended early', () => {
    const questions = Array.from({ length: 4 }, (_, i) => plannedQuestion(i, { score: 75 }));
    const transcript = buildReportTranscriptFromInterview({
      totalPlannedQuestions: 4,
      currentQuestionIndex: 4,
      status: 'Completed',
      questions,
    });
    const sessionMeta = buildReportSessionMeta(
      { status: 'Completed', totalPlannedQuestions: 4, currentQuestionIndex: 4, questions },
      transcript,
    );

    expect(sessionMeta.endedEarly).toBe(false);
    expect(transcript).toHaveLength(4);
    expect(deriveReportScoresFromTranscript(transcript).overallScore).toBe(75);
  });
});
