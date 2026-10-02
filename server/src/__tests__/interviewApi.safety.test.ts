import request from 'supertest';

import { createApp } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { Interview } from '../models/Interview';
import { User } from '../models/User';
import * as aiService from '../services/ai.service';
import * as companyQuestions from '../services/companyQuestions.service';
import * as companyQuestionResearch from '../services/companyQuestionResearch.service';
import { createConceptGenerationBatch } from '../services/conceptGenerationQueue.service';
import { seedStudentUser } from './helpers/testAuth';

jest.mock('../config/redis', () => {
  const { createRedisMock } = jest.requireActual('./helpers/redisMock');
  return createRedisMock();
});

jest.mock('../services/conceptGenerationQueue.service', () => {
  const actual = jest.requireActual('../services/conceptGenerationQueue.service');
  return {
    ...actual,
    createConceptGenerationBatch: jest.fn(actual.createConceptGenerationBatch),
  };
});

describe('interview API safety (no unintended AI)', () => {
  const app = createApp();
  const email = 'interview-safety@api-safety.test';

  beforeAll(async () => {
    await connectDatabase();
  });

  beforeEach(async () => {
    await User.deleteMany({ email: /@api-safety\.test$/ });
    await Interview.deleteMany({ roleDomain: 'Safety Test Engineer' });
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await User.deleteMany({ email: /@api-safety\.test$/ });
    await Interview.deleteMany({ roleDomain: 'Safety Test Engineer' });
    await disconnectDatabase();
  });

  it('creates an interview in Setup without background company research or concept generation', async () => {
    const { accessToken } = await seedStudentUser(email);

    jest.spyOn(companyQuestions, 'getCompanyInterviewGuidanceWithResearch').mockResolvedValue(undefined);
    const ensureSpy = jest.spyOn(companyQuestionResearch, 'ensureCompanyQuestions');
    const reportSpy = jest.spyOn(aiService, 'generateReport');
    const transcribeSpy = jest.spyOn(aiService, 'transcribeAudio');
    const batchSpy = createConceptGenerationBatch as jest.Mock;

    const response = await request(app)
      .post('/api/interviews')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        roleLevel: 'Fresher',
        roleDomain: 'Safety Test Engineer',
        interviewStyle: 'Mixed',
        duration: 30,
        targetCompany: 'google',
        interviewType: 'Technical',
        complexity: 'Beginner',
      });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('Setup');
    expect(response.body.roleDomain).toBe('Safety Test Engineer');
    expect(ensureSpy).not.toHaveBeenCalled();
    expect(reportSpy).not.toHaveBeenCalled();
    expect(transcribeSpy).not.toHaveBeenCalled();
    expect(batchSpy).not.toHaveBeenCalled();

    await Interview.deleteMany({ _id: response.body._id });
  });

  it('rejects interview creation without authentication', async () => {
    const response = await request(app)
      .post('/api/interviews')
      .send({
        roleLevel: 'Fresher',
        roleDomain: 'Safety Test Engineer',
        duration: 30,
      });

    expect([401, 403]).toContain(response.status);
  });

  it('rejects invalid interview creation payload', async () => {
    const { accessToken } = await seedStudentUser(email);

    const response = await request(app)
      .post('/api/interviews')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        roleLevel: 'Fresher',
        roleDomain: 'X',
        duration: 45,
      });

    expect(response.status).toBe(400);
  });

  it('lists only the authenticated user interviews', async () => {
    const studentA = await seedStudentUser('student-a@api-safety.test');
    const studentB = await seedStudentUser('student-b@api-safety.test');

    const owned = await Interview.create({
      userId: studentA.user._id,
      roleDomain: 'Safety Test Engineer',
      roleLevel: 'Fresher',
      interviewStyle: 'Mixed',
      duration: 30,
      status: 'Setup',
    });

    await Interview.create({
      userId: studentB.user._id,
      roleDomain: 'Safety Test Engineer',
      roleLevel: 'Fresher',
      interviewStyle: 'Mixed',
      duration: 30,
      status: 'Setup',
    });

    const response = await request(app)
      .get('/api/interviews/user-interviews')
      .set('Authorization', `Bearer ${studentA.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]._id).toBe(String(owned._id));

    await Interview.deleteMany({ roleDomain: 'Safety Test Engineer' });
    await User.deleteMany({ email: /@api-safety\.test$/ });
  });

  it('does not call ensureCompanyQuestions when creating with target company', async () => {
    const { accessToken } = await seedStudentUser('company-guard@api-safety.test');
    const ensureSpy = jest.spyOn(companyQuestionResearch, 'ensureCompanyQuestions');

    const response = await request(app)
      .post('/api/interviews')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        roleLevel: 'Mid',
        roleDomain: 'Safety Test Engineer',
        duration: 30,
        targetCompany: 'Amazon',
      });

    expect(response.status).toBe(201);
    expect(ensureSpy).not.toHaveBeenCalled();

    await Interview.deleteMany({ _id: response.body._id });
    await User.deleteMany({ email: 'company-guard@api-safety.test' });
  });
});
