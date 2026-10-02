import {
  BANNED_REPORT_AI_SPEAK,
  buildMentorTranscriptSummary,
  deriveReportScoresFromTranscript,
  humanizeReportText,
  refineInterviewReport,
} from '../services/interviewReport.utils';

describe('report feedback voice and score alignment', () => {
  it('strips common AI-speak phrases and uses second person', () => {
    const raw =
      "Overall, the candidate demonstrated strong performance. Furthermore, it's worth noting that they showed good understanding.";
    const cleaned = humanizeReportText(raw);
    expect(cleaned.toLowerCase()).not.toMatch(/overall,|furthermore,|the candidate demonstrated/);
    expect(cleaned).toMatch(/\byou\b/i);
  });

  it('flags every banned stock phrase pattern from the audit list', () => {
    const auditSamples = [
      'Overall, you did fine.',
      "In conclusion, you'd benefit from more depth.",
      "It's worth noting that you skipped metrics.",
      'Furthermore, your API answer was thin.',
      'The candidate demonstrated solid SQL skills.',
      'Great job overall!',
      'You could potentially improve possibly.',
    ];
    for (const sample of auditSamples) {
      const cleaned = humanizeReportText(sample);
      for (const banned of BANNED_REPORT_AI_SPEAK) {
        expect(cleaned.toLowerCase()).not.toContain(banned.toLowerCase());
      }
    }
  });

  it('derives category scores from per-question transcript scores', () => {
    const transcript = [
      {
        question: 'Explain your PDF chatbot architecture.',
        answer: 'I used LangChain and FAISS with chunking.',
        score: 80,
        questionType: 'technical' as const,
      },
      {
        question: 'Tell me about a time you handled conflict.',
        answer: 'During my internship I mediated a deadline dispute.',
        score: 60,
        questionType: 'behavioural' as const,
      },
    ];
    const derived = deriveReportScoresFromTranscript(transcript);
    expect(derived.overallScore).toBe(70);
    expect(derived.technicalScore).toBe(80);
    expect(derived.behavioralScore).toBe(60);
  });

  it('replaces contradictory praise when score is weak', () => {
    const refined = refineInterviewReport(
      {
        overallScore: 99,
        transcriptSummary: 'Excellent performance overall — the candidate demonstrated outstanding skills.',
        strengths: ['Great job!', 'The candidate showed strong leadership', 'Perfect answers throughout'],
        improvements: ['Minor polish only'],
        hiringRecommendation: 'Strong Hire',
        hiringRecommendationReason: 'Outstanding work across the board.',
        questionAnalysis: [],
      },
      {
        transcript: [
          {
            question: 'How did you build the chatbot?',
            answer: 'I used Python.',
            score: 28,
            feedback: 'You named Python but skipped chunking, embeddings, and latency.',
            dynamicFeedback: {
              areasToImprove: ['Add how you chunked PDFs and measured retrieval quality.'],
            },
          },
        ],
        answeredCount: 1,
        totalCount: 1,
        participationRatio: 1,
        speakerName: 'Padmaja',
      },
    );

    expect(refined.overallScore).toBe(28);
    expect(refined.transcriptSummary?.toLowerCase()).not.toMatch(/excellent|outstanding|great job/);
    expect(refined.transcriptSummary).toMatch(/28\/100|padmaja/i);
    expect(refined.strengths?.length ?? 0).toBeLessThanOrEqual(2);
    expect(refined.hiringRecommendation).toBe('No Hire');
  });

  it('mentor summaries match score bands', () => {
    const weak = buildMentorTranscriptSummary({
      overallScore: 32,
      answeredCount: 3,
      totalCount: 5,
      topGap: 'Add metrics when you describe project impact.',
    });
    const strong = buildMentorTranscriptSummary({
      overallScore: 88,
      answeredCount: 5,
      totalCount: 5,
      topStrength: 'Your LangChain + FAISS walkthrough was specific.',
    });
    expect(weak.toLowerCase()).toMatch(/32\/100|surface|rehearse/);
    expect(strong.toLowerCase()).toMatch(/88\/100|strong/);
    expect(weak.toLowerCase()).not.toMatch(/excellent|outstanding/);
  });
});
