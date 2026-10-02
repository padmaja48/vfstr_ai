import mongoose from 'mongoose';
import {
  IQuestion,
  Question,
  QuestionCategory,
  QuestionCreatedBy,
  QuestionDifficulty,
  QuestionStatus,
} from '../models/Question';
import { slugifyCompanyName } from './companyQuestionBank';
import type { CompanyQuestionEntry, ExperienceLevel } from './promptBuilder';
import { generateQuestionBankCandidates } from './ai.service';

export type QuestionBankEntry = CompanyQuestionEntry & {
  questionId?: string;
  bankQuestionId?: string;
};

export type CompanyQuestionBankResult = {
  questions: QuestionBankEntry[];
  mode: 'verified' | 'generic';
  companyLabel: string;
};

export const normalizeQuestionText = (text: string) =>
  String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();

export type DuplicateMatch = {
  id: string;
  text: string;
  similarity: 'exact' | 'near';
};

export const findDuplicateCandidates = async (text: string): Promise<DuplicateMatch[]> => {
  const normalized = normalizeQuestionText(text);
  if (!normalized) return [];

  const exact = await Question.find({ normalizedText: normalized }).select('_id text normalizedText').lean();
  const matches: DuplicateMatch[] = exact.map((row) => ({
    id: String(row._id),
    text: row.text,
    similarity: 'exact' as const,
  }));

  if (matches.length) return matches;

  if (normalized.length >= 24) {
    const prefix = normalized.slice(0, Math.min(80, normalized.length));
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const near = await Question.find({
      normalizedText: { $regex: escaped, $options: 'i' },
      status: { $in: ['active', 'archived'] },
    })
      .select('_id text normalizedText')
      .limit(5)
      .lean();

    for (const row of near) {
      const other = row.normalizedText;
      const shorter = normalized.length <= other.length ? normalized : other;
      const longer = normalized.length > other.length ? normalized : other;
      if (longer.includes(shorter) && shorter.length / longer.length >= 0.85) {
        matches.push({
          id: String(row._id),
          text: row.text,
          similarity: 'near',
        });
      }
    }
  }

  return matches;
};

const serializeQuestion = (doc: IQuestion | Record<string, unknown>) => {
  const json = (typeof (doc as IQuestion).toJSON === 'function'
    ? (doc as IQuestion).toJSON()
    : { ...(doc as Record<string, unknown>) }) as Record<string, unknown>;
  return {
    id: String(json._id || json.id),
    text: json.text,
    category: json.category,
    difficulty: json.difficulty,
    company: json.company || '',
    companySlug: json.companySlug || '',
    tags: json.tags || [],
    role: json.role || '',
    experienceLevel: json.experienceLevel || '',
    source: json.source || '',
    createdBy: json.createdBy,
    createdByUserId: json.createdByUserId ? String(json.createdByUserId) : undefined,
    usageCount: json.usageCount ?? 0,
    status: json.status,
    editHistory: Array.isArray(json.editHistory)
      ? json.editHistory.map((entry: Record<string, unknown>) => ({
        text: entry.text,
        editedBy: entry.editedBy ? String(entry.editedBy) : undefined,
        editedAt: entry.editedAt,
      }))
      : [],
    createdAt: json.createdAt,
    updatedAt: json.updatedAt,
  };
};

const sampleRows = <T>(items: T[], limit: number) => {
  if (items.length <= limit) return items;
  const shuffled = [...items].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, limit);
};

const toBankEntry = (row: {
  _id: mongoose.Types.ObjectId;
  text: string;
  source?: string;
  tags?: string[];
}): QuestionBankEntry => {
  const typeTag = (row.tags || []).find((tag) =>
    ['coding', 'technical', 'behavioral', 'situational', 'system_design'].includes(tag),
  );
  return {
    question: row.text,
    questionId: String(row._id),
    bankQuestionId: String(row._id),
    type: (typeTag as QuestionBankEntry['type']) || 'technical',
    source: row.source,
  };
};

