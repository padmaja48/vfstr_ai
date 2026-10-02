import { fixEncodingArtifacts, splitListLikeText, splitVerdictAndNote } from '../services/report/reportEncoding.utils';
import { normalizeReportData } from '../services/report/normalizeReportData';

describe('reportEncoding.utils', () => {
  it('fixes !\' and stray % artifacts without rewriting words', () => {
    expect(fixEncodingArtifacts("candidate!\'s approach")).toBe("candidate's approach");
    expect(fixEncodingArtifacts('score 72% accuracy on chunking')).toBe('score 72 accuracy on chunking');
    expect(fixEncodingArtifacts('It\u2019s worth noting')).toBe("It's worth noting");
  });

  it('splits bullet and semicolon run-on lists', () => {
    expect(splitListLikeText('First point; Second point; Third point')).toEqual([
      'First point',
      'Second point',
      'Third point',
    ]);
    expect(splitListLikeText('• One • Two • Three')).toEqual(['One', 'Two', 'Three']);
  });

  it('splits combined verdict and recommendation note', () => {
    expect(splitVerdictAndNote('Borderline — Recommendation is based on weak technical depth'))
      .toEqual({
        verdict: 'Borderline',
        note: 'Recommendation is based on weak technical depth',
      });
    expect(splitVerdictAndNote('Verdict: Hire — ready for campus shortlist')).toEqual({
      verdict: 'Hire',
      note: 'ready for campus shortlist',
    });
  });
});

describe('normalizeReportData', () => {
  const baseInterview = {
    roleDomain: 'Software Engineer',
    interviewType: 'Technical',
    complexity: 'Medium',
    duration: '45 Minutes',
    completedAt: '2026-08-27T10:00:00.000Z',
    candidateEmail: 'dev@example.com',
    totalPlannedQuestions: 5,
    currentQuestionIndex: 2,
    questions: [],
  };

  it('maps messy report JSON into clean schema without changing scores', () => {
    const rawReport = {
      overallScore: 68,
      technicalScore: 62,
      communicationScore: 74,
      confidenceScore: 70,
      hiringRecommendation: 'Borderline',
      hiringRecommendationReason: 'Recommendation is based on incomplete RAG explanation!\' and missing validation step',
      transcriptSummary: 'Overall, the candidate showed partial understanding. Furthermore, gaps remain in retrieval design.',
      strengths: ['Clear opening on project context; named real stack components'],
      improvements: ['Missing chunking strategy detail; No latency or validation metrics'],
      missedConcepts: ['vector index tuning', 'evaluation metrics'],
      difficultyProgression: ['Easy', 'Medium', 'Hard'],
      totalPlannedQuestions: 5,
      questionsAnswered: 2,
      questionsAttempted: 2,
      questionAnalysis: [
        {
          question: 'Explain your PDF chatbot pipeline.',
          answer: 'we took voltage of the PDF made chunks stored in Fire then crop model answers',
          score: 72,
          whatWorked: 'Mentioned chunking and storage.',
          whatToImprove: 'Missing embedding model and retrieval validation.',
          missingConcepts: ['embeddings', 'retrieval evaluation'],
          idealAnswer: 'Describe ingest → chunk → embed → retrieve → generate with validation.',
          samplePerfectAnswer: 'We ingested PDFs, chunked text, embedded with a vector model, retrieved top-k, then generated answers and checked citations.',
          difficulty: 'Medium',
        },
        {
          question: 'How do you handle production incidents?',
          answer: '(no answer)',
          score: 0,
          feedback: '',
        },
      ],
    };

    const clean = normalizeReportData({
      report: rawReport,
      interview: baseInterview,
      user: { name: 'Test Candidate' },
      previousOverallScore: 55,
    });

    expect(clean.summary.overallScore).toBe(68);
    expect(clean.summary.questionsAnswered).toBe(1);
    expect(clean.summary.verdict).toMatch(/Borderline/i);
    expect(clean.summary.recommendationNote).toMatch(/Recommendation is based on/);
    expect(clean.questions[0].candidateAnswer).toContain('voltage of the PDF');
    expect(clean.questions[0].candidateAnswer).not.toMatch(/We ingested PDFs/);
    expect(clean.questions[0].suggestedImprovedAnswer).toMatch(/ingested PDFs/i);
    expect(clean.strengths.length).toBeGreaterThan(0);
    expect(clean.areasToImprove.length).toBeGreaterThan(0);
    expect(clean.trend.previousScore).toBe(55);
    expect(clean.trend.currentScore).toBe(68);
    expect(clean.sectionReadiness.some((s) => s.category.includes('Technical'))).toBe(true);
  });

  it('preserves candidate answer verbatim aside from encoding fixes', () => {
    const clean = normalizeReportData({
      report: {
        overallScore: 50,
        questionAnalysis: [{
          question: 'Q1',
          answer: "it!\'s basically like we pipe pdf into model",
          score: 40,
          whatWorked: 'Attempted answer',
          whatToImprove: 'Needs structure',
        }],
      },
      interview: { ...baseInterview, roleDomain: 'Intern' },
    });

    expect(clean.questions[0].candidateAnswer).toBe("it's basically like we pipe pdf into model");
  });
});
