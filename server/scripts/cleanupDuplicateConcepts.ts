/**
 * Archive duplicate active/pending_review concepts (same company + label).
 * Keeps the record with the latest updatedAt.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/cleanupDuplicateConcepts.ts
 *   npx ts-node --transpile-only scripts/cleanupDuplicateConcepts.ts --apply
 *   npx ts-node --transpile-only scripts/cleanupDuplicateConcepts.ts --apply pennant-technologies siemens
 */
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { QuestionConcept } from '../src/models/QuestionConcept';

const normalizeLabel = (label: string) => label.trim().toLowerCase().replace(/\s+/g, ' ');

const main = async () => {
  const apply = process.argv.includes('--apply');
  const companyArgs = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const companies = companyArgs.length
    ? companyArgs
    : ['pennant-technologies', 'siemens'];

  await connectDatabase();

  const match: Record<string, unknown> = {
    status: { $in: ['active', 'pending_review'] },
    companySlug: { $in: companies },
  };

  const rows = await QuestionConcept.find(match).sort({ updatedAt: -1 }).lean();
  const groups = new Map<string, typeof rows>();

  for (const row of rows) {
    const key = `${row.companySlug}::${normalizeLabel(row.conceptLabel || '')}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  const toArchive: Array<{ id: string; companySlug: string; label: string; reason: string }> = [];

  for (const [key, bucket] of groups.entries()) {
    if (bucket.length <= 1) continue;
    const [keep, ...drop] = bucket;
    for (const row of drop) {
      toArchive.push({
        id: String(row._id),
        companySlug: row.companySlug,
        label: row.conceptLabel,
        reason: `Duplicate of ${keep._id} (${key})`,
      });
    }
  }

  console.log(`Companies: ${companies.join(', ')}`);
  console.log(`Duplicate records to archive: ${toArchive.length}${apply ? '' : ' (dry run)'}`);

  toArchive.forEach((item) => {
    console.log(`\n[${item.companySlug}]`);
    console.log(`  ARCHIVE: ${item.id}`);
    console.log(`  LABEL:   ${item.label}`);
    console.log(`  REASON:  ${item.reason}`);
  });

  if (apply && toArchive.length) {
    const result = await QuestionConcept.updateMany(
      { _id: { $in: toArchive.map((item) => item.id) } },
      { $set: { status: 'archived' } },
    );
    console.log(`\nArchived ${result.modifiedCount ?? 0} duplicate concept(s).`);
  } else if (!apply && toArchive.length) {
    console.log('\nRe-run with --apply to archive these duplicates.');
  }

  for (const slug of companies) {
    const active = await QuestionConcept.countDocuments({ companySlug: slug, status: 'active' });
    const pending = await QuestionConcept.countDocuments({ companySlug: slug, status: 'pending_review' });
    const archived = await QuestionConcept.countDocuments({ companySlug: slug, status: 'archived' });
    console.log(`\n${slug} after cleanup: active=${active}, pending=${pending}, archived=${archived}`);
  }

  await disconnectDatabase();
};

void main();
