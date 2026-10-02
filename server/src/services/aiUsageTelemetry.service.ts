import crypto from 'crypto';

import { env } from '../config/env';
import { logger } from '../utils/logger';

export type AiRequestType =
  | 'interview_questions_initial'
  | 'answer_evaluation'
  | 'adaptive_question'
  | 'interview_report'
  | 'resume_analysis'
  | 'job_description_analysis'
  | 'question_bank_preview'
  | 'concept_generation'
  | 'company_question_refine'
  | 'writing_evaluation'
  | 'fallback_transcription';

export type AiUsageTelemetryInput = {
  interviewId?: string;
  userIdHash?: string;
  requestType: AiRequestType;
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  audioDurationMinutes?: number;
  success: boolean;
  errorCode?: string;
};

/** Rough USD estimates — for telemetry only, not billing guarantees. */
const TEXT_COST_PER_MILLION: Record<string, { input: number; output: number; cachedInput?: number }> = {
  'gpt-4o-mini': { input: 0.15, output: 0.6, cachedInput: 0.075 },
  'gpt-4o': { input: 2.5, output: 10, cachedInput: 1.25 },
  'whisper-1': { input: 0, output: 0 },
  'gpt-transcribe': { input: 0, output: 0 },
};

const TRANSCRIBE_COST_PER_MINUTE: Record<string, number> = {
  'whisper-1': 0.006,
  'gpt-4o-mini-transcribe': 0.003,
  'gpt-4o-transcribe': 0.006,
  'gpt-transcribe': 0.006,
  'whisper-large-v3-turbo': 0.003,
};

export const hashUserIdForTelemetry = (userId?: string) => {
  if (!userId) return undefined;
  return crypto.createHash('sha256').update(`${userId}:${env.COOKIE_SECRET}`).digest('hex').slice(0, 16);
};

export const estimateAiRequestCostUsd = (input: {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  audioDurationMinutes?: number;
}) => {
  const model = input.model.toLowerCase();
  if (input.audioDurationMinutes && input.audioDurationMinutes > 0) {
    const perMinute = TRANSCRIBE_COST_PER_MINUTE[model] ?? 0.006;
    return Number((input.audioDurationMinutes * perMinute).toFixed(6));
  }

  const rates = TEXT_COST_PER_MILLION[model] ?? TEXT_COST_PER_MILLION['gpt-4o-mini'];
  const inputCost = ((input.inputTokens ?? 0) / 1_000_000) * rates.input;
  const cachedCost = ((input.cachedInputTokens ?? 0) / 1_000_000) * (rates.cachedInput ?? rates.input * 0.5);
  const outputCost = ((input.outputTokens ?? 0) / 1_000_000) * rates.output;
  return Number((inputCost + cachedCost + outputCost).toFixed(6));
};

export const recordAiUsage = (input: AiUsageTelemetryInput) => {
  const estimatedCostUsd = estimateAiRequestCostUsd({
    model: input.model,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    cachedInputTokens: input.cachedInputTokens,
    audioDurationMinutes: input.audioDurationMinutes,
  });

  logger.info(
    {
      aiUsage: {
        interviewId: input.interviewId,
        userIdHash: input.userIdHash,
        requestType: input.requestType,
        provider: input.provider,
        model: input.model,
        inputTokens: input.inputTokens ?? 0,
        outputTokens: input.outputTokens ?? 0,
        cachedInputTokens: input.cachedInputTokens ?? 0,
        audioDurationMinutes: input.audioDurationMinutes ?? 0,
        estimatedCostUsd,
        success: input.success,
        errorCode: input.errorCode,
        timestamp: new Date().toISOString(),
      },
    },
    'OpenAI usage telemetry',
  );

  return { estimatedCostUsd };
};

export const getConfiguredTextModel = () =>
  env.AI_PROVIDER === 'openai' ? env.OPENAI_MODEL : env.GROQ_MODEL;

export const getConfiguredTranscriptionModel = () =>
  env.AI_PROVIDER === 'openai' ? env.WHISPER_MODEL : env.GROQ_WHISPER_MODEL;