const ROLE_ALIASES: Record<string, string[]> = {
  'Software Engineer': [
    'software engineer',
    'software development engineer',
    'sde',
    'swe',
    'developer',
    'software developer',
    'full stack',
    'full-stack',
  ],
  'Frontend Engineer': ['frontend', 'frontend developer', 'frontend engineer', 'ui developer'],
  'Backend Engineer': ['backend', 'backend developer', 'backend engineer', 'server engineer'],
  'Data Analyst': ['data analyst', 'business analyst', 'analytics'],
  'Data Scientist': ['data scientist', 'ml engineer', 'machine learning engineer', 'ai engineer'],
  'QA Engineer': ['qa', 'quality assurance', 'sdet', 'test engineer'],
  'Product Manager': ['product manager', 'pm', 'associate product manager'],
};

const matchRoleKey = (requestedRole: string, availableRoles: string[]) => {
  const normalized = requestedRole.trim().toLowerCase();
  const exact = availableRoles.find((key) => key.toLowerCase() === normalized);
  if (exact) return exact;

  for (const [canonical, aliases] of Object.entries(ROLE_ALIASES)) {
    if (availableRoles.includes(canonical) && aliases.some((alias) => normalized.includes(alias) || alias.includes(normalized))) {
      return canonical;
    }
  }

  return availableRoles.find(
    (key) => normalized.includes(key.toLowerCase()) || key.toLowerCase().includes(normalized),
  );
};

export const queryQuestionBankFromDb = async (
  companyName?: string,
  role?: string,
  experienceLevel: ExperienceLevel = 'fresher',
  limit = 8,
): Promise<CompanyQuestionBankResult | null> => {
  if (!role?.trim()) return null;

  const companySlug = companyName?.trim() ? slugifyCompanyName(companyName.trim()) : '';
  const baseFilter: Record<string, unknown> = {
    status: 'active',
    $or: [
      { experienceLevel },
      { experienceLevel: { $exists: false } },
    ],
  };

  const roleRows = await Question.distinct('role', { status: 'active', role: { $exists: true, $ne: '' } });
  const roleKey = matchRoleKey(role, roleRows as string[]) || role.trim();

  let rows: Array<{ _id: mongoose.Types.ObjectId; text: string; source?: string; tags?: string[] }> = [];

  if (companySlug) {
    rows = await Question.find({
      ...baseFilter,
      companySlug,
      $or: [{ role: roleKey }, { role: role.trim() }, { role: { $exists: false } }],
    })
      .select('_id text source tags')
      .lean();
  }

  let mode: 'verified' | 'generic' = 'verified';
  if (!rows.length) {
    mode = 'generic';
    rows = await Question.find({
      ...baseFilter,
      $or: [
        { companySlug: { $exists: false } },
        { companySlug: '' },
        { companySlug: null },
        { tags: 'generic-pool' },
      ],
      $and: [
        {
          $or: [{ role: roleKey }, { role: role.trim() }, { role: 'Software Engineer' }],
        },
      ],
    })
      .select('_id text source tags')
      .limit(Math.max(limit * 3, 24))
      .lean();
  }

  if (!rows.length) return null;

  return {
    questions: sampleRows(rows, limit).map(toBankEntry),
    mode,
    companyLabel: companyName?.trim() || 'Generic Industry Pool',
  };
};

export const incrementQuestionUsage = async (questionId?: string) => {
  const id = String(questionId || '').trim();
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return;
  await Question.updateOne({ _id: id }, { $inc: { usageCount: 1 } });
};

export type ListQuestionsOptions = {
  page?: number;
  limit?: number;
  search?: string;
  category?: string;
  difficulty?: string;
  company?: string;
  status?: QuestionStatus | 'all';
  createdBy?: string;
};

