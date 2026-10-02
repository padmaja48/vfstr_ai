import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { QuestionConcept } from '../src/models/QuestionConcept';

const main = async () => {
  await connectDatabase();
  const badSlugs = await QuestionConcept.find({
    companySlug: { $in: ['undefined', 'null', '', 'Pennant Technologies', 'Siemens'] },
  }).lean();
  console.log('bad slug records:', badSlugs.length);
  badSlugs.forEach((r) => console.log(String(r._id), r.companySlug, r.category, r.status, (r.conceptLabel || '').slice(0, 60)));

  const missingCreatedBy = await QuestionConcept.find({ createdBy: { $exists: false } }).lean();
  console.log('missing createdBy:', missingCreatedBy.length);

  await disconnectDatabase();
};

void main();
