/**
 * Diagnose concept generation failures for specific companies.
 * Usage: npx ts-node --transpile-only scripts/diagnoseConceptGeneration.ts siemens pennant-technologies
 */

import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { getCatalogEntry } from '../src/data/companyConceptCatalog';
import {
  generateAndSaveStarterConceptsForCompany,
  generateStarterConceptSetForCompany,
} from '../src/services/questionConcept.service';
import { ConceptGenerationBatch } from '../src/models/ConceptGenerationBatch';
import { QuestionConcept } from '../src/models/QuestionConcept';

const slugs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['siemens', 'pennant-technologies'];

const main = async () => {
  await connectDatabase();

  for (const slug of slugs) {
    const entry = getCatalogEntry(slug);
    console.log('\n===', slug, '===');
    if (!entry) {
      console.error('NOT IN CATALOG');
      continue;
    }
    console.log('Entry:', JSON.stringify(entry, null, 2));

    try {
      const drafts = await generateStarterConceptSetForCompany(entry);
      console.log(`generateStarterConceptSetForCompany: OK (${drafts.length} drafts)`);
      console.log('Sample:', drafts.slice(0, 2));
    } catch (error) {
      console.error('generateStarterConceptSetForCompany FAILED:');
      console.error(error instanceof Error ? error.stack : error);
    }

    const batch = await ConceptGenerationBatch.create({
      scope: 'custom',
      status: 'running',
      totalCompanies: 1,
      completedCompanies: 0,
      failedCompanies: [],
      companySlugs: [entry.slug],
    });

    try {
      const result = await generateAndSaveStarterConceptsForCompany({
        entry,
        batchId: String(batch._id),
      });
      console.log(`generateAndSaveStarterConceptsForCompany: OK (${result.count} saved)`);
    } catch (error) {
      console.error('generateAndSaveStarterConceptsForCompany FAILED:');
      console.error(error instanceof Error ? error.stack : error);
      if (error && typeof error === 'object' && 'errors' in error) {
        console.error('Validation errors:', (error as { errors: unknown }).errors);
      }
    }

    await QuestionConcept.deleteMany({ batchId: batch._id });
    await ConceptGenerationBatch.findByIdAndDelete(batch._id);
  }

  const recent = await ConceptGenerationBatch.find()
    .sort({ createdAt: -1 })
    .limit(3)
    .lean();
  console.log('\n=== Recent batch failures ===');
  recent.forEach((batch) => {
    if (batch.failedCompanies?.length) {
      console.log(`Batch ${batch._id} (${batch.status}):`);
      batch.failedCompanies.forEach((f) => console.log(`  - ${f.companyLabel}: ${f.error}`));
    }
  });

  await disconnectDatabase();
};

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
