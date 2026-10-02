/**
 * Bulk-import company interview questions from JSON or CSV into data/companyQuestions/.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/seedCompanyQuestions.ts path/to/questions.json
 *   npx ts-node --transpile-only scripts/seedCompanyQuestions.ts path/to/questions.csv
 *
 * JSON format (single company file):
 * {
 *   "company": "Amazon",
 *   "roles": {
 *     "Software Engineer": {
 *       "fresher": [{ "question": "...", "type": "coding", "source": "reported 2024" }],
 *       "experienced": []
 *     }
 *   }
 * }
 *
 * CSV format (one row per question):
 * company,role,experienceLevel,question,type,source
 */

import fs from 'fs';
import path from 'path';

type QuestionEntry = {
  question: string;
  type: string;
  source?: string;
};

type CompanyBank = {
  company: string;
  roles: Record<string, Partial<Record<'fresher' | 'experienced', QuestionEntry[]>>>;
};

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const dataDir = path.resolve(__dirname, '../src/data/companyQuestions');

const parseCsv = (content: string): CompanyBank[] => {
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim());
  const banks = new Map<string, CompanyBank>();

  for (const line of lines.slice(1)) {
    const values = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
    const company = row.company;
    const role = row.role;
    const level = (row.experienceLevel === 'experienced' ? 'experienced' : 'fresher') as 'fresher' | 'experienced';
    const question = row.question;
    if (!company || !role || !question) continue;

    const slug = slugify(company);
    if (!banks.has(slug)) {
      banks.set(slug, { company, roles: {} });
    }

    const bank = banks.get(slug)!;
    bank.roles[role] ??= {};
    bank.roles[role][level] ??= [];
    bank.roles[role][level]!.push({
      question,
      type: row.type || 'technical',
      source: row.source || undefined,
    });
  }

  return Array.from(banks.values());
};

const mergeBank = (existing: CompanyBank | null, incoming: CompanyBank): CompanyBank => {
  if (!existing) return incoming;

  const merged: CompanyBank = {
    company: incoming.company || existing.company,
    roles: { ...existing.roles },
  };

  for (const [role, levels] of Object.entries(incoming.roles)) {
    merged.roles[role] ??= {};
    for (const [level, questions] of Object.entries(levels)) {
      const key = level as 'fresher' | 'experienced';
      const current = merged.roles[role][key] ?? [];
      const seen = new Set(current.map((item) => item.question.toLowerCase()));
      for (const question of questions ?? []) {
        if (!seen.has(question.question.toLowerCase())) {
          current.push(question);
          seen.add(question.question.toLowerCase());
        }
      }
      merged.roles[role][key] = current;
    }
  }

  return merged;
};

const main = () => {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Provide a JSON or CSV file path.');
    process.exit(1);
  }

  if (!fs.existsSync(inputPath)) {
    console.error(`File not found: ${inputPath}`);
    process.exit(1);
  }

  fs.mkdirSync(dataDir, { recursive: true });
  const content = fs.readFileSync(inputPath, 'utf8');
  const ext = path.extname(inputPath).toLowerCase();

  const banks: CompanyBank[] =
    ext === '.csv'
      ? parseCsv(content)
      : Array.isArray(JSON.parse(content))
      ? (JSON.parse(content) as CompanyBank[])
      : [JSON.parse(content) as CompanyBank];

  for (const bank of banks) {
    const slug = slugify(bank.company);
    const target = path.join(dataDir, `${slug}.json`);
    const existing = fs.existsSync(target)
      ? (JSON.parse(fs.readFileSync(target, 'utf8')) as CompanyBank)
      : null;
    const merged = mergeBank(existing, bank);
    fs.writeFileSync(target, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
    console.log(`Wrote ${target}`);
  }
};

main();