export const listQuestions = async (options: ListQuestionsOptions = {}) => {
  const page = Math.max(1, options.page || 1);
  const limit = Math.min(100, Math.max(1, options.limit || 25));
  const filter: Record<string, unknown> = {};

  if (options.category && options.category !== 'all') filter.category = options.category;
  if (options.difficulty && options.difficulty !== 'all') filter.difficulty = options.difficulty;
  if (options.createdBy && options.createdBy !== 'all') filter.createdBy = options.createdBy;
  if (options.status && options.status !== 'all') filter.status = options.status;

  if (options.company?.trim()) {
    const slug = slugifyCompanyName(options.company.trim());
    filter.$or = [
      { companySlug: slug },
      { company: { $regex: options.company.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
    ];
  }

  if (options.search?.trim()) {
    const escaped = options.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.text = { $regex: escaped, $options: 'i' };
  }

  const [rows, total] = await Promise.all([
    Question.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit),
    Question.countDocuments(filter),
  ]);

  return {
    questions: rows.map(serializeQuestion),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
};

export const getQuestionById = async (id: string) => {
  const row = await Question.findById(id);
  if (!row) return null;
  return serializeQuestion(row);
};

export type CreateQuestionInput = {
  text: string;
  category: QuestionCategory;
  difficulty: QuestionDifficulty;
  company?: string;
  tags?: string[];
  role?: string;
  experienceLevel?: 'fresher' | 'experienced';
  source?: string;
  createdBy: QuestionCreatedBy;
  createdByUserId?: string;
  status?: QuestionStatus;
};

export const createQuestionRecord = async (input: CreateQuestionInput) => {
  const text = input.text.trim();
  const company = input.company?.trim() || undefined;
  const row = await Question.create({
    text,
    normalizedText: normalizeQuestionText(text),
    category: input.category,
    difficulty: input.difficulty,
    company,
    companySlug: company ? slugifyCompanyName(company) : undefined,
    tags: input.tags || [],
    role: input.role?.trim() || undefined,
    experienceLevel: input.experienceLevel,
    source: input.source?.trim() || undefined,
    createdBy: input.createdBy,
    createdByUserId: input.createdByUserId,
    status: input.status || 'active',
  });
  return serializeQuestion(row);
};

export const updateQuestionRecord = async (
  id: string,
  input: Partial<CreateQuestionInput> & { editorUserId: string },
) => {
  const row = await Question.findById(id);
  if (!row) return null;

  const nextText = input.text?.trim();
  if (nextText && nextText !== row.text) {
    row.editHistory.push({
      text: row.text,
      editedBy: new mongoose.Types.ObjectId(input.editorUserId),
      editedAt: new Date(),
    });
    row.text = nextText;
    row.normalizedText = normalizeQuestionText(nextText);
  }

  if (input.category) row.category = input.category;
  if (input.difficulty) row.difficulty = input.difficulty;
  if (input.tags) row.tags = input.tags;
  if (input.role !== undefined) row.role = input.role?.trim() || undefined;
  if (input.experienceLevel !== undefined) row.experienceLevel = input.experienceLevel;
  if (input.source !== undefined) row.source = input.source?.trim() || undefined;
  if (input.company !== undefined) {
    const company = input.company.trim() || undefined;
    row.company = company;
    row.companySlug = company ? slugifyCompanyName(company) : undefined;
  }

  await row.save();
  return serializeQuestion(row);
};

export const archiveQuestionRecord = async (id: string) => {
  const row = await Question.findByIdAndUpdate(
    id,
    { status: 'archived' },
    { new: true },
  );
  if (!row) return null;
  return serializeQuestion(row);
};

export type BulkCreateResult = {
  created: ReturnType<typeof serializeQuestion>[];
  warnings: Array<{ index: number; text: string; duplicates: DuplicateMatch[] }>;
};

export const bulkCreateQuestions = async (
  items: CreateQuestionInput[],
  createdByUserId?: string,
): Promise<BulkCreateResult> => {
  const created: ReturnType<typeof serializeQuestion>[] = [];
  const warnings: BulkCreateResult['warnings'] = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const duplicates = await findDuplicateCandidates(item.text);
    if (duplicates.length) {
      warnings.push({ index, text: item.text, duplicates });
    }
    const row = await createQuestionRecord({
      ...item,
      createdByUserId: createdByUserId || item.createdByUserId,
    });
    created.push(row);
  }

  return { created, warnings };
};

export const generateQuestionPreview = async (input: {
  roleTopic: string;
  company?: string;
  category: QuestionCategory;
  difficulty: QuestionDifficulty;
  count: number;
}) => {
  const generated = await generateQuestionBankCandidates(input);
  const withDuplicates = await Promise.all(
    generated.map(async (item) => ({
      ...item,
      duplicateWarnings: await findDuplicateCandidates(item.text),
    })),
  );
  return withDuplicates;
};

export { serializeQuestion };
