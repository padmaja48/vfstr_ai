import { OAuth2Client } from 'google-auth-library';
import { verify, JwtPayload } from 'jsonwebtoken';
import { Request } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { getRedis } from '../config/redis';
import { IUser, User } from '../models/User';
import { normalizeRole, isCollegeAdminRole } from '../utils/roles';
import { getAssignedInstitutionIds, loadAssignedInstitutionSummaries } from '../middleware/adminScope';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { createOtp } from '../utils/crypto';
import { createSessionTokens, revokeSession, rotateRefreshToken } from '../services/token.service';
import { passwordResetEmail, queueEmail, verificationEmail } from '../services/email.service';
import {
  authResponseBody,
  clearSessionCookies,
  issueCsrfToken,
  readRefreshToken,
  setSessionCookies,
} from '../utils/sessionCookies';

const googleClient = env.GOOGLE_CLIENT_ID
  ? new OAuth2Client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_CALLBACK_URL)
  : null;

const getPublicAppUrl = (req: Request) => {
  if (env.CLIENT_URL && !env.CLIENT_URL.includes('localhost')) {
    return env.CLIENT_URL;
  }

  const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = req.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || req.get('host');
  if (host) {
    return `${forwardedProto || req.protocol}://${host}`;
  }

  return env.CLIENT_URL;
};

const getGoogleCallbackUrl = (req: Request) =>
  new URL('/api/auth/google/callback', getPublicAppUrl(req)).toString();

export const registerSchema = z.object({
  body: z.object({
    name: z.string().min(2),
    email: z.string().email().toLowerCase(),
    password: z.string().min(8),
    level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).optional(),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().trim().min(3).max(254).toLowerCase(),
    password: z.string().min(1),
  }),
});

export const verifyEmailSchema = z.object({
  body: z.object({
    email: z.string().email().toLowerCase(),
    otp: z.string().length(6),
  }),
});

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().email().toLowerCase(),
  }),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    email: z.string().email().toLowerCase(),
    otp: z.string().length(6),
    password: z.string().min(8),
  }),
});

export const refreshSchema = z.object({
  body: z.object({
    refreshToken: z.string().optional(),
  }),
});

export const googleSchema = z.object({
  body: z.object({
    credential: z.string().min(10),
  }),
});

const serializeUser = async (user: IUser) => {
  const role = normalizeRole(user.role);
  const assignedInstitutionIds = getAssignedInstitutionIds(user).map(String);
  const assignedInstitutions = isCollegeAdminRole(role)
    ? await loadAssignedInstitutionSummaries(user)
    : [];

  return {
    id: user._id,
    name: user.name,
    username: user.username,
    email: user.email,
    level: user.level,
    role,
    isEmailVerified: user.isEmailVerified,
    isActive: user.isActive !== false,
    deactivatedAt: user.deactivatedAt || null,
    totalSessions: user.totalSessions,
    averageScore: user.averageScore,
    streak: user.streak,
    authProvider: user.authProvider,
    phone: user.phone,
    institution: user.institution,
    institutionId: user.institutionId ? String(user.institutionId) : '',
    assignedInstitutionIds,
    assignedInstitutions,
    batch: user.batch || '',
    branch: user.branch || '',
    preferredLanguage: user.preferredLanguage,
    companySelectorRecentCompanies: user.companySelectorRecentCompanies || [],
    requiresAccountSetup: Boolean(user.requiresAccountSetup),
    skills: user.skills,
    profileImageUrl: user.profileImageUrl,
  };
};

const issueOtp = async (type: 'verify' | 'reset', email: string) => {
  const otp = createOtp();
  await getRedis().set(`otp:${type}:${email}`, otp, 'EX', 10 * 60);
  return otp;
};

export const register = asyncHandler(async (req, res) => {
  const { name, email, password, level } = req.body;
  const existing = await User.findOne({ email });

  if (existing) {
    throw new AppError('An account with this email already exists. Please sign in.', 409, 'USER_EXISTS');
  }

  const user = await User.create({ name, email, password, level });

  // OTP/email must not block account creation in local/dev.
  try {
    const otp = await issueOtp('verify', email);
    await queueEmail({ to: email, ...verificationEmail(name, otp) });
  } catch {
    // Account is already created; verification can be retried later.
  }

  const tokens = await createSessionTokens(user, {
    userAgent: req.headers['user-agent'],
    ip: req.ip,
  });
  const csrfToken = issueCsrfToken(res);
  setSessionCookies(res, tokens);

  res.status(201).json(authResponseBody(
    'Account created successfully. You can start practicing now.',
    await serializeUser(user),
    csrfToken,
  ));
});

