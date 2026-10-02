import { z } from 'zod';
import { QUESTION_CATEGORIES, QUESTION_DIFFICULTIES } from '../models/Question';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import {
  archiveQuestionRecord,
  bulkCreateQuestions,
  createQuestionRecord,
  findDuplicateCandidates,
  generateQuestionPreview,
  getQuestionById,
  listQuestions,
  updateQuestionRecord,
} from '../services/questionBank.service';

const categoryEnum = z.enum(QUESTION_CATEGORIES as unknown as [string, ...string[]]);
const difficultyEnum = z.enum(QUESTION_DIFFICULTIES as unknown as [string, ...string[]]);

export const listQuestionsQuerySchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    search: z.string().optional(),
    category: z.string().optional(),
    difficulty: z.string().optional(),
    company: z.string().optional(),
    status: z.enum(['active', 'archived', 'all']).optional(),
    createdBy: z.string().optional(),
  }),
});

export const questionIdSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
});

export const createQuestionSchema = z.object({
  body: z.object({
    text: z.string().trim().min(8).max(8000),
    category: categoryEnum,
    difficulty: difficultyEnum,
    company: z.string().trim().max(160).optional(),
    tags: z.array(z.string().trim().max(80)).optional(),
    role: z.string().trim().max(160).optional(),
    experienceLevel: z.enum(['fresher', 'experienced']).optional(),
    source: z.string().trim().max(200).optional(),
  }),
});

export const updateQuestionSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    text: z.string().trim().min(8).max(8000).optional(),
    category: categoryEnum.optional(),
    difficulty: difficultyEnum.optional(),
    company: z.string().trim().max(160).optional(),
    tags: z.array(z.string().trim().max(80)).optional(),
    role: z.string().trim().max(160).optional(),
    experienceLevel: z.enum(['fresher', 'experienced']).optional(),
    source: z.string().trim().max(200).optional(),
  }),
});

export const generateQuestionsSchema = z.object({
  body: z.object({
    roleTopic: z.string().trim().min(2).max(200),
    company: z.string().trim().max(160).optional(),
    category: categoryEnum,
    difficulty: difficultyEnum,
    count: z.coerce.number().int().min(1).max(10),
  }),
});

export const bulkCreateQuestionsSchema = z.object({
  body: z.object({
    questions: z.array(z.object({
      text: z.string().trim().min(8).max(8000),
      category: categoryEnum,
      difficulty: difficultyEnum,
      company: z.string().trim().max(160).optional(),
      tags: z.array(z.string().trim().max(80)).optional(),
      role: z.string().trim().max(160).optional(),
      experienceLevel: z.enum(['fresher', 'experienced']).optional(),
      source: z.string().trim().max(200).optional(),
      createdBy: z.enum(['admin', 'ai']).optional(),
    })).min(1).max(50),
  }),
});

export const listQuestionsHandler = asyncHandler(async (req, res) => {
  const payload = await listQuestions({
    page: Number.parseInt(String(req.query.page || '1'), 10) || 1,
    limit: Number.parseInt(String(req.query.limit || '25'), 10) || 25,
    search: String(req.query.search || ''),
    category: String(req.query.category || 'all'),
    difficulty: String(req.query.difficulty || 'all'),
    company: String(req.query.company || ''),
    status: (String(req.query.status || 'active') as 'active' | 'archived' | 'all'),
    createdBy: String(req.query.createdBy || 'all'),
  });
  res.json(payload);
});

export const getQuestionHandler = asyncHandler(async (req, res) => {
  const row = await getQuestionById(String(req.params.id));
  if (!row) throw new AppError('Question not found', 404, 'QUESTION_NOT_FOUND');
  res.json(row);
});

export const createQuestionHandler = asyncHandler(async (req, res) => {
  const duplicates = await findDuplicateCandidates(req.body.text);
  const created = await createQuestionRecord({
    ...req.body,
    createdBy: 'admin',
    createdByUserId: String(req.user!._id),
  });
  res.status(201).json({ question: created, duplicateWarnings: duplicates });
});

export const updateQuestionHandler = asyncHandler(async (req, res) => {
  const duplicates = req.body.text ? await findDuplicateCandidates(req.body.text) : [];
  const updated = await updateQuestionRecord(String(req.params.id), {
    ...req.body,
    editorUserId: String(req.user!._id),
  });
  if (!updated) throw new AppError('Question not found', 404, 'QUESTION_NOT_FOUND');
  res.json({ question: updated, duplicateWarnings: duplicates });
});

export const archiveQuestionHandler = asyncHandler(async (req, res) => {
  const archived = await archiveQuestionRecord(String(req.params.id));
  if (!archived) throw new AppError('Question not found', 404, 'QUESTION_NOT_FOUND');
  res.json({ question: archived });
});

export const generateQuestionsHandler = asyncHandler(async (req, res) => {
  const preview = await generateQuestionPreview(req.body);
  res.json({ questions: preview });
});

export const bulkCreateQuestionsHandler = asyncHandler(async (req, res) => {
  const items = req.body.questions.map((item: Record<string, unknown>) => ({
    text: String(item.text),
    category: item.category,
    difficulty: item.difficulty,
    company: item.company ? String(item.company) : undefined,
    tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
    role: item.role ? String(item.role) : undefined,
    experienceLevel: item.experienceLevel as 'fresher' | 'experienced' | undefined,
    source: item.source ? String(item.source) : undefined,
    createdBy: (item.createdBy === 'ai' ? 'ai' : 'admin') as 'admin' | 'ai',
    createdByUserId: String(req.user!._id),
  }));
  const result = await bulkCreateQuestions(items, String(req.user!._id));
  res.status(201).json(result);
});
