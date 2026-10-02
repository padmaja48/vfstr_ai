/** Re-run generation for Siemens + Pennant only. */
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import {
  createConceptGenerationBatch,
  getConceptGenerationBatch,
} from '../src/services/conceptGenerationQueue.service';
import { getReviewQueueGrouped } from '../src/services/questionConcept.service';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const main = async () => {
  await connectDatabase();
  const batch = await createConceptGenerationBatch({
    scope: 'custom',
    slugs: ['siemens', 'pennant-technologies'],
  });
  console.log('Batch', batch.id, 'status', batch.status);

  for (let i = 0; i < 30; i += 1) {
    await sleep(2000);
    const status = await getConceptGenerationBatch(batch.id);
    if (!status) break;
    console.log(
      `  ${status.completedCompanies}/${status.totalCompanies} ok, `
      + `${status.failedCompanies?.length ?? 0} failed, status=${status.status}`,
    );
    status.failedCompanies?.forEach((f) => console.log('    FAIL:', f.companyLabel, '-', f.error));
    if (['completed', 'partial', 'failed'].includes(status.status)) break;
  }

  const review = await getReviewQueueGrouped({ batchId: batch.id });
  console.log('Review queue:', review.groups.map((g) => `${g.companySlug}(${g.concepts.length})`).join(', '));

  await disconnectDatabase();
};

void main();
