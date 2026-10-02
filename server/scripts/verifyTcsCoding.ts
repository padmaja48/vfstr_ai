import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { QuestionConcept } from '../src/models/QuestionConcept';

const main = async () => {
  await connectDatabase();
  const tcsCoding = await QuestionConcept.find({
    companySlug: 'tcs',
    status: 'active',
    category: 'Coding',
  }).lean();
  console.log('TCS active Coding concepts:');
  tcsCoding.forEach((r) => console.log(`  ${r.conceptLabel}`));
  await disconnectDatabase();
};

void main();
