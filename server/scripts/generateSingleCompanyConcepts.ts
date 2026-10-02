/**
 * Generate and SAVE concepts for a company (with auto-archive of prior batches).
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/generateSingleCompanyConcepts.ts infosys
 *   npx ts-node --transpile-only scripts/generateSingleCompanyConcepts.ts infosys --save
 *   npx ts-node --transpile-only scripts/generateSingleCompanyConcepts.ts infosys --save-twice
 */
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { getCatalogEntry } from '../src/data/companyConceptCatalog';
import { ConceptGenerationBatch } from '../src/models/ConceptGenerationBatch';
import { QuestionConcept } from '../src/models/QuestionConcept';
import { isAdvancedItServicesCodingConcept } from '../src/services/conceptGenreDifficulty';
import {
  generateAndSaveStarterConceptsForCompany,
  generateStarterConceptSetForCompany,
} from '../src/services/questionConcept.service';

const slug = process.argv.find((arg) => !arg.startsWith('--') && arg !== process.argv[0] && arg !== process.argv[1])
  || 'infosys';
const save = process.argv.includes('--save') || process.argv.includes('--save-twice');
const saveTwice = process.argv.includes('--save-twice');

const createBatch = async (companySlug: string) => {
  const batch = await ConceptGenerationBatch.create({
    scope: 'custom',
    status: 'running',
    totalCompanies: 1,
    completedCompanies: 0,
    failedCompanies: [],
    companySlugs: [companySlug],
  });
  return String(batch._id);
};

const countByStatus = async (companySlug: string) => {
  const active = await QuestionConcept.countDocuments({ companySlug, status: 'active' });
  const pending = await QuestionConcept.countDocuments({ companySlug, status: 'pending_review' });
  const archived = await QuestionConcept.countDocuments({ companySlug, status: 'archived' });
  return { active, pending, archived };
};

const main = async () => {
  const entry = getCatalogEntry(slug);
  if (!entry) {
    console.error(`Unknown company slug: ${slug}`);
    process.exit(1);
  }

  await connectDatabase();

  if (save || saveTwice) {
    const before = await countByStatus(entry.slug);
    console.log(`Before: active=${before.active}, pending=${before.pending}, archived=${before.archived}`);

    const runSave = async (label: string) => {
      const batchId = await createBatch(entry.slug);
      console.log(`\n${label}: batch ${batchId}`);
      const result = await generateAndSaveStarterConceptsForCompany({ entry, batchId });
      console.log(`  saved ${result.count} concepts (pending_review)`);
      console.log(`  auto-archived ${result.archiveReport.archivedCount}, preserved ${result.archiveReport.preservedCount} manual edits`);
      if (result.archiveReport.preservedCount) {
        result.archiveReport.preservedConceptLabels.forEach((item) => console.log(`    preserved: ${item}`));
      }
      return { batchId, result };
    };

    await runSave('Run 1');
    if (saveTwice) {
      await runSave('Run 2');
    }

    const after = await countByStatus(entry.slug);
    console.log(`\nAfter: active=${after.active}, pending=${after.pending}, archived=${after.archived}`);
    await disconnectDatabase();
    return;
  }

  console.log(`Generating concepts for ${entry.label} (${entry.genre}, tier ${entry.tier})…\n`);
  const drafts = await generateStarterConceptSetForCompany(entry);

  const coding = drafts.filter((d) => d.category === 'Coding');
  console.log(`Total: ${drafts.length} concepts, Coding: ${coding.length}\n`);

  console.log('--- Coding concepts ---');
  coding.forEach((c, i) => {
    const advanced = isAdvancedItServicesCodingConcept(c.conceptLabel);
    console.log(`${i + 1}. ${c.conceptLabel}${advanced ? ' [ADVANCED — BAD]' : ''}`);
  });

  if (entry.genre === 'it_services') {
    const bad = coding.filter((c) => isAdvancedItServicesCodingConcept(c.conceptLabel));
    if (bad.length > 0) {
      console.error(`\nFAIL: ${bad.length} advanced Coding concept(s) for IT Services company.`);
      process.exit(1);
    }
    console.log('\nPASS: All Coding concepts are entry-level.');
  }

  await disconnectDatabase();
};

void main().catch(async (error) => {
  console.error(error);
  await disconnectDatabase();
  process.exit(1);
});
