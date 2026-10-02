/**
 * Restore approved pilot concept sets to active using known-good batch id prefixes.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/restoreApprovedPilotConcepts.ts
 *   npx ts-node --transpile-only scripts/restoreApprovedPilotConcepts.ts --apply
 */
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { restoreApprovedPilotConcepts } from '../src/services/approvedPilotConceptRestore.service';

const main = async () => {
  const apply = process.argv.includes('--apply');
  await connectDatabase();

  console.log(`Mode: ${apply ? 'APPLY' : 'dry run'}\n`);
  const report = await restoreApprovedPilotConcepts(apply);

  for (const row of report.companies) {
    console.log(`${row.companySlug}:`);
    console.log(`  restore prefix ${row.prefix}: ${row.restoreCount} rows (expected ${row.expected})`);
    console.log(`  current statuses: ${row.priorStatuses.join(', ') || 'none'}`);
    if (row.wrongActiveArchivedCount) {
      console.log(`  ${apply ? 'archived' : 'would archive'} ${row.wrongActiveArchivedCount} wrongly-active rows from other batches`);
    }
    if (apply && row.activeAfter != null) {
      console.log(`  -> active now: ${row.activeAfter}`);
    }
  }

  if (!apply) {
    console.log('\nRe-run with --apply to restore.');
  } else {
    console.log(`\nTOTAL active (pilot): ${report.totalActive}`);
  }

  await disconnectDatabase();
};

void main();
