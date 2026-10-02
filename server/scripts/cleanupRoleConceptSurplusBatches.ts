/**
 * Archive surplus role-concept regeneration batches (split-batch cleanup).
 *
 * Keeps pending_review rows on the canonical 7-role batch (suffix 1f59ff).
 * Archives pending_review rows from regeneration batches c7e693 / e588f9.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/cleanupRoleConceptSurplusBatches.ts
 *   npx ts-node --transpile-only scripts/cleanupRoleConceptSurplusBatches.ts --apply
 */
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { QuestionConcept } from '../src/models/QuestionConcept';
import type { RoleConceptKey } from '../src/data/roleConceptCatalog';

const CANONICAL_BATCH_SUFFIX = '1f59ff';
const SURPLUS_BATCH_SUFFIXES = ['c7e693', 'e588f9'];
const AFFECTED_ROLES: RoleConceptKey[] = [
  'data_analyst',
  'frontend',
  'backend',
  'qa',
  'hr_behavioral',
];

const batchMatchesSuffix = (batchId: unknown, suffix: string) =>
  String(batchId || '').endsWith(suffix);

const main = async () => {
  const apply = process.argv.includes('--apply');
  await connectDatabase();

  const canonicalCandidates = await QuestionConcept.distinct('batchId', {
    role: { $in: AFFECTED_ROLES },
    status: 'pending_review',
  });
  const canonicalBatchId = canonicalCandidates.find((id) => batchMatchesSuffix(String(id), CANONICAL_BATCH_SUFFIX));
  console.log(`Mode: ${apply ? 'APPLY' : 'dry run'}`);
  console.log(`Canonical batch: ${canonicalBatchId ? String(canonicalBatchId) : 'not found'} (${canonicalBatchId ? String(canonicalBatchId).slice(-6) : 'n/a'})\n`);

  for (const role of AFFECTED_ROLES) {
    const rows = await QuestionConcept.find({ role, status: 'pending_review' }).lean();
    const surplus = rows.filter((row) =>
      SURPLUS_BATCH_SUFFIXES.some((suffix) => batchMatchesSuffix(row.batchId, suffix)),
    );
    const canonical = rows.filter((row) => canonicalBatchId && String(row.batchId) === String(canonicalBatchId));
    console.log(`${role}: canonical=${canonical.length}, surplus=${surplus.length}, total=${rows.length}`);

    if (surplus.length) {
      surplus.slice(0, 3).forEach((row) => {
        console.log(`  ARCHIVE [${row.category}] ${String(row.conceptLabel).slice(0, 85)}`);
      });
      if (surplus.length > 3) console.log(`  ... and ${surplus.length - 3} more`);
    }

    if (apply && surplus.length) {
      const result = await QuestionConcept.updateMany(
        { _id: { $in: surplus.map((row) => row._id) } },
        { $set: { status: 'archived' } },
      );
      console.log(`  -> archived ${result.modifiedCount ?? 0}`);
    }
  }

  if (!apply) {
    console.log('\nRe-run with --apply to archive surplus regeneration batches.');
  }

  await disconnectDatabase();
};

void main().catch(async (error) => {
  console.error(error);
  await disconnectDatabase();
  process.exit(1);
});
