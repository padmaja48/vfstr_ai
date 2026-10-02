/**
 * One-time migration: static JSON banks → MongoDB Question collection.
 *
 * Usage:
 *   npm run migrate:question-bank --workspace server
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

type JsonEntry = {
  question: string;
  type: string;
  source?: string;
};

type JsonBank = {
  company: string;
  roles: Record<string, Partial<Record<'fresher' | 'experienced', JsonEntry[]>>>;
};

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const mapTypeToCategory = (type: string, isGeneric: boolean) => {
  if (!isGeneric) return 'Company-specific' as const;
  switch (type) {
    case 'coding': return 'Coding' as const;
    case 'behavioral': return 'Behavioral' as const;
    case 'situational': return 'HR' as const;
    case 'system_design': return 'Technical' as const;
    default: return 'Technical' as const;
  }
};

const mapLevelToDifficulty = (level: 'fresher' | 'experienced') =>
  (level === 'fresher' ? 'Easy' : 'Hard') as 'Easy' | 'Medium' | 'Hard';

const dataDir = path.resolve(__dirname, '../src/data/companyQuestions');

async function main() {
  const { env } = await import('../src/config/env');
  const { Question } = await import('../src/models/Question');
  const { normalizeQuestionText } = await import('../src/services/questionBank.service');

  await mongoose.connect(env.MONGODB_URI);
  console.log('Connected to MongoDB');

  if (!fs.existsSync(dataDir)) {
    throw new Error(`Question data directory not found: ${dataDir}`);
  }

  const files = fs.readdirSync(dataDir).filter((file) => file.endsWith('.json'));
  let inserted = 0;
  let skipped = 0;

  for (const file of files) {
    const isGeneric = file.startsWith('_');
    const bank = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8')) as JsonBank;
    const company = isGeneric ? undefined : bank.company;
    const companySlug = company ? slugify(company) : undefined;

    for (const [role, levels] of Object.entries(bank.roles || {})) {
      for (const [level, entries] of Object.entries(levels || {})) {
        const experienceLevel = level as 'fresher' | 'experienced';
        for (const entry of entries || []) {
          const text = String(entry.question || '').trim();
          if (text.length < 8) continue;

          const normalizedText = normalizeQuestionText(text);
          const exists = await Question.findOne({ normalizedText }).select('_id').lean();
          if (exists) {
            skipped += 1;
            continue;
          }

          await Question.create({
            text,
            normalizedText,
            category: mapTypeToCategory(entry.type, isGeneric),
            difficulty: mapLevelToDifficulty(experienceLevel),
            company,
            companySlug,
            tags: [entry.type, ...(isGeneric ? ['generic-pool'] : []), ...(entry.source ? [entry.source] : [])],
            role,
            experienceLevel,
            source: entry.source,
            createdBy: 'migrated',
            usageCount: 0,
            status: 'active',
          });
          inserted += 1;
        }
      }
    }
  }

  console.log(`Migration complete. Inserted ${inserted}, skipped ${skipped} duplicates.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
