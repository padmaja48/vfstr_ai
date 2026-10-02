/**
 * Pre-fetch and cache web-researched interview questions for all supported companies.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/prewarmCompanyQuestions.ts
 *   npx ts-node --transpile-only scripts/prewarmCompanyQuestions.ts accenture google
 */

import { COMPANY_LABELS } from '../src/services/companyQuestions.service';
import { ensureCompanyQuestions } from '../src/services/companyQuestionResearch.service';

const DEFAULT_ROLE = 'Software Engineer';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const main = async () => {
  const requested = process.argv.slice(2);
  const slugs = requested.length ? requested : Object.keys(COMPANY_LABELS);
  let success = 0;
  let empty = 0;

  for (const slug of slugs) {
    const label = COMPANY_LABELS[slug] ?? slug;
    process.stdout.write(`Fetching ${label}... `);

    const result = await ensureCompanyQuestions({
      companyName: slug,
      companyLabel: label,
      role: DEFAULT_ROLE,
      experienceLevel: 'fresher',
      forceRefresh: false,
    }).catch(() => ({ questions: [], mode: 'generic' as const, companyLabel: label, fromCache: false }));

    if (result.questions.length) {
      success += 1;
      console.log(`${result.questions.length} questions (${result.fromCache ? 'cache' : 'web'})`);
    } else {
      empty += 1;
      console.log('no questions found');
    }

    await sleep(1200);
  }

  console.log(`Done. ${success} companies populated, ${empty} empty.`);
};

void main();
