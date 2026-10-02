import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { QuestionConcept } from '../src/models/QuestionConcept';

const slugs = process.argv.slice(2).filter((arg) => !arg.endsWith('.ts'));

const main = async () => {
  await connectDatabase();
  for (const slug of slugs) {
    const rows = await QuestionConcept.find({ companySlug: slug, status: 'pending_review' })
      .select('category conceptLabel specificity genre')
      .lean();
    const coding = rows.filter((row) => row.category === 'Coding');
    console.log(`\n${slug}: ${rows.length} pending, genre=${rows[0]?.genre || 'n/a'}, Coding=${coding.length}`);
    rows.slice(0, 8).forEach((row) => {
      console.log(`  [${row.category}/${row.specificity}] ${row.conceptLabel}`);
    });
  }
  await disconnectDatabase();
};

void main();
