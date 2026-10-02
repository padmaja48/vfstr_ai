import { CookieOptions, Response } from 'express';
import { env } from '../config/env';
import { durationToSeconds } from '../utils/duration';
import { createOtp } from '../utils/crypto';

export const ACCESS_COOKIE_NAME = process.env.ACCESS_COOKIE_NAME || 'fluentai_access';
export const CSRF_COOKIE_NAME = process.env.CSRF_COOKIE_NAME || 'fluentai_csrf';

const accessMaxAgeMs =
  durationToSeconds(env.JWT_ACCESS_EXPIRES_IN, 15 * 60) * 1000;
const refreshMaxAgeMs =
  durationToSeconds(env.JWT_REFRESH_EXPIRES_IN, 7 * 24 * 60 * 60) * 1000;

const isProd = env.NODE_ENV === 'production';

/** Shared cookie flags — SameSite=None+Secure in prod for cross-origin SPA (5173→4000 or split hosts). */
const baseCookieOptions = (): CookieOptions => ({
  secure: isProd,
  sameSite: isProd ? 'none' : 'lax',
  path: '/',
});

export const accessCookieOptions = (): CookieOptions => ({
  ...baseCookieOptions(),
  httpOnly: true,
  signed: true,
  maxAge: accessMaxAgeMs,
});

export const refreshCookieOptions = (): CookieOptions => ({
  ...baseCookieOptions(),
  httpOnly: true,
  signed: true,
  maxAge: refreshMaxAgeMs,
});

/** Readable by JS for double-submit CSRF (not httpOnly). */
export const csrfCookieOptions = (): CookieOptions => ({
  ...baseCookieOptions(),
  httpOnly: false,
  signed: false,
  maxAge: 24 * 60 * 60 * 1000,
});

export const setAccessCookie = (res: Response, accessToken: string) => {
  res.cookie(ACCESS_COOKIE_NAME, accessToken, accessCookieOptions());
};

export const setRefreshCookie = (res: Response, refreshToken: string) => {
  res.cookie(env.REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
};

export const clearAccessCookie = (res: Response) => {
  const { maxAge: _ignored, ...opts } = accessCookieOptions();
  res.clearCookie(ACCESS_COOKIE_NAME, opts);
};

export const clearRefreshCookie = (res: Response) => {
  const { maxAge: _ignored, ...opts } = refreshCookieOptions();
  res.clearCookie(env.REFRESH_COOKIE_NAME, opts);
};

export const clearCsrfCookie = (res: Response) => {
  const { maxAge: _ignored, ...opts } = csrfCookieOptions();
  res.clearCookie(CSRF_COOKIE_NAME, opts);
};

export const issueCsrfToken = (res: Response): string => {
  const token = createOtp() + createOtp();
  res.cookie(CSRF_COOKIE_NAME, token, csrfCookieOptions());
  return token;
};

export const setSessionCookies = (
  res: Response,
  tokens: { accessToken: string; refreshToken: string },
) => {
  setAccessCookie(res, tokens.accessToken);
  setRefreshCookie(res, tokens.refreshToken);
  issueCsrfToken(res);
};

export const clearSessionCookies = (res: Response) => {
  clearAccessCookie(res);
  clearRefreshCookie(res);
  clearCsrfCookie(res);
};

export const readRefreshToken = (req: {
  body?: { refreshToken?: string };
  signedCookies?: Record<string, string>;
  cookies?: Record<string, string>;
}) =>
  req.body?.refreshToken
  ?? req.signedCookies?.[env.REFRESH_COOKIE_NAME]
  ?? req.cookies?.[env.REFRESH_COOKIE_NAME];

export const readAccessToken = (req: {
  headers?: { authorization?: string };
  signedCookies?: Record<string, string>;
  cookies?: Record<string, string>;
}) => {
  const header = req.headers?.authorization;
  if (header?.startsWith('Bearer ')) {
    return header.slice(7);
  }
  return req.signedCookies?.[ACCESS_COOKIE_NAME] ?? req.cookies?.[ACCESS_COOKIE_NAME];
};

/** JSON body for browser clients — tokens live in httpOnly cookies only. */
export const authResponseBody = (
  message: string,
  user: unknown,
  csrfToken?: string,
) => ({
  message,
  user,
  ...(csrfToken ? { csrfToken } : {}),
});
