import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env') });
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { QuestionConcept } from '../src/models/QuestionConcept';

const main = async () => {
  await connectDatabase();
  const roles = ['data_analyst', 'frontend', 'backend', 'qa', 'hr_behavioral', 'sde'];
  for (const role of roles) {
    const rows = await QuestionConcept.find({ role, status: 'pending_review' })
      .select('category batchId conceptLabel')
      .lean();
    const byBatch = new Map<string, typeof rows>();
    rows.forEach((row) => {
      const key = String(row.batchId || 'none');
      const bucket = byBatch.get(key) ?? [];
      bucket.push(row);
      byBatch.set(key, bucket);
    });
    console.log(`\n${role} pending=${rows.length}`);
    for (const [batchId, arr] of byBatch.entries()) {
      const cats: Record<string, number> = {};
      arr.forEach((row) => {
        cats[String(row.category)] = (cats[String(row.category)] ?? 0) + 1;
      });
      console.log(`  batch ${batchId} (${batchId.slice(-6)}) count=${arr.length}`, cats);
      arr.slice(0, 3).forEach((row) => {
        console.log(`    ${row.category}: ${String(row.conceptLabel).slice(0, 90)}`);
      });
      const technical = arr.filter((row) => row.category === 'Technical').slice(0, 2);
      if (technical.length) {
        console.log('    Technical samples:');
        technical.forEach((row) => console.log(`      - ${String(row.conceptLabel).slice(0, 95)}`));
      }
    }
  }
  await disconnectDatabase();
};

void main();
