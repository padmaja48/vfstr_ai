import * as telemetry from '../services/aiUsageTelemetry.service';
import { buildAdaptiveTurnUserPrompt } from '../services/promptBuilder';
import { buildCompactInterviewState } from '../services/compactInterviewState';
import {
  estimateAiRequestCostUsd,
  getConfiguredTextModel,
  getConfiguredTranscriptionModel,
} from '../services/aiUsageTelemetry.service';

const mockResponsesCreate = jest.fn();
const mockTranscriptionsCreate = jest.fn();

jest.mock('../config/env', () => ({
  env: {
    NODE_ENV: 'test',
    AI_PROVIDER: 'openai',
    OPENAI_API_KEY: 'test-openai-key',
    OPENAI_BASE_URL: 'https://api.openai.com/v1',
    OPENAI_MODEL: 'gpt-4o-mini',
    WHISPER_MODEL: 'gpt-4o-mini-transcribe',
    GROQ_API_KEY: 'test-groq-key',
    GROQ_BASE_URL: 'https://api.groq.com/openai/v1',
    GROQ_MODEL: 'openai/gpt-oss-120b',
    GROQ_WHISPER_MODEL: 'whisper-large-v3-turbo',
    COOKIE_SECRET: 'test-cookie-secret-for-tests',
  },
}));

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    responses: { create: mockResponsesCreate },
    audio: { transcriptions: { create: mockTranscriptionsCreate } },
  })),
  toFile: jest.fn().mockResolvedValue({}),
}));

jest.mock('../services/aiContextCache.service', () => ({
  buildCompanyQuestionBankCacheKey: jest.fn(() => 'company:test'),
  buildJobDescriptionCacheKey: jest.fn(() => 'jd:test'),
  buildResumeAnalysisCacheKey: jest.fn(() => 'resume:test'),
  getAiContextCache: jest.fn().mockResolvedValue(null),
  normalizeContentHash: jest.fn((value: string) => `hash-${value.length}`),
  setAiContextCache: jest.fn().mockResolvedValue(undefined),
  invalidateAiContextCacheByHash: jest.fn(),
}));

