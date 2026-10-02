import request from 'supertest';

import { createApp } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { __testCreateInterviewReport } from '../controllers/interview.controller';
import { Interview } from '../models/Interview';
import { Report } from '../models/Report';
import { User } from '../models/User';
import {
  AiCallsDisabledError,
  assertAiCallsEnabled,
  isAiCallsEnabled,
} from '../services/aiCallGateway.service';
import * as companyQuestionBank from '../services/companyQuestionBank';
import * as aiService from '../services/ai.service';
import {
  __testResetCompanyQuestionResearchInFlight,
  ensureCompanyQuestions,
} from '../services/companyQuestionResearch.service';
import * as companyQuestionResearch from '../services/companyQuestionResearch.service';

jest.mock('../config/redis', () => {
  const store = new Map<string, Record<string, string>>();
  return {
    getRedis: () => ({
      hgetall: async (key: string) => store.get(key) || {},
      hset: async (key: string, data: Record<string, string>) => {
        store.set(key, { ...(store.get(key) || {}), ...data });
      },
      expire: async () => undefined,
      get: async () => null,
      set: async () => undefined,
      del: async (key: string) => {
        store.delete(key);
      },
    }),
  };
});

jest.mock('../services/storage.service', () => ({
  uploadText: jest.fn().mockResolvedValue({ url: 'https://example.test/report.json' }),
  uploadBuffer: jest.fn(),
}));

describe('unintended OpenAI call guards', () => {
  const originalAiCallsEnabled = process.env.AI_CALLS_ENABLED;

  afterEach(() => {
    if (originalAiCallsEnabled === undefined) delete process.env.AI_CALLS_ENABLED;
    else process.env.AI_CALLS_ENABLED = originalAiCallsEnabled;
    jest.restoreAllMocks();
    __testResetCompanyQuestionResearchInFlight();
  });

  it('health check does not invoke generateReport', async () => {
    const reportSpy = jest.spyOn(aiService, 'generateReport');
    const response = await request(createApp()).get('/api/health');
    expect([200, 503]).toContain(response.status);
    expect(reportSpy).not.toHaveBeenCalled();
  });

  it('blocks outbound AI when AI_CALLS_ENABLED=false', () => {
    process.env.AI_CALLS_ENABLED = 'false';
    expect(isAiCallsEnabled()).toBe(false);
    expect(() => assertAiCallsEnabled('test_operation')).toThrow(AiCallsDisabledError);
  });

  it('does not start background web research for thin verified company banks', async () => {
    jest.spyOn(companyQuestionBank, 'getCompanyQuestions').mockResolvedValue({
      mode: 'verified',
      companyLabel: 'Amazon',
      questions: [
        { question: 'Explain array reversal.', type: 'coding', source: 'verified' },
        { question: 'Tell me about yourself.', type: 'behavioral', source: 'verified' },
      ],
    });
    const webSpy = jest.spyOn(companyQuestionResearch, 'fetchCompanyQuestionsFromWeb');

    const result = await ensureCompanyQuestions({
      companyName: 'amazon',
      companyLabel: 'Amazon',
      role: 'Software Engineer',
      experienceLevel: 'fresher',
    });

    expect(result.mode).toBe('verified');
    expect(result.fromCache).toBe(true);
    expect(webSpy).not.toHaveBeenCalled();
  });

  it('dedupes parallel ensureCompanyQuestions invocations', async () => {
    jest.spyOn(companyQuestionBank, 'getCompanyQuestions').mockResolvedValue({
      mode: 'generic',
      companyLabel: 'Acme',
      questions: [],
    });

    let fetchCalls = 0;
    jest.spyOn(companyQuestionResearch, 'fetchCompanyQuestionsFromWeb').mockImplementation(async () => {
      fetchCalls += 1;
      await new Promise((resolve) => {
        setTimeout(resolve, 25);
      });
      return [];
    });

    const input = {
      companyName: 'dedupe-acme-xyz',
      companyLabel: 'Acme',
      role: 'Software Engineer',
      experienceLevel: 'fresher' as const,
      forceRefresh: true,
    };

    await Promise.all([ensureCompanyQuestions(input), ensureCompanyQuestions(input)]);
    expect(fetchCalls).toBe(1);
  });
});

describe('interview report idempotency', () => {
  beforeAll(async () => {
    await connectDatabase();
  });

  beforeEach(async () => {
    await User.deleteMany({ email: /@unintended-openai\.test$/ });
    await Interview.deleteMany({});
    await Report.deleteMany({});
  });

  afterAll(async () => {
    await User.deleteMany({ email: /@unintended-openai\.test$/ });
    await disconnectDatabase();
  });

  it('createInterviewReport generates at most one AI report for duplicate concurrent calls', async () => {
    const user = await User.create({
      name: 'AI Guard Student',
      email: 'ai-guard@unintended-openai.test',
      username: 'ai_guard_student',
      password: 'Password123!',
      role: 'student',
      isEmailVerified: true,
    });

    const interview = await Interview.create({
      userId: user._id,
      roleDomain: 'Software Engineer',
      roleLevel: 'Fresher',
      interviewStyle: 'technical',
      duration: 30,
      status: 'In Progress',
      questions: [
        {
          question: 'Explain binary search.',
          userAnswer: 'Binary search halves the search space each step.',
          score: 75,
          feedback: 'Good',
        },
      ],
      transcript: [],
      totalPlannedQuestions: 18,
    });

    const generateSpy = jest.spyOn(aiService, 'generateReport').mockResolvedValue({
      overallScore: 75,
      communicationScore: 70,
      technicalScore: 80,
      behavioralScore: 72,
      strengths: ['Clear explanation'],
      improvements: ['Add complexity analysis'],
      recommendations: ['Practice complexity analysis'],
      transcriptSummary: 'Solid first answer.',
      questionAnalysis: [],
    } as Awaited<ReturnType<typeof aiService.generateReport>>);

    const [first, second] = await Promise.all([
      __testCreateInterviewReport(interview, String(user._id)),
      __testCreateInterviewReport(interview, String(user._id)),
    ]);

    expect(first._id.toString()).toBe(second._id.toString());
    expect(generateSpy).toHaveBeenCalledTimes(1);

    const reports = await Report.find({ interviewId: interview._id });
    expect(reports).toHaveLength(1);

    await Report.deleteMany({ interviewId: interview._id });
    await Interview.deleteMany({ _id: interview._id });
    await User.deleteMany({ _id: user._id });
  });
});
