import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { User } from '../models/User';
import { ACCESS_COOKIE_NAME } from '../utils/sessionCookies';

jest.mock('../config/redis', () => {
  const store = new Map<string, Record<string, string>>();
  return {
    getRedis: () => ({
      hgetall: async (key: string) => store.get(key) || {},
      hset: async (key: string, data: Record<string, string>) => {
        store.set(key, { ...(store.get(key) || {}), ...data });
      },
      expire: async () => undefined,
      get: async () => null,
      set: async () => undefined,
      del: async (key: string) => {
        store.delete(key);
      },
    }),
  };
});

const PASSWORD = 'Password123!';

/** Merge Set-Cookie headers into a single Cookie request header for supertest. */
const cookieHeaderFromSetCookie = (setCookie: string | string[] | undefined): string => {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return list.map((c) => String(c).split(';')[0]).join('; ');
};

const seedUser = async (email: string) => {
  await User.deleteOne({ email });
  await User.create({
    name: 'Cookie User',
    email,
    username: email.split('@')[0],
    password: PASSWORD,
    role: 'student',
    isEmailVerified: true,
  });
};

describe('cookie session + CSRF', () => {
  const app = createApp();

  beforeAll(async () => {
    await connectDatabase();
  });

  afterAll(async () => {
    await User.deleteMany({ email: /@cookie-test\.local$/ });
    await disconnectDatabase();
  });

  it('login sets httpOnly cookies and omits tokens from JSON body', async () => {
    await seedUser('login@cookie-test.local');
    const agent = request.agent(app);
    const loginRes = await agent
      .post('/api/auth/login')
      .send({ email: 'login@cookie-test.local', password: PASSWORD });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.accessToken).toBeUndefined();
    expect(loginRes.body.refreshToken).toBeUndefined();
    expect(loginRes.body.user?.email).toBe('login@cookie-test.local');
    expect(loginRes.body.csrfToken).toBeTruthy();
    const rawCookies = loginRes.headers['set-cookie'];
    const setCookieList = Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : [];
    const setCookieHeader = setCookieList.join('\n');
    expect(setCookieHeader).toMatch(/fluentai_csrf=/);
    const accessCookie = setCookieList.find((c) => String(c).startsWith(`${ACCESS_COOKIE_NAME}=`));
    expect(accessCookie).toBeTruthy();
    expect(String(accessCookie).toLowerCase()).toMatch(/httponly/);
  });

  it('GET /auth/session returns authenticated user with cookie jar', async () => {
    await seedUser('session@cookie-test.local');
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'session@cookie-test.local', password: PASSWORD });

    const res = await agent.get('/api/auth/session');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
    expect(res.body.user.email).toBe('session@cookie-test.local');
  });

  it('blocks mutating request without CSRF when using cookies only', async () => {
    await seedUser('csrf-block@cookie-test.local');
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'csrf-block@cookie-test.local', password: PASSWORD });

    const res = await agent
      .post('/api/users/change-password')
      .send({ currentPassword: PASSWORD, newPassword: 'Password1234!' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_INVALID');
  });

  it('allows mutating request with matching CSRF header + cookie', async () => {
    await seedUser('csrf-ok@cookie-test.local');
    const agent = request.agent(app);
    const loginRes = await agent
      .post('/api/auth/login')
      .send({ email: 'csrf-ok@cookie-test.local', password: PASSWORD });

    const csrfToken = loginRes.body.csrfToken;
    const cookieHeader = cookieHeaderFromSetCookie(loginRes.headers['set-cookie']);

    const res = await request(app)
      .post('/api/users/change-password')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrfToken)
      .send({ currentPassword: PASSWORD, newPassword: 'Password1234!' });

    expect(res.status).toBe(200);
  });

  it('logout clears session (cookie jar)', async () => {
    await seedUser('logout@cookie-test.local');
    const agent = request.agent(app);
    const loginRes = await agent
      .post('/api/auth/login')
      .send({ email: 'logout@cookie-test.local', password: PASSWORD });

    const csrfToken = loginRes.body.csrfToken;
    const cookieHeader = cookieHeaderFromSetCookie(loginRes.headers['set-cookie']);

    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrfToken);

    expect(logoutRes.status).toBe(200);

    const clearedJar = logoutRes.headers['set-cookie'];
    expect(String(clearedJar || '')).toMatch(/fluentai_access=/);

    const after = await request(app).get('/api/auth/session');

    expect(after.body.authenticated).toBe(false);
  });
});
