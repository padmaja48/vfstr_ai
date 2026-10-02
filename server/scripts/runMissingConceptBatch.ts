/**
 * Generate concepts for companies in the full batch catalog that have no active/pending pool yet.
 * Stops cleanly when Groq daily quota is exhausted (429 after retries).
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/runMissingConceptBatch.ts --dry-run
 *   npx ts-node --transpile-only scripts/runMissingConceptBatch.ts --apply --limit 20
 */
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { getCatalogCompanies, getCatalogEntry } from '../src/data/companyConceptCatalog';
import { ConceptGenerationBatch } from '../src/models/ConceptGenerationBatch';
import { QuestionConcept } from '../src/models/QuestionConcept';
import { processConceptGenerationJob } from '../src/services/conceptGenerationQueue.service';
import { isBrokenFallbackConceptLabel } from '../src/services/conceptGenreDifficulty';

const apply = process.argv.includes('--apply');
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const limitFlagIndex = process.argv.indexOf('--limit');
const hasLimitFlag = limitArg != null || limitFlagIndex >= 0;
const limit = hasLimitFlag
  ? Number(limitArg?.split('=')[1] ?? process.argv[limitFlagIndex + 1]) || 999
  : 999;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const INTER_COMPANY_DELAY_MS = Number(process.env.CONCEPT_GEN_DELAY_MS || 90000);

const isQuotaExhaustedError = (message: string) =>
  /rate limit exhausted/i.test(message) || /429/.test(message);

const main = async () => {
  await connectDatabase();

  const full = getCatalogCompanies({ scope: 'full', limit: 100 });
  const slugs = full.map((entry) => entry.slug);
  const withConcepts = await QuestionConcept.distinct('companySlug', {
    companySlug: { $in: slugs },
    status: { $in: ['active', 'pending_review'] },
  });
  const have = new Set(withConcepts.map(String));
  const missing = slugs.filter((slug) => !have.has(slug)).slice(0, limit);

  console.log(`Full batch catalog: ${slugs.length} companies`);
  console.log(`Already have active/pending concepts: ${have.size}`);
  console.log(`Missing (no active/pending): ${slugs.length - have.size}`);
  console.log(`This run: ${missing.length} companies (limit ${limit})`);
  console.log(`Inter-company delay: ${INTER_COMPANY_DELAY_MS}ms\n`);

  if (!missing.length) {
    console.log('Nothing to generate.');
    await disconnectDatabase();
    return;
  }

  missing.forEach((slug, index) => console.log(`  ${index + 1}. ${slug}`));

  if (!apply) {
    console.log('\nRe-run with --apply to start generation.');
    await disconnectDatabase();
    return;
  }

  const batch = await ConceptGenerationBatch.create({
    scope: 'custom',
    status: 'running',
    totalCompanies: missing.length,
    completedCompanies: 0,
    failedCompanies: [],
    companySlugs: missing,
    startedAt: new Date(),
  });
  const batchId = String(batch._id);
  console.log(`\nBatch ${batchId} — starting sequential generation…\n`);

  const succeeded: string[] = [];
  let stoppedForQuota = false;

  for (let index = 0; index < missing.length; index += 1) {
    const companySlug = missing[index];
    const label = getCatalogEntry(companySlug)?.label ?? companySlug;
    console.log(`[${index + 1}/${missing.length}] ${label} (${companySlug})`);
    const started = Date.now();

    const batchBefore = await ConceptGenerationBatch.findById(batch._id).lean();
    await processConceptGenerationJob({ batchId, companySlug });
    const batchAfter = await ConceptGenerationBatch.findById(batch._id).lean();
    const failure = batchAfter?.failedCompanies?.find((row) => row.companySlug === companySlug);
    const failureMessage = failure?.error ?? '';

    const rows = await QuestionConcept.find({
      companySlug,
      status: 'pending_review',
      batchId: batch._id,
    })
      .select('conceptLabel')
      .lean();
    const broken = rows.filter((row) =>
      isBrokenFallbackConceptLabel(String(row.conceptLabel)),
    ).length;
    const elapsedSec = Math.round((Date.now() - started) / 1000);

    if (failure && isQuotaExhaustedError(failureMessage)) {
      console.log(`  -> QUOTA EXHAUSTED (${elapsedSec}s): ${failureMessage}`);
      console.log('\nStopping batch — Groq daily quota likely exhausted. Remaining companies deferred.');
      stoppedForQuota = true;
      break;
    }

    if (failure) {
      console.log(`  -> FAILED (${elapsedSec}s): ${failureMessage}`);
    } else if (rows.length > 0 && broken === 0) {
      succeeded.push(label);
      console.log(`  -> OK: ${rows.length} pending_review, 0 artifacts (${elapsedSec}s)`);
    } else if (rows.length > 0) {
      console.log(`  -> WARN: ${rows.length} pending_review, ${broken} artifact labels (${elapsedSec}s)`);
    } else {
      const wasSuccess = (batchAfter?.completedCompanies ?? 0) > (batchBefore?.completedCompanies ?? 0);
      if (wasSuccess) {
        succeeded.push(label);
        console.log(`  -> OK (${elapsedSec}s)`);
      } else {
        console.log(`  -> No pending_review rows saved (${elapsedSec}s)`);
      }
    }

    if (index < missing.length - 1 && !stoppedForQuota) {
      console.log(`  waiting ${INTER_COMPANY_DELAY_MS / 1000}s before next company…`);
      await sleep(INTER_COMPANY_DELAY_MS);
    }
  }

  const refreshed = await ConceptGenerationBatch.findById(batch._id);
  if (refreshed) {
    const attempted = refreshed.completedCompanies + refreshed.failedCompanies.length;
    if (stoppedForQuota && attempted < refreshed.totalCompanies) {
      refreshed.status = refreshed.completedCompanies ? 'partial' : 'failed';
    } else {
      refreshed.status = refreshed.failedCompanies.length
        ? refreshed.completedCompanies ? 'partial' : 'failed'
        : 'completed';
    }
    refreshed.completedAt = new Date();
    await refreshed.save();

    const remainingSlugs = missing.slice(attempted);
    console.log(`\n=== Batch summary (${batchId}) ===`);
    console.log(`Status: ${refreshed.status}${stoppedForQuota ? ' (stopped for quota)' : ''}`);
    console.log(`Succeeded: ${refreshed.completedCompanies}/${attempted} attempted (${refreshed.totalCompanies} queued)`);
    console.log(`\nCompleted this run (${succeeded.length}):`);
    succeeded.forEach((name, index) => console.log(`  ${index + 1}. ${name}`));
    if (remainingSlugs.length) {
      console.log(`\nRemaining for a future run (${remainingSlugs.length}):`);
      remainingSlugs.forEach((slug, index) => {
        const entry = getCatalogEntry(slug);
        console.log(`  ${index + 1}. ${entry?.label ?? slug}`);
      });
    }
    refreshed.failedCompanies?.forEach((failure) => {
      console.log(`  FAILED ${failure.companySlug}: ${failure.error}`);
    });

    const artifactRows = await QuestionConcept.find({
      batchId: batch._id,
      status: 'pending_review',
    })
      .select('companySlug conceptLabel')
      .lean();
    const artifactCount = artifactRows.filter((row) =>
      isBrokenFallbackConceptLabel(String(row.conceptLabel)),
    ).length;
    console.log(`\nArtifact audit (this batch): ${artifactCount} broken fallback labels in pending_review`);
  }

  await disconnectDatabase();
};

void main().catch(async (error) => {
  console.error(error);
  await disconnectDatabase();
  process.exit(1);
});
