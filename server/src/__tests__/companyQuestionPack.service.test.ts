import { buildCompanyQuestionPack } from '../services/companyQuestionPack.service';
import * as research from '../services/companyQuestionResearch.service';
import { getCompanyQuestions } from '../services/companyQuestionBank';
import { connectDatabase, disconnectDatabase } from '../config/database';

describe('buildCompanyQuestionPack', () => {
  beforeAll(async () => {
    await connectDatabase();

    const { Question } = await import('../models/Question');
    const { normalizeQuestionText } = await import('../services/questionBank.service');
    const amazonExists = await Question.exists({ companySlug: 'amazon', status: 'active' });
    if (!amazonExists) {
      await Question.create({
        text: 'Amazon pack test coding question: merge two sorted linked lists.',
        normalizedText: normalizeQuestionText('Amazon pack test coding question: merge two sorted linked lists.'),
        category: 'Company-specific',
        difficulty: 'Easy',
        company: 'Amazon',
        companySlug: 'amazon',
        role: 'Software Engineer',
        experienceLevel: 'fresher',
        tags: ['coding'],
        createdBy: 'migrated',
        status: 'active',
      });
    }
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('builds culture + technical + coding with source tags for Amazon', async () => {
    const pack = await buildCompanyQuestionPack({
      companyName: 'amazon',
      role: 'Software Engineer',
      experienceLevel: 'fresher',
      resumeProject: 'Expense Tracker Platform',
    });

    expect(pack.composition.culture).toBe(1);
    expect(pack.composition.coding).toBe(1);
    expect(pack.composition.technical).toBeGreaterThanOrEqual(2);
    expect(pack.mode).toBe('verified');
    expect(pack.questions.length).toBeGreaterThanOrEqual(4);
    expect(pack.questions[0].question).toMatch(/owned|ownership|customer/i);
    expect(pack.questions.some((item) => /coding|array|indices|median|complexity/i.test(item.question))).toBe(
      true,
    );
    expect(pack.questions.some((item) => /Expense Tracker Platform/i.test(item.question))).toBe(true);
    expect(
      pack.questions.every((item) => !/company-style expectations|interview expectations/i.test(item.question)),
    ).toBe(true);
    expect(pack.questions.every((item) => item.resumeReference?.includes('·'))).toBe(true);
  });

  it('uses role-based mode for unknown companies without inventing official claims', async () => {
    const ensureSpy = jest.spyOn(research, 'ensureCompanyQuestions').mockResolvedValue({
      questions: [],
      mode: 'generic',
      companyLabel: 'TinyUnknownCoXYZ',
      fromCache: false,
    });

    const pack = await buildCompanyQuestionPack({
      companyName: 'TinyUnknownCoXYZ',
      role: 'Software Engineer',
      experienceLevel: 'experienced',
    });

    expect(pack.mode).toBe('role_based');
    expect(pack.composition.culture).toBe(1);
    expect(pack.composition.coding).toBe(1);
    expect(pack.questions.some((item) => /production|trade-off|observability|median/i.test(item.question))).toBe(
      true,
    );
    expect(pack.questions.every((item) => !/official TinyUnknownCoXYZ/i.test(item.question))).toBe(true);

    ensureSpy.mockRestore();
  });

  it('prefers verified bank questions when available', async () => {
    const verified = await getCompanyQuestions('Amazon', 'Software Engineer', 'fresher', 8);
    expect(verified?.mode).toBe('verified');
    expect(verified?.questions.length).toBeGreaterThan(0);
  });
});
