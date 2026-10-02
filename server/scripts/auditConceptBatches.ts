import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { QuestionConcept } from '../src/models/QuestionConcept';

const main = async () => {
  await connectDatabase();
  for (const slug of ['pennant-technologies', 'siemens']) {
    const rows = await QuestionConcept.find({ companySlug: slug, status: 'active' }).lean();
    const byPrefix = new Map<string, number>();
    rows.forEach((r) => {
      const prefix = String(r._id).slice(0, 8);
      byPrefix.set(prefix, (byPrefix.get(prefix) || 0) + 1);
    });
    console.log(`\n${slug} active=${rows.length}`);
    [...byPrefix.entries()].sort().forEach(([prefix, count]) => console.log(`  ${prefix}: ${count}`));
    const edited = rows.filter((r) => new Date(r.updatedAt).getTime() - new Date(r.createdAt).getTime() > 60000);
    console.log(`  edited (>1m after create): ${edited.length}`);
    edited.forEach((r) => console.log(`    ${String(r._id).slice(0, 8)} ${r.category} ${(r.conceptLabel || '').slice(0, 55)}`));
  }
  await disconnectDatabase();
};

void main();
