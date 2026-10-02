import request from 'supertest';

import { createApp } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { Schedule } from '../models/Schedule';
import { User } from '../models/User';
import { seedStudentUser } from './helpers/testAuth';

jest.mock('../config/redis', () => {
  const { createRedisMock } = jest.requireActual('./helpers/redisMock');
  return createRedisMock();
});

jest.mock('../services/reminder.service', () => ({
  queueReminder: jest.fn().mockResolvedValue({ id: 'reminder-job-1' }),
  removeReminder: jest.fn().mockResolvedValue(undefined),
}));

describe('authentication and authorization integration', () => {
  const app = createApp();

  beforeAll(async () => {
    await connectDatabase();
  });

  afterAll(async () => {
    await User.deleteMany({ email: /@auth-security\.test$/ });
    await disconnectDatabase();
  });

  it('rejects login with invalid credentials', async () => {
    await seedStudentUser('valid@auth-security.test');

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'valid@auth-security.test', password: 'WrongPassword1!' });

    expect(response.status).toBe(401);
  });

  it('rejects protected dashboard without a token', async () => {
    const response = await request(app).get('/api/users/dashboard');
    expect(response.status).toBe(401);
  });

  it('allows authenticated access to dashboard', async () => {
    const { accessToken } = await seedStudentUser('dashboard@auth-security.test');

    const dashboard = await request(app)
      .get('/api/users/dashboard')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(dashboard.status).toBe(200);
    expect(dashboard.body).toHaveProperty('totals');
    expect(dashboard.body.user.email).toBe('dashboard@auth-security.test');
  });

  it('rejects student access to admin interview list', async () => {
    const { accessToken } = await seedStudentUser('student-admin@auth-security.test');

    const response = await request(app)
      .get('/api/interviews/admin/all')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(403);
  });
});

describe('schedule CRUD isolation', () => {
  const app = createApp();
  const futureDate = () => new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

  beforeAll(async () => {
    await connectDatabase();
  });

  beforeEach(async () => {
    await User.deleteMany({ email: /@schedule-crud\.test$/ });
    await Schedule.deleteMany({ title: /^Schedule CRUD / });
  });

  afterAll(async () => {
    await User.deleteMany({ email: /@schedule-crud\.test$/ });
    await Schedule.deleteMany({ title: /^Schedule CRUD / });
    await disconnectDatabase();
  });

  it('creates, reads, updates, and deletes a schedule for the owner only', async () => {
    const owner = await seedStudentUser('owner@schedule-crud.test');
    const intruder = await seedStudentUser('intruder@schedule-crud.test');

    const createRes = await request(app)
      .post('/api/schedules')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        title: 'Schedule CRUD Mock Interview',
        scheduledFor: futureDate().toISOString(),
        timezone: 'UTC',
        notes: 'Prepare STAR stories',
      });

    expect(createRes.status).toBe(201);
    const scheduleId = createRes.body._id;

    const listRes = await request(app)
      .get('/api/schedules')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.some((item: { _id: string }) => item._id === scheduleId)).toBe(true);

    const updateRes = await request(app)
      .put(`/api/schedules/${scheduleId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ title: 'Schedule CRUD Updated Title' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.title).toBe('Schedule CRUD Updated Title');

    const intruderUpdate = await request(app)
      .put(`/api/schedules/${scheduleId}`)
      .set('Authorization', `Bearer ${intruder.accessToken}`)
      .send({ title: 'Hijacked' });
    expect(intruderUpdate.status).toBe(404);

    const deleteRes = await request(app)
      .delete(`/api/schedules/${scheduleId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.status).toBe('Cancelled');

    const afterDelete = await request(app)
      .get('/api/schedules')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    const cancelled = afterDelete.body.find((item: { _id: string }) => item._id === scheduleId);
    expect(cancelled?.status).toBe('Cancelled');
  });

  it('rejects schedule creation in the past', async () => {
    const { accessToken } = await seedStudentUser('past@schedule-crud.test');

    const response = await request(app)
      .post('/api/schedules')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'Schedule CRUD Past',
        scheduledFor: new Date(Date.now() - 60_000).toISOString(),
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_SCHEDULE_TIME');
  });
});
