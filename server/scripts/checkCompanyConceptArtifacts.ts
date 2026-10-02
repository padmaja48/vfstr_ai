/**
 * Quick artifact + count check for specific companies.
 * Usage: npx ts-node --transpile-only scripts/checkCompanyConceptArtifacts.ts crowdstrike flipkart
 */
import dotenv from 'dotenv';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { QuestionConcept } from '../src/models/QuestionConcept';
import { getCatalogEntry } from '../src/data/companyConceptCatalog';
import { isBrokenFallbackConceptLabel } from '../src/services/conceptGenreDifficulty';

dotenv.config();

const slugs = process.argv.slice(2).filter((arg) => !arg.endsWith('.ts'));

const main = async () => {
  await connectDatabase();

  for (const slug of slugs) {
    const entry = getCatalogEntry(slug);
    const rows = await QuestionConcept.find({ companySlug: slug })
      .select('conceptLabel status genre batchId')
      .lean();

    const active = rows.filter((row) => row.status === 'active');
    const pending = rows.filter((row) => row.status === 'pending_review');
    const discarded = rows.filter((row) => row.status === 'discarded');
    const live = [...active, ...pending];
    const broken = live.filter((row) => isBrokenFallbackConceptLabel(String(row.conceptLabel)));
    const contextN = live.filter((row) => /\(context\s+\d+\)/i.test(String(row.conceptLabel)));

    console.log(`\n${entry?.label ?? slug} (${slug})`);
    console.log(`  catalog genre: ${entry?.genre ?? 'n/a'}`);
    console.log(`  stored genre:  ${live[0]?.genre ?? 'n/a'}`);
    console.log(`  active: ${active.length} | pending_review: ${pending.length} | discarded: ${discarded.length}`);
    console.log(`  batchId: ${live[0]?.batchId ? String(live[0].batchId) : 'n/a'}`);
    console.log(`  broken fallback labels: ${broken.length}`);
    console.log(`  (context N) text matches: ${contextN.length}`);
    if (broken.length) {
      broken.slice(0, 3).forEach((row) => console.log(`    e.g. ${row.conceptLabel}`));
    }
  }

  await disconnectDatabase();
};

void main().catch(async (error) => {
  console.error(error);
  await disconnectDatabase();
  process.exit(1);
});
