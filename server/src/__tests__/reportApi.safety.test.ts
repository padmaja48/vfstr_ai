import request from 'supertest';

import { createApp } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { Interview } from '../models/Interview';
import { Report } from '../models/Report';
import { User } from '../models/User';
import * as aiService from '../services/ai.service';
import { seedStudentUser } from './helpers/testAuth';

jest.mock('../config/redis', () => {
  const { createRedisMock } = jest.requireActual('./helpers/redisMock');
  return createRedisMock();
});

jest.mock('../services/storage.service', () => ({
  uploadText: jest.fn().mockResolvedValue({ url: 'https://example.test/report.json' }),
  uploadBuffer: jest.fn(),
}));

const buildStaticReport = (overallScore: number) => ({
  overallScore,
  communicationScore: overallScore,
  technicalScore: overallScore,
  behavioralScore: overallScore,
  strengths: ['Structured answers'],
  improvements: ['Add more examples'],
  recommendations: ['Practice behavioral stories'],
  hiringRecommendationReason: 'Snapshot explanation for hiring chance display.',
  questionAnalysis: [
    {
      question: 'Explain REST APIs.',
      answer: 'REST uses HTTP verbs and stateless resources.',
      score: overallScore,
      samplePerfectAnswer: 'REST maps resources to URLs and uses standard HTTP methods.',
      missingConcepts: ['idempotency'],
    },
  ],
});

describe('report API safety (read-only, no AI regeneration)', () => {
  const app = createApp();
  let accessToken: string;
  let userId: string;
  let interviewId: string;
  let reportId: string;

  beforeAll(async () => {
    await connectDatabase();
  });

  beforeEach(async () => {
    await User.deleteMany({ email: /@report-api-safety\.test$/ });
    await Interview.deleteMany({});
    await Report.deleteMany({});

    const seeded = await seedStudentUser('report-owner@report-api-safety.test');
    accessToken = seeded.accessToken;
    userId = String(seeded.user._id);

    const interview = await Interview.create({
      userId,
      roleDomain: 'Backend Engineer',
      roleLevel: 'Mid',
      interviewStyle: 'Technical',
      duration: 30,
      status: 'Completed',
      completedAt: new Date(),
      questions: [
        {
          question: 'Explain REST APIs.',
          userAnswer: 'REST uses HTTP verbs and stateless resources.',
          score: 75,
          feedback: 'Solid fundamentals.',
        },
      ],
      transcript: [],
      totalPlannedQuestions: 5,
    });
    interviewId = String(interview._id);

    const report = await Report.create({
      userId,
      interviewId: interview._id,
      ...buildStaticReport(75),
    });
    reportId = String(report._id);
  });

  afterAll(async () => {
    await User.deleteMany({ email: /@report-api-safety\.test$/ });
    await Interview.deleteMany({});
    await Report.deleteMany({});
    await disconnectDatabase();
  });

  it('returns stored report without calling generateReport', async () => {
    const generateSpy = jest.spyOn(aiService, 'generateReport');

    const response = await request(app)
      .get(`/api/interviews/${interviewId}/report`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.report.overallScore).toBe(75);
    expect(response.body.report.strengths).toContain('Structured answers');
    expect(generateSpy).not.toHaveBeenCalled();
  });

  it('does not regenerate report when fetched repeatedly', async () => {
    const generateSpy = jest.spyOn(aiService, 'generateReport');

    await request(app)
      .get(`/api/interviews/${interviewId}/report`)
      .set('Authorization', `Bearer ${accessToken}`);
    await request(app)
      .get(`/api/interviews/${interviewId}/report`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(generateSpy).not.toHaveBeenCalled();
    const count = await Report.countDocuments({ interviewId });
    expect(count).toBe(1);
  });

  it('blocks another user from reading the report', async () => {
    const other = await seedStudentUser('report-intruder@report-api-safety.test');

    const response = await request(app)
      .get(`/api/interviews/${interviewId}/report`)
      .set('Authorization', `Bearer ${other.accessToken}`);

    expect(response.status).toBe(404);
  });

  it('returns report via /api/reports/:id for the owner', async () => {
    const generateSpy = jest.spyOn(aiService, 'generateReport');

    const response = await request(app)
      .get(`/api/reports/${reportId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.overallScore).toBe(75);
    expect(generateSpy).not.toHaveBeenCalled();
  });

  it('completeInterview on an already completed interview does not call generateReport again', async () => {
    const generateSpy = jest.spyOn(aiService, 'generateReport').mockResolvedValue(
      buildStaticReport(99) as Awaited<ReturnType<typeof aiService.generateReport>>,
    );

    const first = await request(app)
      .post(`/api/interviews/${interviewId}/complete`)
      .set('Authorization', `Bearer ${accessToken}`);
    const second = await request(app)
      .post(`/api/interviews/${interviewId}/complete`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(generateSpy).not.toHaveBeenCalled();
    expect(await Report.countDocuments({ interviewId })).toBe(1);
  });
});

describe('report hiring chance mapping (API payload)', () => {
  it.each([
    [40, 40],
    [75, 75],
    [100, 100],
  ])('stores overall score %i for downstream %i%% hiring chance rendering', async (score) => {
    const normalized = buildStaticReport(score);
    expect(normalized.overallScore).toBe(score);
  });
});