const MAX_FAILED_LOGINS = 8;
const LOCKOUT_MS = 15 * 60 * 1000;

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const identifier = email.trim().toLowerCase();
  const user = await User.findOne(
    identifier.includes('@') ? { email: identifier } : { username: identifier },
  ).select('+password');

  if (!user) {
    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  if (user.isActive === false) {
    throw new AppError(
      'This account has been deactivated. Contact an administrator.',
      403,
      'ACCOUNT_DEACTIVATED',
    );
  }

  const lockUntil = user.authMetadata?.lockUntil;
  if (lockUntil && lockUntil.getTime() > Date.now()) {
    throw new AppError(
      'Too many failed login attempts. Try again later.',
      429,
      'ACCOUNT_LOCKED',
    );
  }

  if (!(await user.comparePassword(password))) {
    const attempts = (user.authMetadata?.failedLoginAttempts || 0) + 1;
    user.authMetadata = user.authMetadata || { failedLoginAttempts: 0 };
    user.authMetadata.failedLoginAttempts = attempts;
    if (attempts >= MAX_FAILED_LOGINS) {
      user.authMetadata.lockUntil = new Date(Date.now() + LOCKOUT_MS);
      user.authMetadata.failedLoginAttempts = 0;
    }
    await user.save();
    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  user.authMetadata = user.authMetadata || { failedLoginAttempts: 0 };
  user.authMetadata.lastLoginAt = new Date();
  user.authMetadata.failedLoginAttempts = 0;
  user.authMetadata.lockUntil = undefined;
  await user.save();

  const tokens = await createSessionTokens(user, {
    userAgent: req.headers['user-agent'],
    ip: req.ip,
  });
  const csrfToken = issueCsrfToken(res);
  setSessionCookies(res, tokens);

  res.json(authResponseBody('Login successful', await serializeUser(user), csrfToken));
});

