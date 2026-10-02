import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { ConceptGenerationBatch } from '../src/models/ConceptGenerationBatch';

const main = async () => {
  await connectDatabase();
  const running = await ConceptGenerationBatch.find({
    status: { $in: ['queued', 'running'] },
  })
    .sort({ updatedAt: -1 })
    .lean();
  console.log('active_batches', running.length);
  running.forEach((batch) => {
    console.log(
      `${batch._id} | ${batch.status} | ${batch.completedCompanies}/${batch.totalCompanies} | ${(batch.companySlugs || []).join(', ')}`,
    );
  });
  await disconnectDatabase();
};

void main();
