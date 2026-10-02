/**
 * Audit concept status breakdown for pilot companies.
 */
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { QuestionConcept } from '../src/models/QuestionConcept';

const PILOT = ['amazon', 'tcs', 'razorpay', 'siemens', 'pennant-technologies'];

const main = async () => {
  await connectDatabase();

  for (const slug of PILOT) {
    const rows = await QuestionConcept.aggregate([
      { $match: { companySlug: slug } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    console.log(`\n${slug}:`);
    rows.forEach((r) => console.log(`  ${r._id}: ${r.count}`));

    const byPrefix = await QuestionConcept.aggregate([
      { $match: { companySlug: slug } },
      {
        $group: {
          _id: { status: '$status', prefix: { $substr: [{ $toString: '$_id' }, 0, 8] } },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.status': 1, '_id.prefix': 1 } },
    ]);
    byPrefix.forEach((r) => console.log(`    ${r._id.status} ${r._id.prefix}: ${r.count}`));
  }

  const totalActive = await QuestionConcept.countDocuments({ status: 'active' });
  console.log(`\nTOTAL active: ${totalActive}`);

  await disconnectDatabase();
};

void main();
