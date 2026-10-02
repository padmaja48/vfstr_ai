import * as crypto from 'crypto';

export const createOtp = () => crypto.randomInt(100000, 999999).toString();

export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export const createPublicId = (prefix: string) =>
  `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
