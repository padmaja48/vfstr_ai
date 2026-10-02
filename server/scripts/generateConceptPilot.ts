/**
 * Run the 5-company pilot concept generation batch (knowledge-recall, no web scraping).
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/generateConceptPilot.ts
 */

import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { createConceptGenerationBatch } from '../src/services/conceptGenerationQueue.service';
import { getReviewQueueGrouped } from '../src/services/questionConcept.service';
import { PILOT_BATCH_SLUGS } from '../src/data/companyConceptCatalog';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const main = async () => {
  await connectDatabase();

  console.log('Pilot companies:', PILOT_BATCH_SLUGS.join(', '));
  const batch = await createConceptGenerationBatch({ scope: 'pilot' });
  console.log(`Batch ${batch.id} started (${batch.status}). Waiting for completion…`);

  let lastDone = -1;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await sleep(3000);
    const { getConceptGenerationBatch } = await import('../src/services/conceptGenerationQueue.service');
    const status = await getConceptGenerationBatch(batch.id);
    if (!status) break;
    const done = status.completedCompanies + (status.failedCompanies?.length ?? 0);
    if (done !== lastDone) {
      console.log(
        `Progress: ${status.completedCompanies}/${status.totalCompanies} ok, `
        + `${status.failedCompanies?.length ?? 0} failed · status=${status.status}`,
      );
      lastDone = done;
    }
    if (['completed', 'partial', 'failed', 'cancelled'].includes(status.status)) {
      if (status.failedCompanies?.length) {
        status.failedCompanies.forEach((failure) => {
          console.error(`  FAILED ${failure.companyLabel}: ${failure.error}`);
        });
      }
      break;
    }
  }

  const review = await getReviewQueueGrouped({ batchId: batch.id });
  console.log(`\nReview queue: ${review.totalPending} pending concepts across ${review.groups.length} companies`);
  review.groups.forEach((group) => {
    console.log(`  ${group.companySlug}: ${group.concepts.length} concepts (${group.genre}, tier ${group.tier})`);
  });

  await disconnectDatabase();
};

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
