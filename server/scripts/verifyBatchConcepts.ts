/**
 * Summarize concepts saved for a generation batch.
 * Usage: npx ts-node --transpile-only scripts/verifyBatchConcepts.ts [batchId]
 */
import dotenv from 'dotenv';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { ConceptGenerationBatch } from '../src/models/ConceptGenerationBatch';
import { QuestionConcept } from '../src/models/QuestionConcept';
import { getCatalogEntry } from '../src/data/companyConceptCatalog';
import { isBrokenFallbackConceptLabel } from '../src/services/conceptGenreDifficulty';

dotenv.config();

const batchId = process.argv[2] || '6a8be1dfafe4b41fe497c048';

const main = async () => {
  await connectDatabase();
  const batch = await ConceptGenerationBatch.findById(batchId).lean();
  if (!batch) {
    console.log('Batch not found:', batchId);
    await disconnectDatabase();
    return;
  }

  const rows = await QuestionConcept.find({ batchId, status: 'pending_review' })
    .select('companySlug conceptLabel')
    .lean();

  const byCompany = new Map<string, typeof rows>();
  for (const row of rows) {
    const slug = String(row.companySlug);
    if (!byCompany.has(slug)) byCompany.set(slug, []);
    byCompany.get(slug)!.push(row);
  }

  let totalArtifacts = 0;
  console.log(`=== Batch ${batchId} ===`);
  console.log(`Status in DB: ${batch.status}`);
  console.log(`Completed counter: ${batch.completedCompanies}`);
  console.log(`Failed entries: ${batch.failedCompanies?.length ?? 0}`);
  console.log(`Companies with pending_review: ${byCompany.size}\n`);

  const sorted = [...byCompany.keys()].sort((a, b) => {
    const la = getCatalogEntry(a)?.label ?? a;
    const lb = getCatalogEntry(b)?.label ?? b;
    return la.localeCompare(lb);
  });

  sorted.forEach((slug, index) => {
    const concepts = byCompany.get(slug)!;
    const artifacts = concepts.filter((c) =>
      isBrokenFallbackConceptLabel(String(c.conceptLabel)),
    ).length;
    totalArtifacts += artifacts;
    const label = getCatalogEntry(slug)?.label ?? slug;
    console.log(`${index + 1}. ${label} | ${concepts.length} concepts | ${artifacts} artifacts`);
  });

  console.log(`\nTotal concepts saved: ${rows.length}`);
  console.log(`Total artifact labels: ${totalArtifacts}`);

  const queued = (batch.companySlugs ?? []) as string[];
  const done = new Set([...byCompany.keys()]);
  const remaining = queued.filter((slug) => !done.has(slug));
  console.log(`\nRemaining in queue (${remaining.length}):`);
  remaining.forEach((slug, index) => {
    console.log(`  ${index + 1}. ${getCatalogEntry(slug)?.label ?? slug}`);
  });

  await disconnectDatabase();
};

void main().catch(async (error) => {
  console.error(error);
  await disconnectDatabase();
  process.exit(1);
});
