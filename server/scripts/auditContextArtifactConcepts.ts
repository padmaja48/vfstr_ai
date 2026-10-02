/**
 * Audit concepts for broken "(Company context N)" fallback artifacts.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/auditContextArtifactConcepts.ts
 *   npx ts-node --transpile-only scripts/auditContextArtifactConcepts.ts --batch-id=<id>
 */
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { QuestionConcept } from '../src/models/QuestionConcept';
import { ConceptGenerationBatch } from '../src/models/ConceptGenerationBatch';
import { isBrokenFallbackConceptLabel } from '../src/services/conceptGenreDifficulty';

const batchIdArg = process.argv.find((arg) => arg.startsWith('--batch-id='))?.split('=')[1]?.trim();

const main = async () => {
  await connectDatabase();

  let batchIds: string[] = [];
  if (batchIdArg) {
    batchIds = [batchIdArg];
  } else {
    const fullBatches = await ConceptGenerationBatch.find({ scope: 'full' })
      .sort({ createdAt: -1 })
      .select('_id')
      .lean();
    batchIds = fullBatches.map((row) => String(row._id));
  }

  const filter: Record<string, unknown> = {};
  if (batchIds.length) {
    filter.batchId = { $in: batchIds };
  }

  const rows = await QuestionConcept.find(filter).select('companySlug conceptLabel status batchId').lean();

  type CompanyStats = {
    pendingBroken: number;
    pendingTotal: number;
    discardedBroken: number;
    samples: string[];
  };

  const byCompany = new Map<string, CompanyStats>();

  for (const row of rows) {
    const slug = String(row.companySlug);
    const stats = byCompany.get(slug) ?? {
      pendingBroken: 0,
      pendingTotal: 0,
      discardedBroken: 0,
      samples: [],
    };

    if (row.status === 'pending_review') {
      stats.pendingTotal += 1;
      if (isBrokenFallbackConceptLabel(String(row.conceptLabel))) {
        stats.pendingBroken += 1;
        if (stats.samples.length < 2) stats.samples.push(String(row.conceptLabel));
      }
    } else if (row.status === 'discarded' && isBrokenFallbackConceptLabel(String(row.conceptLabel))) {
      stats.discardedBroken += 1;
    }

    byCompany.set(slug, stats);
  }

  const pendingAffected = [...byCompany.entries()]
    .filter(([, stats]) => stats.pendingBroken > 0)
    .sort((left, right) => left[0].localeCompare(right[0]));

  const discardedOnly = [...byCompany.entries()]
    .filter(([slug, stats]) => stats.discardedBroken > 0 && stats.pendingBroken === 0)
    .sort((left, right) => left[0].localeCompare(right[0]));

  console.log(`Scanned ${rows.length} concept(s) across ${batchIds.length || 'all'} full batch(es)\n`);

  console.log(`Pending review — broken (needs action): ${pendingAffected.length} companies`);
  if (!pendingAffected.length) {
    console.log('  none');
  } else {
    for (const [slug, stats] of pendingAffected) {
      console.log(`  ${slug}: ${stats.pendingBroken}/${stats.pendingTotal} broken pending`);
      stats.samples.forEach((sample) => console.log(`    e.g. ${sample}`));
    }
    console.log('\n--- Pending broken slug list ---');
    console.log(pendingAffected.map(([slug]) => slug).join(', '));
  }

  console.log(`\nDiscarded broken (already cleaned up): ${discardedOnly.length} companies`);
  if (discardedOnly.length) {
    console.log(discardedOnly.map(([slug, stats]) => `${slug} (${stats.discardedBroken})`).join(', '));
  }

  const cleanPendingCompanies = [...byCompany.entries()]
    .filter(([, stats]) => stats.pendingTotal > 0 && stats.pendingBroken === 0)
    .length;
  console.log(`\nClean pending_review companies in scope: ${cleanPendingCompanies}`);

  await disconnectDatabase();
};

void main();
