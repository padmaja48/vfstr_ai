import { User } from '../../models/User';
import { createSessionTokens } from '../../services/token.service';
import { getRedis } from '../../config/redis';

export const TEST_PASSWORD = 'Password123!';

export const seedStudentUser = async (email: string, overrides: Record<string, unknown> = {}) => {
  const username = email.replace(/[@.]/g, '_').slice(0, 40);

  await User.deleteOne({ email });
  await User.deleteOne({ username });
  const user = await User.create({
    name: 'Test Student',
    email,
    username,
    password: TEST_PASSWORD,
    role: 'student',
    isEmailVerified: true,
    accountSetupComplete: true,
    ...overrides,
  });

  const tokens = await createSessionTokens(user, {});
  await getRedis().hset(`session:${tokens.sessionId}`, {
    userId: String(user._id),
    role: String(user.role),
    email: user.email,
  });

  return { user, accessToken: tokens.accessToken };
};
