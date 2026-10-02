import type { ConversationTurn } from './promptBuilder';

export const COMPACT_STATE_LIMITS = {
  recentTurns: 4,
  coveredTopics: 12,
  topicCoverageEntries: 8,
  answerScores: 10,
  strengths: 6,
  weaknesses: 6,
  weakAreas: 8,
  askedQuestionIds: 20,
} as const;

export type CompactInterviewState = {
  interviewId?: string;
  questionIndex: number;
  targetQuestionCount: number;
  remainingQuestions: number;
  currentTopic?: string;
  currentDifficulty?: string;
  recentTurns: Array<{
    question: string;
    answer?: string;
    score?: number;
    topic?: string;
    questionType?: string;
  }>;
  coveredTopics: string[];
  topicCoverage: Record<string, number>;
  answerScores: number[];
  strengths: string[];
  weaknesses: string[];
  weakAreas: string[];
  askedQuestionIds: string[];
};

const trimList = <T>(items: T[], max: number) => items.slice(-max);

const truncate = (value: string, max = 220) => {
  const trimmed = String(value || '').trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
};

export const buildCompactInterviewState = (input: {
  interviewId?: string;
  questionIndex: number;
  targetQuestionCount: number;
  conversationHistory: ConversationTurn[];
  previousQuestionTopics?: string[];
  askedQuestionIds?: string[];
  currentTopic?: string;
  currentDifficulty?: string;
  strengths?: string[];
  weaknesses?: string[];
  weakAreas?: string[];
}): CompactInterviewState => {
  const remainingQuestions = Math.max(0, input.targetQuestionCount - input.questionIndex - 1);
  const recentTurns = trimList(input.conversationHistory, COMPACT_STATE_LIMITS.recentTurns).map((turn) => ({
    question: truncate(turn.question, 180),
    answer: turn.answer ? truncate(turn.answer, 280) : undefined,
    score: turn.score,
    topic: turn.topic,
    questionType: turn.questionType,
  }));

  const topicCoverage: Record<string, number> = {};
  for (const turn of input.conversationHistory) {
    const topic = String(turn.topic || '').trim();
    if (!topic) continue;
    topicCoverage[topic] = (topicCoverage[topic] ?? 0) + 1;
  }
  const coveredTopics = trimList(
    [
      ...new Set([
        ...(input.previousQuestionTopics ?? []),
        ...Object.keys(topicCoverage),
      ].filter(Boolean)),
    ],
    COMPACT_STATE_LIMITS.coveredTopics,
  );

  const topicCoverageTrimmed = Object.fromEntries(
    Object.entries(topicCoverage).slice(-COMPACT_STATE_LIMITS.topicCoverageEntries),
  );

  const answerScores = trimList(
    input.conversationHistory
      .map((turn) => turn.score)
      .filter((score): score is number => typeof score === 'number' && Number.isFinite(score)),
    COMPACT_STATE_LIMITS.answerScores,
  );

  return {
    interviewId: input.interviewId,
    questionIndex: input.questionIndex,
    targetQuestionCount: input.targetQuestionCount,
    remainingQuestions,
    currentTopic: input.currentTopic,
    currentDifficulty: input.currentDifficulty,
    recentTurns,
    coveredTopics,
    topicCoverage: topicCoverageTrimmed,
    answerScores,
    strengths: trimList((input.strengths ?? []).filter(Boolean), COMPACT_STATE_LIMITS.strengths),
    weaknesses: trimList((input.weaknesses ?? []).filter(Boolean), COMPACT_STATE_LIMITS.weaknesses),
    weakAreas: trimList((input.weakAreas ?? []).filter(Boolean), COMPACT_STATE_LIMITS.weakAreas),
    askedQuestionIds: trimList((input.askedQuestionIds ?? []).filter(Boolean), COMPACT_STATE_LIMITS.askedQuestionIds),
  };
};

export const formatCompactInterviewStateBlock = (state: CompactInterviewState) =>
  `COMPACT INTERVIEW STATE (authoritative for this turn — do not assume hidden history beyond this):
${JSON.stringify(state, null, 2)}`;
