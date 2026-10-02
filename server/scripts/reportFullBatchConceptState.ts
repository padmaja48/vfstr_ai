/**
 * Report full-batch concept generation state + probe Groq quota.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/reportFullBatchConceptState.ts
 */
import dotenv from 'dotenv';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import {
  getCatalogCompanies,
  getCatalogEntry,
  PILOT_BATCH_SLUGS,
} from '../src/data/companyConceptCatalog';
import { QuestionConcept } from '../src/models/QuestionConcept';

dotenv.config();

const main = async () => {
  await connectDatabase();

  const full = getCatalogCompanies({ scope: 'full', limit: 100 });
  const slugs = full.map((entry) => entry.slug);

  const activeSlugs = await QuestionConcept.distinct('companySlug', {
    companySlug: { $in: slugs },
    status: 'active',
  });
  const pendingSlugs = await QuestionConcept.distinct('companySlug', {
    companySlug: { $in: slugs },
    status: 'pending_review',
  });
  const active = new Set(activeSlugs.map(String));
  const pending = new Set(pendingSlugs.map(String));

  const needGeneration = slugs.filter((slug) => !active.has(slug) && !pending.has(slug));
  const awaitingReview = slugs.filter((slug) => !active.has(slug) && pending.has(slug));

  console.log('=== Full batch concept state ===');
  console.log(`Catalog (excludes ${PILOT_BATCH_SLUGS.length} pilots): ${slugs.length}`);
  console.log(`Active concept pools: ${active.size}`);
  console.log(`Pending review (generated, not approved): ${awaitingReview.length}`);
  console.log(`Need generation (no active/pending): ${needGeneration.length}\n`);

  console.log('--- Active ---');
  [...active].sort().forEach((slug) => {
    const entry = getCatalogEntry(slug);
    console.log(`  ${slug} | ${entry?.genre ?? '?'} | ${entry?.label ?? slug}`);
  });

  console.log('\n--- Pending review ---');
  awaitingReview.sort().forEach((slug) => {
    const entry = getCatalogEntry(slug);
    console.log(`  ${slug} | ${entry?.genre ?? '?'} | ${entry?.label ?? slug}`);
  });

  console.log('\n--- Need generation ---');
  needGeneration.forEach((slug, index) => {
    const entry = getCatalogEntry(slug);
    console.log(`  ${index + 1}. ${slug} | ${entry?.genre ?? '?'} | ${entry?.label ?? slug}`);
  });

  for (const slug of ['mckinsey-and-company', 'bain-and-company']) {
    const entry = getCatalogEntry(slug);
    const activeCount = await QuestionConcept.countDocuments({ companySlug: slug, status: 'active' });
    const pendingCount = await QuestionConcept.countDocuments({ companySlug: slug, status: 'pending_review' });
    console.log(`\n--- ${entry?.label ?? slug} ---`);
    console.log(`  genre: ${entry?.genre}`);
    console.log(`  active: ${activeCount}, pending_review: ${pendingCount}`);
  }

  const key = process.env.GROQ_API_KEY;
  if (key) {
    const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply ok' }],
        max_tokens: 5,
        temperature: 0,
      }),
    });
    console.log('\n=== Groq quota probe ===');
    console.log('status', res.status);
    for (const h of [
      'retry-after',
      'x-ratelimit-limit-tokens',
      'x-ratelimit-limit-requests',
      'x-ratelimit-remaining-tokens',
      'x-ratelimit-remaining-requests',
      'x-ratelimit-reset-tokens',
      'x-ratelimit-reset-requests',
    ]) {
      console.log(`${h}: ${res.headers.get(h)}`);
    }
  } else {
    console.log('\nGROQ_API_KEY not set — skipped quota probe.');
  }

  await disconnectDatabase();
};

void main().catch(async (error) => {
  console.error(error);
  await disconnectDatabase();
  process.exit(1);
});
