import { verify, JwtPayload } from 'jsonwebtoken';
import { RequestHandler } from 'express';
import { env } from '../config/env';
import { getRedis } from '../config/redis';
import { AppError } from '../utils/AppError';
import { IUser, User, UserRole } from '../models/User';
import { isAnyAdminRole, normalizeRole } from '../utils/roles';
import { readAccessToken } from '../utils/sessionCookies';

const verifyAccessToken = async (token: string) => {
  const decoded = verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;

  if (!decoded.sub || !decoded.jti) {
    throw new AppError('Invalid access token', 401, 'INVALID_TOKEN');
  }

  const session = await getRedis().hgetall(`session:${decoded.jti}`);
  if (!session.userId) {
    throw new AppError('Session expired', 401, 'SESSION_EXPIRED');
  }

  const user = await User.findById(decoded.sub);
  if (!user) {
    throw new AppError('User not found', 401, 'USER_NOT_FOUND');
  }

  return { user: user as IUser, userId: decoded.sub, sessionId: decoded.jti };
};

export const authenticate: RequestHandler = async (req, _res, next) => {
  const token = readAccessToken(req);

  if (!token) {
    return next(new AppError('Authentication required', 401, 'AUTH_REQUIRED'));
  }

  try {
    const session = await verifyAccessToken(token);
    req.userId = session.userId;
    req.sessionId = session.sessionId;
    req.user = session.user;
    req.userRole = normalizeRole(session.user.role);
    next();
  } catch (error) {
    next(error instanceof AppError ? error : new AppError('Invalid token', 401, 'INVALID_TOKEN'));
  }
};

/** Sets req.user when a valid session cookie/header exists; never fails. */
export const optionalAuthenticate: RequestHandler = async (req, _res, next) => {
  const token = readAccessToken(req);
  if (!token) {
    return next();
  }

  try {
    const session = await verifyAccessToken(token);
    req.userId = session.userId;
    req.sessionId = session.sessionId;
    req.user = session.user;
    req.userRole = normalizeRole(session.user.role);
  } catch {
    // Treat invalid/expired tokens as logged-out for session bootstrap.
  }

  next();
};

/** Legacy authorize — accepts normalized + legacy role strings. */
export const authorize =
  (...roles: UserRole[]): RequestHandler =>
  (req, _res, next) => {
    const current = normalizeRole(req.userRole || req.user?.role);
    const allowed = roles.flatMap((r) => {
      const n = normalizeRole(r);
      if (n === 'superAdmin') return ['superAdmin'];
      if (n === 'admin') return ['admin', 'institutionAdmin', 'recruiter'];
      if (n === 'student') return ['student', 'candidate'];
      return [n];
    });

    if (!current || !allowed.includes(current)) {
      return next(new AppError('Forbidden', 403, 'FORBIDDEN'));
    }

    next();
  };

/** Any admin tier (superAdmin or institutionAdmin). */
export const authorizeAnyAdmin: RequestHandler = (req, _res, next) => {
  if (!req.user || !isAnyAdminRole(req.user.role)) {
    return next(new AppError('Forbidden', 403, 'FORBIDDEN'));
  }
  next();
};

/**
 * Blocks normal authenticated application APIs until first-login setup is complete.
 * Logout and the setup-completion endpoint intentionally remain available so the
 * user can sign out or finish setup. Profile is guarded; the client keeps a
 * non-sensitive session snapshot for setup-modal bootstrap on refresh.
 */
export const requireAccountSetupComplete: RequestHandler = (req, _res, next) => {
  if (req.user?.requiresAccountSetup) {
    return next(new AppError(
      'Complete account setup before using this feature.',
      403,
      'ACCOUNT_SETUP_REQUIRED',
    ));
  }

  next();
};

export const requireActiveAccount: RequestHandler = (req, _res, next) => {
  if (req.user && req.user.isActive === false) {
    return next(new AppError(
      'This account has been deactivated. Contact an administrator.',
      403,
      'ACCOUNT_DEACTIVATED',
    ));
  }

  next();
};