export const googleLogin = asyncHandler(async (req, res) => {
  if (!googleClient || !env.GOOGLE_CLIENT_ID) {
    throw new AppError('Google OAuth is not configured', 503, 'GOOGLE_NOT_CONFIGURED');
  }

  const ticket = await googleClient.verifyIdToken({
    idToken: req.body.credential,
    audience: env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();

  if (!payload?.email) {
    throw new AppError('Google account email is required', 400, 'GOOGLE_EMAIL_REQUIRED');
  }

  const user = await User.findOneAndUpdate(
    { email: payload.email.toLowerCase() },
    {
      $setOnInsert: {
        name: payload.name ?? payload.email.split('@')[0],
        email: payload.email.toLowerCase(),
        authProvider: 'google',
        googleId: payload.sub,
      },
      $set: {
        isEmailVerified: payload.email_verified ?? true,
        profileImageUrl: payload.picture,
        'authMetadata.lastLoginAt': new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  if (user.isActive === false) {
    throw new AppError(
      'This account has been deactivated. Contact an administrator.',
      403,
      'ACCOUNT_DEACTIVATED',
    );
  }

  const tokens = await createSessionTokens(user, {
    userAgent: req.headers['user-agent'],
    ip: req.ip,
  });
  const csrfToken = issueCsrfToken(res);
  setSessionCookies(res, tokens);

  res.json(authResponseBody('Google login successful', await serializeUser(user), csrfToken));
});

export const googleRedirect = asyncHandler(async (req, res) => {
  if (!googleClient || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new AppError('Google OAuth is not configured', 503, 'GOOGLE_NOT_CONFIGURED');
  }

  const url = googleClient.generateAuthUrl({
    access_type: 'offline',
    scope: ['openid', 'email', 'profile'],
    prompt: 'consent',
    redirect_uri: getGoogleCallbackUrl(req),
  });

  res.redirect(url);
});

export const googleCallback = asyncHandler(async (req, res) => {
  if (!googleClient || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new AppError('Google OAuth is not configured', 503, 'GOOGLE_NOT_CONFIGURED');
  }

  const code = typeof req.query.code === 'string' ? req.query.code : undefined;
  if (!code) {
    throw new AppError('Google OAuth code is required', 400, 'GOOGLE_CODE_REQUIRED');
  }

  const { tokens: googleTokens } = await googleClient.getToken({
    code,
    redirect_uri: getGoogleCallbackUrl(req),
  });
  if (!googleTokens.id_token) {
    throw new AppError('Google ID token was not returned', 400, 'GOOGLE_ID_TOKEN_REQUIRED');
  }

  const ticket = await googleClient.verifyIdToken({
    idToken: googleTokens.id_token,
    audience: env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();

  if (!payload?.email) {
    throw new AppError('Google account email is required', 400, 'GOOGLE_EMAIL_REQUIRED');
  }

  const user = await User.findOneAndUpdate(
    { email: payload.email.toLowerCase() },
    {
      $setOnInsert: {
        name: payload.name ?? payload.email.split('@')[0],
        email: payload.email.toLowerCase(),
        authProvider: 'google',
        googleId: payload.sub,
      },
      $set: {
        isEmailVerified: payload.email_verified ?? true,
        profileImageUrl: payload.picture,
        'authMetadata.lastLoginAt': new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  if (user.isActive === false) {
    throw new AppError(
      'This account has been deactivated. Contact an administrator.',
      403,
      'ACCOUNT_DEACTIVATED',
    );
  }

  const appTokens = await createSessionTokens(user, {
    userAgent: req.headers['user-agent'],
    ip: req.ip,
  });
  setSessionCookies(res, appTokens);
  issueCsrfToken(res);

  const clientBase = env.CLIENT_URL.replace(/\/$/, '');
  const callbackUrl = new URL('/auth/callback', clientBase);
  callbackUrl.searchParams.set('oauth', 'success');
  res.redirect(callbackUrl.toString());
});

export const verifyEmail = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  const cachedOtp = await getRedis().get(`otp:verify:${email}`);

  if (cachedOtp !== otp) {
    throw new AppError('Invalid or expired verification code', 400, 'INVALID_OTP');
  }

  const user = await User.findOneAndUpdate({ email }, { isEmailVerified: true }, { new: true });
  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  await getRedis().del(`otp:verify:${email}`);
  res.json({ message: 'Email verified', user: await serializeUser(user) });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const user = await User.findOne({ email: req.body.email });

  if (user) {
    const otp = await issueOtp('reset', user.email);
    await queueEmail({ to: user.email, ...passwordResetEmail(user.name, otp) });
  }

  res.json({ message: 'If the account exists, a reset code was sent.' });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { email, otp, password } = req.body;
  const cachedOtp = await getRedis().get(`otp:reset:${email}`);

  if (cachedOtp !== otp) {
    throw new AppError('Invalid or expired reset code', 400, 'INVALID_OTP');
  }

  const user = await User.findOne({ email }).select('+password');
  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  user.password = password;
  await user.save();
  await getRedis().del(`otp:reset:${email}`);
  res.json({ message: 'Password reset successful' });
});

export const refresh = asyncHandler(async (req, res) => {
  const refreshToken = readRefreshToken(req);
  if (!refreshToken) {
    throw new AppError('Refresh token required', 400, 'REFRESH_REQUIRED');
  }

  const tokens = await rotateRefreshToken(refreshToken, {
    userAgent: req.headers['user-agent'],
    ip: req.ip,
  });
  const csrfToken = issueCsrfToken(res);
  setSessionCookies(res, tokens);

  res.json({
    message: 'Token refreshed',
    csrfToken,
  });
});

export const logout = asyncHandler(async (req, res) => {
  if (req.sessionId) {
    await revokeSession(req.sessionId, readRefreshToken(req));
  }

  clearSessionCookies(res);
  res.json({ message: 'Logged out' });
});

/** Bootstrap endpoint — confirms cookie session + returns CSRF token for the SPA. */
export const getSession = asyncHandler(async (req, res) => {
  if (req.userId && req.user) {
    const csrfToken = issueCsrfToken(res);
    res.json({
      authenticated: true,
      csrfToken,
      user: await serializeUser(req.user),
    });
    return;
  }

  const refreshToken = readRefreshToken(req);
  if (refreshToken) {
    try {
      const tokens = await rotateRefreshToken(refreshToken, {
        userAgent: req.headers['user-agent'],
        ip: req.ip,
      });
      setSessionCookies(res, tokens);
      const decoded = verify(tokens.accessToken, env.JWT_ACCESS_SECRET) as JwtPayload;
      const user = decoded.sub ? await User.findById(decoded.sub) : null;
      if (user && user.isActive !== false) {
        const csrfToken = issueCsrfToken(res);
        res.json({
          authenticated: true,
          csrfToken,
          user: await serializeUser(user),
        });
        return;
      }
    } catch {
      // Refresh cookie present but no longer valid — treat as logged out.
    }
  }

  const csrfToken = issueCsrfToken(res);
  res.json({ authenticated: false, csrfToken });
});

export const getProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  res.json(await serializeUser(user));
});

export const completeAccountSetupSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(8).max(20),
    institution: z.string().trim().min(2).max(160),
    email: z.string().trim().email().toLowerCase(),
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(128),
  }),
});

/** First-login setup for bulk-imported students (default password → personal details + new password). */
export const completeAccountSetup = asyncHandler(async (req, res) => {
  const user = await User.findById(req.userId).select('+password');
  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  if (user.isActive === false) {
    throw new AppError(
      'This account has been deactivated. Contact an administrator.',
      403,
      'ACCOUNT_DEACTIVATED',
    );
  }

  if (!user.requiresAccountSetup) {
    throw new AppError('Account setup is not required for this user.', 400, 'SETUP_NOT_REQUIRED');
  }

  const { name, phone, institution, email, currentPassword, newPassword } = req.body;

  if (!(await user.comparePassword(currentPassword))) {
    throw new AppError('Current password is incorrect.', 400, 'INVALID_CURRENT_PASSWORD');
  }

  if (currentPassword === newPassword) {
    throw new AppError('New password must be different from the default password.', 400, 'PASSWORD_UNCHANGED');
  }

  const emailTaken = await User.findOne({
    email,
    _id: { $ne: user._id },
  });
  if (emailTaken) {
    throw new AppError('That personal email is already registered to another account.', 409, 'USER_EXISTS');
  }

  user.name = name;
  user.phone = phone;
  user.institution = institution;
  user.email = email;
  user.password = newPassword;
  user.requiresAccountSetup = false;
  user.isEmailVerified = true;
  await user.save();

  res.json(authResponseBody('Account setup complete. Welcome!', await serializeUser(user)));
});
