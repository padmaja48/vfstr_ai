import {
  aggregateSessionStrengths,
  buildDifficultyProgressionSummary,
  classifyAnswerTurn,
  computeCompanyReadinessScore,
  dedupeTranscriptItems,
  extractSpeakerNameFromAnswer,
  inferQuestionTypeFromContent,
  isNearDuplicateQuestion,
  questionCosineSimilarity,
  sanitizeGroundedFeedbackText,
} from '../services/interviewReport.utils';

describe('interviewReport.utils', () => {
  it('extracts a self-stated speaker name from intro answers', () => {
    const extracted = extractSpeakerNameFromAnswer(
      "Hi, my name is Komal Shri. I'm a final year student interested in HR roles.",
      'Tell me about yourself.',
    );

    expect(extracted.name).toBe('Komal Shri');
    expect(extracted.confidence).toBe('high');
  });

  it('dedupes consecutive duplicate questions before report generation', () => {
    const duplicateQuestion = 'Explain your internship project in detail.';
    const transcript = dedupeTranscriptItems([
      { question: 'Tell me about yourself.', answer: 'My name is Komal.', score: 40 },
      { question: duplicateQuestion, answer: 'First answer', score: 30 },
      { question: duplicateQuestion, answer: 'First answer', score: 30 },
      { question: 'Why this role?', answer: 'Because I like HR.', score: 50 },
    ]);

    expect(transcript).toHaveLength(3);
    expect(transcript[1].question).toBe(duplicateQuestion);
  });

  it('detects near-duplicate question text', () => {
    expect(
      isNearDuplicateQuestion(
        'Explain your internship project in detail?',
        'Explain your internship project in detail.',
      ),
    ).toBe(true);
  });

  it('detects paraphrased near-duplicates via token overlap (E14)', () => {
    expect(
      isNearDuplicateQuestion(
        'Walk me through how you built the PDF Knowledge Chatbot retrieval pipeline.',
        'Explain how you built the PDF Knowledge Chatbot retrieval pipeline in detail.',
      ),
    ).toBe(true);
  });

  it('detects semantic near-duplicates via cosine features (E14)', () => {
    const left = 'Can you describe the architecture of your Blood Donation Platform?';
    const right = 'Walk me through the design of the Blood Donation Platform you built.';
    // Alias-folded Jaccard / cosine should catch paraphrase pairs.
    expect(isNearDuplicateQuestion(left, right)).toBe(true);
    expect(
      questionCosineSimilarity(
        'Explain the PDF Knowledge Chatbot retrieval pipeline you built',
        'Describe the PDF Knowledge Chatbot retrieval pipeline you implemented',
      ),
    ).toBeGreaterThan(0.75);
    expect(
      isNearDuplicateQuestion(
        'Why do you want to join Amazon?',
        'Explain time complexity of binary search.',
      ),
    ).toBe(false);
  });

  it('relabels generic project follow-ups as behavioural for HR mode', () => {
    const question =
      'In your work on wikipedia page, how did HR / Behavioral factor in, and what would you do differently today?';
    expect(inferQuestionTypeFromContent(question, 'hr_behavioral', 'technical')).toBe('behavioural');
  });

  it('aggregates strengths from per-question feedback instead of returning empty', () => {
    const strengths = aggregateSessionStrengths(
      [
        {
          score: 20,
          answer: 'I mentioned HR work.',
          dynamicFeedback: { strengths: ['Mentioned relevant HR exposure from internship.'] },
        },
        {
          score: 10,
          answer: 'Could you explain the second part of the question?',
          dynamicFeedback: { strengths: ['Asked for clarification instead of guessing.'] },
        },
      ],
      ['Provided basic information.'],
    );

    expect(strengths.length).toBeGreaterThanOrEqual(2);
    expect(strengths.join(' ')).toMatch(/HR exposure|clarification|basic information/i);
  });

  it('builds one difficulty progression line per question', () => {
    const progression = buildDifficultyProgressionSummary([
      { difficulty: 'easy', score: 10 },
      { difficulty: 'medium', score: 55 },
      { difficulty: 'hard', score: 80 },
      { difficulty: 'medium', score: 0 },
    ]);

    expect(progression).toHaveLength(4);
    expect(progression[0]).toMatch(/^Q1 \(easy\):/);
    expect(progression[3]).toMatch(/^Q4 \(medium\):/);
  });

  it('computes company readiness separately from overall score when company mentions are absent', () => {
    const score = computeCompanyReadinessScore(
      [
        { answer: 'I worked on an internship project with stakeholders.', score: 28 },
        { answer: 'I handled team communication during events.', score: 30 },
      ],
      { targetCompany: 'tcs', overallScore: 28 },
    );

    expect(score).not.toBe(28);
  });

  it('classifies clarification requests separately from weak answers', () => {
    expect(
      classifyAnswerTurn('I could not understand why will I inform my interactions with students, could you explain me that second part of the question'),
    ).toBe('clarification_request');
  });

  it('strips invented tools from Ideal/Improved text when not in resume grounding (H03, H04)', () => {
    const cleaned = sanitizeGroundedFeedbackText(
      'Ideal answer should mention NER and POS tagging with pytest coverage for the PDF Converter.',
      {
        projects: ['PDF Knowledge Chatbot'],
        skills: ['Python', 'FAISS', 'LangChain'],
        answer: 'I used FAISS for retrieval.',
        question: 'How did you build the chatbot?',
      },
    );

    expect(cleaned).not.toMatch(/\bNER\b/i);
    expect(cleaned).not.toMatch(/\bPOS\b/i);
    expect(cleaned).not.toMatch(/\bpytest\b/i);
    expect(cleaned).toMatch(/PDF Knowledge Chatbot/i);
  });
});
