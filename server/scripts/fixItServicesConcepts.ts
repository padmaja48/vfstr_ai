/**
 * Fix IT Services/Consulting Coding concepts that are too advanced for fresher hiring.
 * Usage: npx ts-node --transpile-only scripts/fixItServicesConcepts.ts
 */
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { fixItServicesConsultingConceptRecords } from '../src/services/questionConcept.service';

const main = async () => {
  await connectDatabase();
  const result = await fixItServicesConsultingConceptRecords();
  console.log(`Fixed ${result.fixedCount} concept(s).`);
  result.fixes.forEach((fix) => {
    console.log(`\n[${fix.companySlug}]`);
    console.log(`  FROM: ${fix.from}`);
    console.log(`  TO:   ${fix.to}`);
  });
  await disconnectDatabase();
};

void main();