describe('AI model routing and telemetry', () => {
  beforeEach(() => {
    process.env.AI_CALLS_ENABLED = 'true';
    jest.clearAllMocks();
    mockResponsesCreate.mockResolvedValue({
      output_text: JSON.stringify({
        score: 72,
        feedback: 'Solid answer.',
        idealAnswer: 'A stronger answer explains trade-offs.',
        samplePerfectAnswer: 'I would start with requirements, then design APIs.',
        conceptsCovered: ['REST'],
        missingConcepts: [],
        incorrectStatements: [],
        wrongTerminology: [],
        technicalMistakes: [],
        dynamicFeedback: {
          strengths: ['Clear structure'],
          missingConcepts: [],
          technicalMistakes: [],
          communication: 'Clear',
          confidence: 'Steady',
          areasToImprove: [],
          nextLearningSuggestions: [],
          practicalUnderstanding: 'Good',
          interviewReadiness: 'On track',
        },
        communicationScore: 70,
        technicalScore: 75,
        behavioralScore: 70,
        confidenceScore: 68,
        completenessScore: 72,
        depthScore: 70,
        terminologyScore: 74,
        grammarScore: 80,
        vocabularyScore: 78,
        domainScore: 76,
        nextAction: 'move_topic',
        suggestedDifficulty: 'medium',
        detectedSignals: ['REST'],
        missingSignals: [],
      }),
      usage: { input_tokens: 120, output_tokens: 80, input_tokens_details: { cached_tokens: 40 } },
    });
    mockTranscriptionsCreate.mockResolvedValue({ text: 'browser fallback transcript' });
  });

  it('configures gpt-4o-mini for text and gpt-4o-mini-transcribe for fallback audio', () => {
    expect(getConfiguredTextModel()).toBe('gpt-4o-mini');
    expect(getConfiguredTranscriptionModel()).toBe('gpt-4o-mini-transcribe');
  });

  it('routes text generation through gpt-4o-mini', async () => {
    const recordSpy = jest.spyOn(telemetry, 'recordAiUsage');
    const { evaluateAnswer } = await import('../services/ai.service');

    await evaluateAnswer('Explain REST APIs.', 'REST uses resources and HTTP verbs.', {
      interviewId: 'iv-test-1',
    });

    expect(mockResponsesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o-mini' }),
    );
    expect(mockTranscriptionsCreate).not.toHaveBeenCalled();
    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        requestType: 'answer_evaluation',
        model: 'gpt-4o-mini',
        interviewId: 'iv-test-1',
      }),
    );
  });

  it('uses gpt-4o-mini-transcribe only on fallback transcription', async () => {
    const recordSpy = jest.spyOn(telemetry, 'recordAiUsage');
    const { transcribeAudio } = await import('../services/ai.service');

    await transcribeAudio(
      {
        buffer: Buffer.alloc(8_192, 1),
        originalname: 'answer.webm',
        mimetype: 'audio/webm',
      } as Express.Multer.File,
      { interviewId: 'iv-test-2', currentQuestion: 'Tell me about yourself.' },
    );

    expect(mockTranscriptionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o-mini-transcribe' }),
    );
    expect(mockResponsesCreate).not.toHaveBeenCalled();
    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        requestType: 'fallback_transcription',
        model: 'gpt-4o-mini-transcribe',
        interviewId: 'iv-test-2',
      }),
    );
  });

  it('builds adaptive prompts from compact state instead of full history', () => {
    const history = Array.from({ length: 8 }, (_, index) => ({
      question: `Q${index + 1}`,
      answer: `A${index + 1}`,
      score: 60,
      topic: `topic-${index}`,
    }));
    const compactState = buildCompactInterviewState({
      interviewId: 'iv-compact',
      questionIndex: 7,
      targetQuestionCount: 18,
      conversationHistory: history,
    });
    const prompt = buildAdaptiveTurnUserPrompt({
      compactState,
      candidateMessage: 'Latest answer',
      previousQuestionTopics: ['topic-1'],
      questionsRemaining: 10,
    });

    expect(prompt).toContain('COMPACT INTERVIEW STATE');
    expect(prompt).not.toContain('FULL CONVERSATION SO FAR');
    expect(prompt).not.toContain('Q1');
    expect(prompt).toContain('Latest answer');
  });

  it('estimates text and audio usage costs for telemetry', () => {
    const textCost = estimateAiRequestCostUsd({
      model: 'gpt-4o-mini',
      inputTokens: 1_000,
      outputTokens: 500,
      cachedInputTokens: 200,
    });
    const audioCost = estimateAiRequestCostUsd({
      model: 'gpt-4o-mini-transcribe',
      audioDurationMinutes: 2,
    });

    expect(textCost).toBeGreaterThan(0);
    expect(audioCost).toBeGreaterThan(0);
  });

  it('projects monthly interview cost under $50 at 800 interviews/month', () => {
    // After compact state + context caching (see ai.service.ts / compactInterviewState.ts):
    // ~38 text calls/interview, ~2.8k input + ~0.9k output tokens/call avg (with ~35% cached input)
    const textCallsPerInterview = 38;
    const avgInputTokens = 2_800;
    const avgOutputTokens = 900;
    const cachedInputRatio = 0.35;
    const interviewsPerMonth = 800;

    const perCall = estimateAiRequestCostUsd({
      model: 'gpt-4o-mini',
      inputTokens: avgInputTokens,
      outputTokens: avgOutputTokens,
      cachedInputTokens: Math.round(avgInputTokens * cachedInputRatio),
    });
    const textMonthly = perCall * textCallsPerInterview * interviewsPerMonth;

    // Fallback STT: ~5% of answers × ~45s each when browser STT fails
    const fallbackAnswersPerInterview = 18 * 0.05;
    const fallbackMinutesPerAnswer = 0.75;
    const audioMonthly = estimateAiRequestCostUsd({
      model: 'gpt-4o-mini-transcribe',
      audioDurationMinutes: fallbackAnswersPerInterview * fallbackMinutesPerAnswer,
    }) * interviewsPerMonth;

    expect(textMonthly + audioMonthly).toBeLessThan(50);
  });

  it('returns cached resume analysis without calling OpenAI', async () => {
    const cache = await import('../services/aiContextCache.service');
    (cache.getAiContextCache as jest.Mock).mockResolvedValueOnce({
      summary: 'Cached resume summary',
      skills: ['TypeScript'],
      experienceLevel: 'Junior',
      yearsOfExperience: 2,
      score: 80,
      strengths: ['TypeScript'],
      gaps: [],
      suggestedQuestions: ['Tell me about TypeScript projects.'],
    });

    const { analyzeResume } = await import('../services/ai.service');
    const result = await analyzeResume('TypeScript developer resume', { userId: 'user-cache-1' });

    expect(result.summary).toBe('Cached resume summary');
    expect(mockResponsesCreate).not.toHaveBeenCalled();
  });
});
