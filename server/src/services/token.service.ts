import { sign, verify, JwtPayload, SignOptions } from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../config/env';
import { getRedis } from '../config/redis';
import { AuthSession } from '../models/AuthSession';
import { IUser } from '../models/User';
import { hashToken } from '../utils/crypto';
import { AppError } from '../utils/AppError';
import { durationToSeconds } from '../utils/duration';

const refreshTtlSeconds = durationToSeconds(env.JWT_REFRESH_EXPIRES_IN, 7 * 24 * 60 * 60);

type TokenPair = {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
};

const signAccessToken = (user: IUser, sessionId: string) =>
  sign(
    { role: user.role, emailVerified: user.isEmailVerified },
    env.JWT_ACCESS_SECRET,
    {
      subject: String(user._id),
      jwtid: sessionId,
      expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    } as SignOptions,
  );

const signRefreshToken = (user: IUser, sessionId: string) =>
  sign({}, env.JWT_REFRESH_SECRET, {
    subject: String(user._id),
    jwtid: sessionId,
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
  } as SignOptions);

export const createSessionTokens = async (
  user: IUser,
  context: { userAgent?: string; ip?: string },
): Promise<TokenPair> => {
  const sessionId = uuidv4();
  const accessToken = signAccessToken(user, sessionId);
  const refreshToken = signRefreshToken(user, sessionId);
  const expiresAt = new Date(Date.now() + refreshTtlSeconds * 1000);

  await AuthSession.create({
    userId: user._id,
    sessionId,
    refreshTokenHash: hashToken(refreshToken),
    userAgent: context.userAgent,
    ip: context.ip,
    expiresAt,
  });

  await getRedis().hset(`session:${sessionId}`, {
    userId: String(user._id),
    role: user.role,
    email: user.email,
  });
  await getRedis().expire(`session:${sessionId}`, refreshTtlSeconds);

  return { accessToken, refreshToken, sessionId };
};

export const rotateRefreshToken = async (
  refreshToken: string,
  context: { userAgent?: string; ip?: string },
): Promise<TokenPair> => {
  const decoded = verify(refreshToken, env.JWT_REFRESH_SECRET) as JwtPayload;
  const sessionId = decoded.jti;
  const userId = decoded.sub;

  if (!sessionId || !userId) {
    throw new AppError('Invalid refresh token', 401, 'INVALID_REFRESH_TOKEN');
  }

  const oldHash = hashToken(refreshToken);
  const isBlacklisted = await getRedis().get(`refresh:blacklist:${oldHash}`);
  if (isBlacklisted) {
    throw new AppError('Refresh token was already used', 401, 'REFRESH_REUSE_DETECTED');
  }

  const session = await AuthSession.findOne({ sessionId, userId, revokedAt: { $exists: false } }).populate('userId');
  if (!session || session.refreshTokenHash !== oldHash) {
    throw new AppError('Refresh session expired', 401, 'SESSION_EXPIRED');
  }

  const user = session.userId as unknown as IUser;
  if (!user || (user as IUser & { isActive?: boolean }).isActive === false) {
    await AuthSession.updateOne({ sessionId }, { revokedAt: new Date() });
    throw new AppError(
      'This account has been deactivated. Contact an administrator.',
      403,
      'ACCOUNT_DEACTIVATED',
    );
  }

  const accessToken = signAccessToken(user, sessionId);
  const newRefreshToken = signRefreshToken(user, sessionId);

  await getRedis().set(`refresh:blacklist:${oldHash}`, '1', 'EX', refreshTtlSeconds);
  session.refreshTokenHash = hashToken(newRefreshToken);
  session.userAgent = context.userAgent;
  session.ip = context.ip;
  await session.save();

  await getRedis().hset(`session:${sessionId}`, {
    userId: String(user._id),
    role: user.role,
    email: user.email,
  });
  await getRedis().expire(`session:${sessionId}`, refreshTtlSeconds);

  return { accessToken, refreshToken: newRefreshToken, sessionId };
};

export const revokeSession = async (sessionId: string, refreshToken?: string) => {
  await AuthSession.updateOne({ sessionId }, { revokedAt: new Date() });
  await getRedis().del(`session:${sessionId}`);

  if (refreshToken) {
    await getRedis().set(`refresh:blacklist:${hashToken(refreshToken)}`, '1', 'EX', refreshTtlSeconds);
  }
};

/** Revoke every active session for a user (e.g. after admin deactivation). */
export const revokeAllSessionsForUser = async (userId: string) => {
  const sessions = await AuthSession.find({
    userId,
    revokedAt: { $exists: false },
  }).select('sessionId');

  if (!sessions.length) return;

  await AuthSession.updateMany(
    { userId, revokedAt: { $exists: false } },
    { revokedAt: new Date() },
  );

  await Promise.all(sessions.map((s) => getRedis().del(`session:${s.sessionId}`)));
};
