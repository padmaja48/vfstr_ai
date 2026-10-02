import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { QuestionConcept } from '../src/models/QuestionConcept';

const main = async () => {
  await connectDatabase();
  const before: Record<string, number> = {};
  for (const slug of ['amazon', 'tcs', 'razorpay']) {
    before[slug] = await QuestionConcept.countDocuments({ companySlug: slug, status: 'active' });
    console.log(`BEFORE ${slug}: ${before[slug]} active`);
  }
  await disconnectDatabase();
  return before;
};

void main();
