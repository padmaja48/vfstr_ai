import {
  buildCompactInterviewState,
  COMPACT_STATE_LIMITS,
  formatCompactInterviewStateBlock,
} from '../services/compactInterviewState';

describe('compactInterviewState', () => {
  it('limits recent turns and omits full history', () => {
    const history = Array.from({ length: 12 }, (_, index) => ({
      question: `Question ${index + 1}`,
      answer: `Answer ${index + 1}`,
      score: 50 + index,
      topic: `topic-${index % 4}`,
    }));

    const state = buildCompactInterviewState({
      interviewId: 'iv-1',
      questionIndex: 11,
      targetQuestionCount: 18,
      conversationHistory: history,
      previousQuestionTopics: ['topic-0', 'topic-1'],
      askedQuestionIds: history.map((_, index) => `q-${index}`).concat(
        Array.from({ length: 15 }, (_, index) => `extra-${index}`),
      ),
    });

    expect(state.recentTurns).toHaveLength(COMPACT_STATE_LIMITS.recentTurns);
    expect(state.recentTurns[0]?.question).toBe('Question 9');
    expect(state.remainingQuestions).toBe(6);
    expect(state.askedQuestionIds).toHaveLength(COMPACT_STATE_LIMITS.askedQuestionIds);
    expect(state.coveredTopics.length).toBeLessThanOrEqual(COMPACT_STATE_LIMITS.coveredTopics);
    expect(formatCompactInterviewStateBlock(state)).toContain('COMPACT INTERVIEW STATE');
    expect(formatCompactInterviewStateBlock(state)).not.toContain('"question": "Question 1"');
  });
});
