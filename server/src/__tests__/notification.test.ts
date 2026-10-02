import request from 'supertest';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { createApp } from '../app';
import { Institution } from '../models/Institution';
import { Notification } from '../models/Notification';
import { NotificationRecipient } from '../models/NotificationRecipient';
import { User } from '../models/User';
import { createSessionTokens } from '../services/token.service';
import * as emailService from '../services/email.service';
import { deliverNotification } from '../services/notification.service';

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
    getQueueRedis: () => ({
      on: () => undefined,
      quit: async () => undefined,
    }),
    isMemoryRedis: () => true,
    closeRedis: async () => undefined,
  };
});

jest.mock('../services/email.service', () => ({
  ...jest.requireActual('../services/email.service'),
  deliverEmail: jest.fn(),
}));

const deliverEmailMock = emailService.deliverEmail as jest.MockedFunction<typeof emailService.deliverEmail>;

describe('notification system', () => {
  const app = createApp();
  let superAdminToken: string;
  let instAdminToken: string;
  let studentAToken: string;
  let studentBToken: string;
  let institutionAId: string;
  let institutionBId: string;
  let studentAId: string;
  let studentBId: string;

  beforeAll(async () => {
    await connectDatabase();

    await Promise.all([
      User.deleteMany({ email: /@notification-test\.local$/ }),
      Institution.deleteMany({ name: /^NTF Test / }),
      Notification.deleteMany({ title: /^NTF test / }),
    ]);

    const instA = await Institution.create({ name: 'NTF Test College A' });
    const instB = await Institution.create({ name: 'NTF Test College B' });
    institutionAId = String(instA._id);
    institutionBId = String(instB._id);

    const superAdmin = await User.create({
      name: 'NTF Super Admin',
      email: 'super@notification-test.local',
      username: 'super_ntf',
      password: 'Password123!',
      role: 'superAdmin',
      isEmailVerified: true,
    });

    const instAdmin = await User.create({
      name: 'NTF Inst Admin',
      email: 'instadmin@notification-test.local',
      username: 'instadmin_ntf',
      password: 'Password123!',
      role: 'institutionAdmin',
      institutionId: instA._id,
      institution: instA.name,
      isEmailVerified: true,
    });

    const studentA = await User.create({
      name: 'NTF Student A',
      email: 'studenta@notification-test.local',
      username: 'studenta_ntf',
      password: 'Password123!',
      role: 'student',
      institutionId: instA._id,
      institution: instA.name,
      averageScore: 80,
      isEmailVerified: true,
    });
    studentAId = String(studentA._id);

    const studentB = await User.create({
      name: 'NTF Student B',
      email: 'studentb@notification-test.local',
      username: 'studentb_ntf',
      password: 'Password123!',
      role: 'student',
      institutionId: instB._id,
      institution: instB.name,
      averageScore: 40,
      isEmailVerified: true,
    });
    studentBId = String(studentB._id);

    const superTokens = await createSessionTokens(superAdmin, {});
    const instTokens = await createSessionTokens(instAdmin, {});
    const studentATokens = await createSessionTokens(studentA, {});
    const studentBTokens = await createSessionTokens(studentB, {});

    superAdminToken = superTokens.accessToken;
    instAdminToken = instTokens.accessToken;
    studentAToken = studentATokens.accessToken;
    studentBToken = studentBTokens.accessToken;

    const { getRedis } = await import('../config/redis');
    await getRedis().hset(`session:${superTokens.sessionId}`, {
      userId: String(superAdmin._id),
      role: 'superAdmin',
      email: superAdmin.email,
    });
    await getRedis().hset(`session:${instTokens.sessionId}`, {
      userId: String(instAdmin._id),
      role: 'institutionAdmin',
      email: instAdmin.email,
    });
    await getRedis().hset(`session:${studentATokens.sessionId}`, {
      userId: studentAId,
      role: 'student',
      email: studentA.email,
    });
    await getRedis().hset(`session:${studentBTokens.sessionId}`, {
      userId: studentBId,
      role: 'student',
      email: studentB.email,
    });
  });

  afterAll(async () => {
    await Promise.all([
      User.deleteMany({ email: /@notification-test\.local$/ }),
      Institution.deleteMany({ name: /^NTF Test / }),
      Notification.deleteMany({ title: /^NTF test / }),
      NotificationRecipient.deleteMany({}),
    ]);
    await disconnectDatabase();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    deliverEmailMock.mockResolvedValue(undefined);
    await NotificationRecipient.deleteMany({});
    await Notification.deleteMany({ title: /^NTF test / });
    // Platform-wide notifications count every student in the shared test DB.
    // Other integration suites leave student fixtures behind — remove them here.
    await User.deleteMany({
      email: { $not: /@notification-test\.local$/ },
      role: { $in: ['student', 'candidate'] },
    });
  });

  it('institutionAdmin cannot access admin notification endpoints', async () => {
    const res = await request(app)
      .get('/api/admin/notifications')
      .set('Authorization', `Bearer ${instAdminToken}`);

    expect(res.status).toBe(403);
  });

  it('delivers in-app notification only to institution audience', async () => {
    const createRes = await request(app)
      .post('/api/admin/notifications')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        title: 'NTF test institution notice',
        body: 'Hello institution A only',
        audienceType: 'institution',
        audienceValue: institutionAId,
        channels: ['in_app'],
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.notification.status).toBe('sent');
    expect(createRes.body.notification.deliveryStats.recipients).toBe(2);

    const studentARes = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${studentAToken}`);
    expect(studentARes.status).toBe(200);
    expect(studentARes.body.unreadCount).toBe(1);
    expect(studentARes.body.notifications[0].title).toBe('NTF test institution notice');

    const studentBRes = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${studentBToken}`);
    expect(studentBRes.body.unreadCount).toBe(0);
    expect(studentBRes.body.notifications).toEqual([]);
  });

  it('delivers platform-wide in-app notifications to all students', async () => {
    const createRes = await request(app)
      .post('/api/admin/notifications')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        title: 'NTF test platform notice',
        body: 'Hello everyone',
        audienceType: 'all',
        channels: ['in_app'],
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.notification.deliveryStats.recipients).toBe(2);

    const studentARes = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${studentAToken}`);
    const studentBRes = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${studentBToken}`);

    expect(studentARes.body.unreadCount).toBe(1);
    expect(studentBRes.body.unreadCount).toBe(1);
  });

  it('records partial email failures in deliveryStats and status', async () => {
    deliverEmailMock.mockImplementation(async ({ to }) => {
      if (to === 'studenta@notification-test.local') {
        throw new Error('Mailbox unavailable');
      }
    });

    const createRes = await request(app)
      .post('/api/admin/notifications')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        title: 'NTF test email partial',
        body: 'Email blast',
        audienceType: 'all',
        channels: ['email'],
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.notification.status).toBe('partially_sent');
    expect(createRes.body.notification.deliveryStats.emailDelivered).toBe(1);
    expect(createRes.body.notification.deliveryStats.emailFailed).toBe(1);
    expect(createRes.body.notification.deliveryStats.failed).toBe(1);
    expect(createRes.body.notification.deliveryStats.succeeded).toBe(1);
  });

  it('student can mark one notification read and mark all read', async () => {
    await request(app)
      .post('/api/admin/notifications')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        title: 'NTF test read flow 1',
        body: 'First',
        audienceType: 'institution',
        audienceValue: institutionAId,
        channels: ['in_app'],
      });

    await request(app)
      .post('/api/admin/notifications')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        title: 'NTF test read flow 2',
        body: 'Second',
        audienceType: 'institution',
        audienceValue: institutionAId,
        channels: ['in_app'],
      });

    const listRes = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${studentAToken}`);
    expect(listRes.body.unreadCount).toBe(2);

    const firstId = listRes.body.notifications[0].id;
    const markOne = await request(app)
      .patch(`/api/notifications/${firstId}/read`)
      .set('Authorization', `Bearer ${studentAToken}`);
    expect(markOne.status).toBe(200);

    const afterOne = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${studentAToken}`);
    expect(afterOne.body.unreadCount).toBe(1);

    const markAll = await request(app)
      .patch('/api/notifications/read-all')
      .set('Authorization', `Bearer ${studentAToken}`);
    expect(markAll.status).toBe(200);
    expect(markAll.body.updated).toBe(1);

    const afterAll = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${studentAToken}`);
    expect(afterAll.body.unreadCount).toBe(0);
  });

  it('schedules notification for later delivery', async () => {
    const scheduledAt = new Date(Date.now() + 1500).toISOString();
    const createRes = await request(app)
      .post('/api/admin/notifications')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        title: 'NTF test scheduled',
        body: 'Later message',
        audienceType: 'institution',
        audienceValue: institutionAId,
        channels: ['in_app'],
        scheduledAt,
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.notification.status).toBe('scheduled');

    const before = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${studentAToken}`);
    expect(before.body.unreadCount).toBe(0);

    await new Promise((resolve) => setTimeout(resolve, 1800));

    const after = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${studentAToken}`);
    expect(after.body.unreadCount).toBe(1);
  });

  it('allows deleting scheduled notifications only', async () => {
    const scheduledAt = new Date(Date.now() + 60_000).toISOString();
    const createRes = await request(app)
      .post('/api/admin/notifications')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        title: 'NTF test delete scheduled',
        body: 'Will delete',
        audienceType: 'all',
        channels: ['in_app'],
        scheduledAt,
      });

    const id = createRes.body.notification.id;
    const deleteRes = await request(app)
      .delete(`/api/admin/notifications/${id}`)
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(deleteRes.status).toBe(200);

    const sent = await Notification.create({
      title: 'NTF test sent locked',
      body: 'Sent',
      audienceType: 'all',
      status: 'sent',
      channels: ['in_app'],
      createdBy: new mongoose.Types.ObjectId(),
      deliveryStats: {
        attempted: 1,
        succeeded: 1,
        failed: 0,
        recipients: 1,
        inAppDelivered: 1,
        emailDelivered: 0,
        emailFailed: 0,
      },
    });

    const failDelete = await request(app)
      .delete(`/api/admin/notifications/${sent._id}`)
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(failDelete.status).toBe(400);
  });

  it('deliverNotification is idempotent for already sent notifications', async () => {
    const note = await Notification.create({
      title: 'NTF test idempotent',
      body: 'Body',
      audienceType: 'all',
      status: 'sent',
      channels: ['in_app'],
      createdBy: new mongoose.Types.ObjectId(),
      sentAt: new Date(),
      deliveryStats: {
        attempted: 1,
        succeeded: 1,
        failed: 0,
        recipients: 1,
        inAppDelivered: 1,
        emailDelivered: 0,
        emailFailed: 0,
      },
    });

    const before = await NotificationRecipient.countDocuments({ notificationId: note._id });
    await deliverNotification(String(note._id));
    const after = await NotificationRecipient.countDocuments({ notificationId: note._id });
    expect(after).toBe(before);
  });
});
