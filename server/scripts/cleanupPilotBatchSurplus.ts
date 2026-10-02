/**
 * Archive surplus pilot-generation batches, keeping one batch per company.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/cleanupPilotBatchSurplus.ts
 *   npx ts-node --transpile-only scripts/cleanupPilotBatchSurplus.ts --apply
 *   npx ts-node --transpile-only scripts/cleanupPilotBatchSurplus.ts --apply amazon tcs razorpay
 */
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { QuestionConcept } from '../src/models/QuestionConcept';

/**
 * Keep the batch with manual review edits / latest approved pilot run.
 * Prefix = first 8 chars of Mongo ObjectId (batch cohort).
 */
const KEEP_ID_PREFIX: Record<string, string> = {
  'pennant-technologies': '6a893eb8',
  siemens: '6a893ead',
  amazon: '6a893c7c',
  tcs: '6a893c86',
  razorpay: '6a893c8e',
};

const main = async () => {
  const apply = process.argv.includes('--apply');
  const companyArgs = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const companies = companyArgs.length
    ? companyArgs.filter((slug) => KEEP_ID_PREFIX[slug])
    : Object.keys(KEEP_ID_PREFIX);

  const unknown = companyArgs.filter((slug) => !KEEP_ID_PREFIX[slug]);
  if (unknown.length) {
    console.warn(`Skipping unknown companies (no keep prefix configured): ${unknown.join(', ')}`);
  }

  await connectDatabase();

  const beforeCounts: Record<string, number> = {};

  for (const companySlug of companies) {
    beforeCounts[companySlug] = await QuestionConcept.countDocuments({
      companySlug,
      status: 'active',
    });
  }

  console.log('=== BEFORE ===');
  companies.forEach((slug) => console.log(`${slug}: ${beforeCounts[slug]} active`));

  for (const companySlug of companies) {
    const keepPrefix = KEEP_ID_PREFIX[companySlug];
    const rows = await QuestionConcept.find({
      companySlug,
      status: { $in: ['active', 'pending_review'] },
    }).lean();

    const toArchive = rows.filter((row) => !String(row._id).startsWith(keepPrefix));
    console.log(`\n${companySlug}: keeping prefix ${keepPrefix}, archiving ${toArchive.length} surplus record(s)`);

    if (apply && toArchive.length) {
      const result = await QuestionConcept.updateMany(
        { _id: { $in: toArchive.map((row) => row._id) } },
        { $set: { status: 'archived' } },
      );
      console.log(`  -> archived ${result.modifiedCount ?? 0}`);
    } else if (!apply && toArchive.length) {
      toArchive.slice(0, 5).forEach((row) => {
        console.log(`  WOULD ARCHIVE ${row._id} [${row.category}] ${(row.conceptLabel || '').slice(0, 60)}`);
      });
      if (toArchive.length > 5) console.log(`  ... and ${toArchive.length - 5} more`);
    }
  }

  console.log('\n=== AFTER ===');
  for (const companySlug of companies) {
    const active = await QuestionConcept.countDocuments({ companySlug, status: 'active' });
    const archived = await QuestionConcept.countDocuments({ companySlug, status: 'archived' });
    console.log(`${companySlug}: ${beforeCounts[companySlug]} -> ${active} active (${archived} archived total)`);
  }

  if (!apply) {
    console.log('\nRe-run with --apply to archive surplus pilot batches.');
  }

  await disconnectDatabase();
};

void main();
