import rateLimit, { Options, RateLimitRequestHandler } from 'express-rate-limit';
import { Request } from 'express';
import { env } from '../config/env';

const userOrIpKey = (req: Request) => {
  const userId = (req as Request & { userId?: string }).userId;
  return userId ? `user:${userId}` : req.ip || 'anonymous';
};

const authAttemptKey = (req: Request) => {
  const identifier = String(req.body?.email || req.body?.username || '')
    .trim()
    .toLowerCase()
    .slice(0, 120);
  const ip = req.ip || 'anonymous';
  return identifier ? `auth:${ip}:${identifier}` : `auth:${ip}`;
};

const retryableHandler: Options['handler'] = (_req, res, _next, options) => {
  const retryAfter = Math.ceil(options.windowMs / 1000);
  res.setHeader('Retry-After', String(retryAfter));
  res.status(options.statusCode).json({
    error: options.message,
    message: options.message,
    code: 'RATE_LIMITED',
    retryable: true,
  });
};

const skipInTest = () => env.NODE_ENV === 'test' && process.env.FORCE_RATE_LIMIT !== '1';

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
});

/** Login/register/OAuth — keyed by IP + identifier to slow password spraying. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: authAttemptKey,
  message: 'Too many auth attempts. Please wait and try again.',
  skip: skipInTest,
});

/** Token refresh — separate, slightly higher budget than login. */
export const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: 'Too many refresh attempts. Please wait and try again.',
  skip: skipInTest,
});

/** Expensive LLM paths (answer eval, interview start, report, resume analysis). */
export const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.AI_RATE_LIMIT_PER_HOUR || 60),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: 'AI usage limit reached for this hour. Please wait and try again.',
  statusCode: 429,
  handler: retryableHandler,
  skip: skipInTest,
});

/** Admin bulk import / create storms. */
export const bulkImportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.BULK_IMPORT_RATE_LIMIT_PER_HOUR || 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: 'Too many bulk import requests. Please wait and try again.',
  statusCode: 429,
  handler: retryableHandler,
  skip: skipInTest,
});

type VoiceLimiterOptions = {
  windowMs?: number;
  limit?: number;
  message?: string;
  skip?: Options['skip'];
};

/** Factory so tests can use a tiny limit without mutating production defaults. */
export const createVoiceLimiter = ({
  windowMs = 60 * 1000,
  limit = 60,
  message = 'Too many voice requests. Please wait a moment and retry.',
  skip = skipInTest,
}: VoiceLimiterOptions = {}): RateLimitRequestHandler =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userOrIpKey,
    message,
    statusCode: 429,
    handler: retryableHandler,
    skip,
  });

/** Speak / TTS bursts (J02) — retryable 429, no crash. */
export const speakLimiter = createVoiceLimiter({
  windowMs: 60 * 1000,
  limit: Number(process.env.SPEAK_RATE_LIMIT_PER_MIN || 60),
  message: 'Too many speak requests. Please wait a moment and retry.',
});

/** Transcribe / STT bursts (J02) — slightly tighter than speak. */
export const transcribeLimiter = createVoiceLimiter({
  windowMs: 60 * 1000,
  limit: Number(process.env.TRANSCRIBE_RATE_LIMIT_PER_MIN || 40),
  message: 'Too many transcription requests. Please wait a moment and retry.',
});
