/**
 * Restore original canonical-batch Technical rows for backend/qa after mistaken full-category discard.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/restoreRoleTechnicalConcepts.ts --dry-run
 *   npx ts-node --transpile-only scripts/restoreRoleTechnicalConcepts.ts --apply
 */
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { QuestionConcept } from '../src/models/QuestionConcept';
import type { RoleConceptKey } from '../src/data/roleConceptCatalog';

const CANONICAL_BATCH_SUFFIX = '1f59ff';
const ROLES: RoleConceptKey[] = ['backend', 'qa'];

const main = async () => {
  const apply = process.argv.includes('--apply');
  await connectDatabase();

  const canonicalCandidates = await QuestionConcept.distinct('batchId', {
    role: { $in: ROLES },
    status: { $in: ['pending_review', 'discarded'] },
  });
  const canonicalBatchId = canonicalCandidates.find((id) => String(id).endsWith(CANONICAL_BATCH_SUFFIX));

  for (const role of ROLES) {
    const pendingTechnical = await QuestionConcept.find({
      role,
      status: 'pending_review',
      category: 'Technical',
    }).lean();
    const discardedTechnical = await QuestionConcept.find({
      role,
      status: 'discarded',
      category: 'Technical',
      ...(canonicalBatchId ? { batchId: canonicalBatchId } : {}),
    }).lean();

    console.log(`\n${role}:`);
    console.log(`  pending Technical: ${pendingTechnical.length}`);
    console.log(`  restorable discarded Technical: ${discardedTechnical.length}`);
    if (discardedTechnical[0]) {
      console.log(`  sample restore: ${String(discardedTechnical[0].conceptLabel).slice(0, 90)}`);
    }
    if (pendingTechnical[0]) {
      console.log(`  sample replace: ${String(pendingTechnical[0].conceptLabel).slice(0, 90)}`);
    }

    if (!apply) continue;

    if (pendingTechnical.length) {
      await QuestionConcept.updateMany(
        { _id: { $in: pendingTechnical.map((row) => row._id) } },
        { $set: { status: 'discarded' } },
      );
    }
    if (discardedTechnical.length) {
      await QuestionConcept.updateMany(
        { _id: { $in: discardedTechnical.map((row) => row._id) } },
        { $set: { status: 'pending_review' } },
      );
    }
    const after = await QuestionConcept.countDocuments({ role, status: 'pending_review' });
    console.log(`  -> pending_review total after restore: ${after}`);
  }

  if (!apply) {
    console.log('\nRe-run with --apply to restore original Technical rows.');
  }

  await disconnectDatabase();
};

void main();
