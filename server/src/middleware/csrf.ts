import { RequestHandler } from 'express';
import { AppError } from '../utils/AppError';
import { CSRF_COOKIE_NAME } from '../utils/sessionCookies';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const CSRF_EXEMPT = [
  /^\/api(\/v1)?\/auth\/(login|register|refresh|google|forgot-password|reset-password|verify-email)(\/)?$/i,
  /^\/api(\/v1)?\/auth\/google\/callback(\/)?$/i,
  /^\/api(\/v1)?\/health(\/)?$/i,
];

/**
 * Double-submit CSRF protection for cookie-based sessions.
 *
 * Chosen over SameSite-only because production uses SameSite=None (SPA and API may be
 * on different origins / ports). SameSite=None allows cross-site cookie submission, so
 * we require a matching X-CSRF-Token header + fluentai_csrf cookie on mutating requests.
 *
 * Bearer Authorization skips CSRF for non-browser API clients and automated tests.
 */
export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const path = req.path || '';
  if (CSRF_EXEMPT.some((pattern) => pattern.test(path))) {
    return next();
  }

  if (req.headers.authorization?.startsWith('Bearer ')) {
    return next();
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = String(req.headers['x-csrf-token'] || '');

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return next(new AppError('Invalid or missing CSRF token', 403, 'CSRF_INVALID'));
  }

  next();
};
