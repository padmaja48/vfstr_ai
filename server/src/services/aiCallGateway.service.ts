import crypto from 'crypto';

import { env } from '../config/env';
import { logger } from '../utils/logger';
import type { AiRequestType } from './aiUsageTelemetry.service';
import { recordAiUsage } from './aiUsageTelemetry.service';

export class AiCallsDisabledError extends Error {
  code = 'AI_CALLS_DISABLED';

  constructor(operation: string) {
    super(`AI calls are disabled (AI_CALLS_ENABLED=false). Blocked operation: ${operation}`);
    this.name = 'AiCallsDisabledError';
  }
}

export type AiCallTraceContext = {
  requestId: string;
  operation: string;
  requestType: AiRequestType;
  sourceFile: string;
  provider: string;
  model: string;
  route?: string;
  interviewId?: string;
  userIdHash?: string;
  isBackground?: boolean;
  retryAttempt?: number;
};

export const isAiCallsEnabled = () => {
  const flag = process.env.AI_CALLS_ENABLED;
  if (flag === 'false' || flag === '0') return false;
  return true;
};

export const shouldLogAiCallTrace = () =>
  process.env.AI_CALL_DEBUG === '1'
  || process.env.AI_CALL_DEBUG === 'true'
  || (env.NODE_ENV === 'development' && process.env.AI_CALL_DEBUG !== 'false');

export const assertAiCallsEnabled = (operation: string) => {
  if (!isAiCallsEnabled()) {
    throw new AiCallsDisabledError(operation);
  }
};

export const createAiRequestId = () => crypto.randomUUID();

const tracePayload = (ctx: AiCallTraceContext, extra?: Record<string, unknown>) => ({
  aiCall: {
    requestId: ctx.requestId,
    operation: ctx.operation,
    requestType: ctx.requestType,
    sourceFile: ctx.sourceFile,
    provider: ctx.provider,
    model: ctx.model,
    route: ctx.route,
    interviewId: ctx.interviewId,
    userIdHash: ctx.userIdHash,
    isBackground: Boolean(ctx.isBackground),
    retryAttempt: ctx.retryAttempt ?? 0,
    timestamp: new Date().toISOString(),
    ...extra,
  },
});

export const logAiCallStart = (ctx: AiCallTraceContext) => {
  if (!shouldLogAiCallTrace()) return;
  logger.info(tracePayload(ctx), '[AI_CALL] start');
};

export const logAiCallSuccess = (
  ctx: AiCallTraceContext,
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    durationMs?: number;
  },
) => {
  if (!shouldLogAiCallTrace()) return;
  logger.info(tracePayload(ctx, {
    status: 'success',
    durationMs: usage?.durationMs,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    cachedInputTokens: usage?.cachedInputTokens ?? 0,
  }), '[AI_CALL] success');
};

export const logAiCallFailure = (
  ctx: AiCallTraceContext,
  errorCode: string,
  usage?: { durationMs?: number },
) => {
  if (!shouldLogAiCallTrace()) return;
  logger.warn(tracePayload(ctx, {
    status: 'failure',
    errorCode,
    durationMs: usage?.durationMs,
  }), '[AI_CALL] failure');
};

export type ChatCompletionGatewayResult = {
  ok: boolean;
  status: number;
  data: {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
    };
  };
};

export const executeOpenAiChatCompletion = async (input: {
  operation: string;
  requestType: AiRequestType;
  sourceFile: string;
  endpoint: string;
  apiKey: string;
  model: string;
  body: Record<string, unknown>;
  interviewId?: string;
  userIdHash?: string;
  isBackground?: boolean;
  route?: string;
  retryAttempt?: number;
}): Promise<ChatCompletionGatewayResult> => {
  assertAiCallsEnabled(input.operation);
  const requestId = createAiRequestId();
  const ctx: AiCallTraceContext = {
    requestId,
    operation: input.operation,
    requestType: input.requestType,
    sourceFile: input.sourceFile,
    provider: env.AI_PROVIDER,
    model: input.model,
    interviewId: input.interviewId,
    userIdHash: input.userIdHash,
    isBackground: input.isBackground,
    route: input.route,
    retryAttempt: input.retryAttempt,
  };
  logAiCallStart(ctx);
  const startedAt = Date.now();
  try {
    const response = await fetch(input.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input.body),
    });
    const durationMs = Date.now() - startedAt;
    const data = (await response.json().catch(() => ({}))) as ChatCompletionGatewayResult['data'];
    if (!response.ok) {
      recordAiUsage({
        interviewId: ctx.interviewId,
        userIdHash: ctx.userIdHash,
        requestType: ctx.requestType,
        provider: ctx.provider,
        model: ctx.model,
        success: false,
        errorCode: `HTTP_${response.status}`,
      });
      logAiCallFailure(ctx, `HTTP_${response.status}`, { durationMs });
      return { ok: false, status: response.status, data };
    }
    recordAiUsage({
      interviewId: ctx.interviewId,
      userIdHash: ctx.userIdHash,
      requestType: ctx.requestType,
      provider: ctx.provider,
      model: ctx.model,
      inputTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
      cachedInputTokens: data.usage?.prompt_tokens_details?.cached_tokens,
      success: true,
    });
    logAiCallSuccess(ctx, {
      durationMs,
      inputTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
      cachedInputTokens: data.usage?.prompt_tokens_details?.cached_tokens,
    });
    return { ok: true, status: response.status, data };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    recordAiUsage({
      interviewId: ctx.interviewId,
      userIdHash: ctx.userIdHash,
      requestType: ctx.requestType,
      provider: ctx.provider,
      model: ctx.model,
      success: false,
      errorCode: error instanceof Error ? error.name : 'FETCH_ERROR',
    });
    logAiCallFailure(ctx, error instanceof Error ? error.name : 'FETCH_ERROR', { durationMs });
    throw error;
  }
};
