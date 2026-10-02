/**
 * Discard broken fallback concepts and re-queue AI generation for affected companies.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/regenerateBrokenFallbackConcepts.ts --dry-run
 *   npx ts-node --transpile-only scripts/regenerateBrokenFallbackConcepts.ts --apply
 *   npx ts-node --transpile-only scripts/regenerateBrokenFallbackConcepts.ts --apply adobe flipkart
 *   npx ts-node --transpile-only scripts/regenerateBrokenFallbackConcepts.ts --apply --replace mckinsey-and-company bain-and-company
 */
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { getCatalogEntry } from '../src/data/companyConceptCatalog';
import { ConceptGenerationBatch } from '../src/models/ConceptGenerationBatch';
import { QuestionConcept } from '../src/models/QuestionConcept';
import {
  processConceptGenerationJob,
} from '../src/services/conceptGenerationQueue.service';
import { isBrokenFallbackConceptLabel } from '../src/services/conceptGenreDifficulty';

const apply = process.argv.includes('--apply');
const replaceExisting = process.argv.includes('--replace');
const explicitSlugs = process.argv
  .slice(2)
  .filter((arg) => !arg.startsWith('--') && !arg.endsWith('.ts'));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const INTER_COMPANY_DELAY_MS = Number(process.env.CONCEPT_GEN_DELAY_MS || 12000);

const main = async () => {
  await connectDatabase();

  const pendingRows = await QuestionConcept.find({ status: 'pending_review' })
    .select('companySlug conceptLabel batchId')
    .lean();

  const brokenRows = pendingRows.filter((row) =>
    isBrokenFallbackConceptLabel(String(row.conceptLabel)),
  );

  let slugs = explicitSlugs.length
    ? explicitSlugs
    : [...new Set(brokenRows.map((row) => String(row.companySlug)))];

  slugs = slugs.filter((slug) => getCatalogEntry(slug));

  console.log(`Mode: ${apply ? 'APPLY' : 'dry run'}`);
  console.log(`Companies to regenerate: ${slugs.length}\n`);

  for (const slug of slugs) {
    const pending = pendingRows.filter((row) => String(row.companySlug) === slug);
    const broken = pending.filter((row) => isBrokenFallbackConceptLabel(String(row.conceptLabel)));
    const good = pending.length - broken.length;

    console.log(`${slug}: ${broken.length} broken pending, ${good} good pending (${pending.length} total pending)`);

    if (apply && broken.length) {
      await QuestionConcept.updateMany(
        { _id: { $in: broken.map((row) => row._id) } },
        { $set: { status: 'discarded' } },
      );
      console.log(`  -> discarded ${broken.length} broken concept(s)`);
    }

    if (apply && replaceExisting && explicitSlugs.includes(slug)) {
      const archived = await QuestionConcept.updateMany(
        { companySlug: slug, status: 'active' },
        { $set: { status: 'archived' } },
      );
      const discarded = await QuestionConcept.updateMany(
        { companySlug: slug, status: 'pending_review' },
        { $set: { status: 'discarded' } },
      );
      console.log(
        `  -> replace: archived ${archived.modifiedCount} active, discarded ${discarded.modifiedCount} pending`,
      );
    }
  }

  if (apply && slugs.length) {
    const batch = await ConceptGenerationBatch.create({
      scope: 'custom',
      status: 'running',
      totalCompanies: slugs.length,
      completedCompanies: 0,
      failedCompanies: [],
      companySlugs: slugs,
    });
    const batchId = String(batch._id);
    console.log(`\nRegeneration batch ${batchId} — processing ${slugs.length} companies sequentially…\n`);

    for (let index = 0; index < slugs.length; index += 1) {
      const companySlug = slugs[index];
      console.log(`[${index + 1}/${slugs.length}] ${companySlug}`);
      await processConceptGenerationJob({ batchId, companySlug });
      const pending = await QuestionConcept.countDocuments({
        companySlug,
        status: 'pending_review',
        batchId: batch._id,
      });
      const broken = await QuestionConcept.countDocuments({
        companySlug,
        status: 'pending_review',
        batchId: batch._id,
        conceptLabel: { $regex: /\(context\s+\d+\)/i },
      });
      console.log(`  -> ${pending} pending_review (${broken} with context artifact)`);
      if (index < slugs.length - 1) {
        await sleep(INTER_COMPANY_DELAY_MS);
      }
    }

    const refreshed = await ConceptGenerationBatch.findById(batch._id);
    if (refreshed) {
      refreshed.status = refreshed.failedCompanies.length
        ? refreshed.completedCompanies ? 'partial' : 'failed'
        : 'completed';
      refreshed.completedAt = new Date();
      await refreshed.save();
    }
    console.log(`\nBatch finished: ${refreshed?.completedCompanies}/${refreshed?.totalCompanies} succeeded`);
    if (refreshed?.failedCompanies?.length) {
      refreshed.failedCompanies.forEach((failure) => {
        console.log(`  FAILED ${failure.companySlug}: ${failure.error}`);
      });
    }
  } else if (!apply) {
    console.log('\nRe-run with --apply to discard broken rows and regenerate via AI.');
  }

  await disconnectDatabase();
};

void main().catch(async (error) => {
  console.error(error);
  await disconnectDatabase();
  process.exit(1);
});
