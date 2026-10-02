import { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/AppError';
import { env } from '../config/env';
import { logger } from '../utils/logger';

/** Strip API keys / bearer tokens from any client-visible error text (L05). */
const scrubSecrets = (value: string) =>
  String(value || '')
    .replace(/\b(sk|gsk|rk|pk)-[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [redacted]')
    .replace(/\b(api[_-]?key|secret|token)\s*[:=]\s*['"]?[^'"\s,;]+/gi, '$1=[redacted]')
    .replace(/mongodb(\+srv)?:\/\/[^\s'"]+/gi, 'mongodb://[redacted]');

export const notFoundHandler: RequestHandler = () => {
  throw new AppError('Route not found', 404, 'ROUTE_NOT_FOUND');
};

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: error.flatten(),
    });
  }

  if ((error as { code?: number }).code === 11000) {
    return res.status(409).json({
      error: 'Duplicate resource',
      message: 'Duplicate resource',
      code: 'DUPLICATE_RESOURCE',
    });
  }

  const errName = String((error as { name?: string })?.name || '');
  const errMsg = String(error?.message || '');
  const looksLikeDbDown =
    /MongoNetworkError|MongoServerSelectionError|MongooseServerSelectionError|buffering timed out|ECONNREFUSED/i.test(
      `${errName} ${errMsg}`,
    );

  if (looksLikeDbDown) {
    logger.error({ error: scrubSecrets(errMsg) }, 'Database unavailable');
    return res.status(503).json({
      error: 'Database unavailable. Please retry in a moment.',
      message: 'Database unavailable. Please retry in a moment.',
      code: 'DATABASE_UNAVAILABLE',
    });
  }

  const statusCode = error instanceof AppError ? error.statusCode : 500;
  const code = error instanceof AppError ? error.code : 'INTERNAL_SERVER_ERROR';
  const rawMessage = error.message || 'Internal server error';
  // Never echo stack traces or raw provider errors that may embed secrets (L05).
  const safeMessage =
    statusCode >= 500 && !(error instanceof AppError)
      ? 'Internal server error'
      : scrubSecrets(rawMessage);

  if (statusCode >= 500) {
    logger.error({ error: scrubSecrets(rawMessage), stack: scrubSecrets(String(error.stack || '')) }, 'Request failed');
  }

  res.status(statusCode).json({
    error: safeMessage,
    message: safeMessage,
    code,
  });
};
