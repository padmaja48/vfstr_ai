import { buildReportHtml } from '../services/report/reportPdf.template';
import { normalizeReportData } from '../services/report/normalizeReportData';

const SNAPSHOT_EXPLANATION =
  'Your performance shows potential, but significant improvements in clarity and structure are needed to be fully ready for interviews';

const buildHtmlForScore = (overallScore: number) => {
  const data = normalizeReportData({
    report: {
      overallScore,
      technicalScore: overallScore,
      communicationScore: overallScore,
      hiringRecommendation: 'No Hire',
      hiringRecommendationReason: SNAPSHOT_EXPLANATION,
      transcriptSummary: 'Executive summary text that should not appear in PDF.',
      strengths: ['Clear communication'],
      improvements: ['Add more technical depth'],
      recommendations: ['Practice system design'],
      missedConcepts: ['hash maps'],
      difficultyProgression: ['Easy', 'Medium'],
      questionAnalysis: [
        {
          question: 'Explain binary search.',
          answer: 'It halves the search space each step.',
          score: overallScore,
          whatWorked: 'Correct intuition',
          whatToImprove: 'Missing complexity',
          idealAnswer: 'Binary search runs in O(log n).',
          samplePerfectAnswer: 'Use two pointers and halve each iteration.',
          missingConcepts: ['time complexity'],
        },
      ],
    },
    interview: {
      roleDomain: 'Software Engineer',
      interviewType: 'Technical',
      complexity: 'Medium',
      duration: 30,
      completedAt: '2026-08-27T10:00:00.000Z',
      totalPlannedQuestions: 5,
    },
    user: { name: 'Presentation Test Candidate' },
    previousOverallScore: 30,
  });

  return buildReportHtml(data);
};

describe('report PDF presentation', () => {
  it.each([
    [40, '40%'],
    [75, '75%'],
    [100, '100%'],
  ])('shows Hiring Chance derived from overall score %i', (score, expected) => {
    const html = buildHtmlForScore(score);
    expect(html).toContain('Hiring Chance');
    expect(html).toContain(`<p class="hiring-chance-value">${expected}</p>`);
    expect(html).toContain(`<strong>${score}</strong>`);
  });

  it('shows snapshot explanation below Hiring Chance from stored report data', () => {
    const html = buildHtmlForScore(68);
    const hiringIdx = html.indexOf('Hiring Chance');
    const explanationIdx = html.indexOf(SNAPSHOT_EXPLANATION);
    expect(explanationIdx).toBeGreaterThan(hiringIdx);
    expect(html).toContain(SNAPSHOT_EXPLANATION);
  });

  it('omits removed report sections and evaluation detail blocks', () => {
    const html = buildHtmlForScore(68);

    expect(html).not.toMatch(/Executive Summary/i);
    expect(html).not.toMatch(/Extras/i);
    expect(html).not.toMatch(/Hiring Signal/i);
    expect(html).not.toMatch(/\bHire\b/);
    expect(html).not.toMatch(/No Hire/i);
    expect(html).not.toMatch(/Difficulty Progression/i);
    expect(html).not.toMatch(/What was correct/i);
    expect(html).not.toMatch(/What was missing/i);
    expect(html).not.toMatch(/Ideal Answer/i);
    expect(html).not.toMatch(/Executive summary text that should not appear/i);
  });

  it('keeps required sections in order', () => {
    const html = buildHtmlForScore(72);
    const snapshotIdx = html.indexOf('1. Snapshot');
    const readinessIdx = html.indexOf('2. Section Readiness');
    const strengthsIdx = html.indexOf('3. Strengths');
    const improveIdx = html.indexOf('4. Areas to Improve');
    const practiceIdx = html.indexOf('5. What to Practice Next');
    const questionsIdx = html.indexOf('6. Question-by-Question Review');

    expect(snapshotIdx).toBeGreaterThan(-1);
    expect(readinessIdx).toBeGreaterThan(snapshotIdx);
    expect(strengthsIdx).toBeGreaterThan(readinessIdx);
    expect(improveIdx).toBeGreaterThan(strengthsIdx);
    expect(practiceIdx).toBeGreaterThan(improveIdx);
    expect(questionsIdx).toBeGreaterThan(practiceIdx);
  });

  it('renders question review with answer, score, suggested improved answer, and concepts', () => {
    const html = buildHtmlForScore(72);

    expect(html).toContain('QUESTION 1 — 72/100');
    expect(html).toContain('Explain binary search.');
    expect(html).toContain('It halves the search space each step.');
    expect(html).toContain('Suggested Improved Answer');
    expect(html).toContain('Use two pointers and halve each iteration.');
    expect(html).toContain('Concepts to Revise');
    expect(html).toContain('time complexity');
    expect(html).not.toContain('Binary search runs in O(log n).');
  });

  it('gracefully omits optional question fields when stored data lacks them', () => {
    const data = normalizeReportData({
      report: {
        overallScore: 60,
        questionAnalysis: [{
          question: 'What is a linked list?',
          answer: 'A chain of nodes.',
          score: 60,
          idealAnswer: 'Nodes connected by pointers.',
        }],
      },
      interview: {
        roleDomain: 'Software Engineer',
        interviewType: 'Technical',
        duration: 30,
        completedAt: '2026-08-27T10:00:00.000Z',
      },
      user: { name: 'Legacy Candidate' },
    });
    const html = buildReportHtml(data);

    expect(html).toContain('A chain of nodes.');
    expect(html).not.toContain('Suggested Improved Answer');
    expect(html).not.toContain('Concepts to Revise');
    expect(html).not.toContain('Nodes connected by pointers.');
  });

  it('renders legacy stored evaluation fields without breaking layout', () => {
    const html = buildHtmlForScore(55);
    expect(html).toContain('Section Readiness');
    expect(html).toContain('Clear communication');
    expect(html).toContain('Add more technical depth');
    expect(html).toContain('Practice system design');
  });
});
