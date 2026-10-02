import fs from 'fs';
import path from 'path';

import { queryQuestionBankFromDb, type CompanyQuestionBankResult } from './questionBank.service';
import type { CompanyQuestionEntry, ExperienceLevel } from './promptBuilder';

export type { CompanyQuestionBankResult, CompanyQuestionEntry, ExperienceLevel };

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const resolveDataDir = () => {
  const candidates = [
    path.join(__dirname, '../data/companyQuestions'),
    path.join(process.cwd(), 'src/data/companyQuestions'),
    path.join(process.cwd(), 'server/src/data/companyQuestions'),
  ];
  return candidates.find((dir) => fs.existsSync(dir)) ?? candidates[0];
};

export type CompanyQuestionBankFile = {
  company: string;
  roles: Record<
    string,
    Partial<Record<ExperienceLevel, CompanyQuestionEntry[]>>
  >;
};

/** Load interview questions from the database-backed question bank. */
export async function getCompanyQuestions(
  companyName?: string,
  role?: string,
  experienceLevel: ExperienceLevel = 'fresher',
  limit = 8,
): Promise<CompanyQuestionBankResult | null> {
  return queryQuestionBankFromDb(companyName, role, experienceLevel, limit);
}

export function listAvailableCompanyBanks() {
  return [];
}

export { slugify as slugifyCompanyName, resolveDataDir as getCompanyQuestionsDataDir };
