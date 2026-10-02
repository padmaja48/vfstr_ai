/**
 * Audit over-tagged "company" specificity on active/pending concepts.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/auditConceptSpecificity.ts
 *   npx ts-node --transpile-only scripts/auditConceptSpecificity.ts mckinsey-and-company jpmorgan-chase
 */
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { getCatalogEntry } from '../src/data/companyConceptCatalog';
import { QuestionConcept } from '../src/models/QuestionConcept';

const slugs = process.argv.slice(2).filter((arg) => !arg.endsWith('.ts'));

const companyTokens = (label: string) =>
  label
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !['and', 'the', 'company', 'global', 'india'].includes(token));

const mentionsCompany = (text: string, label: string) => {
  const normalized = text.toLowerCase();
  const company = label.toLowerCase();
  if (normalized.includes(company)) return true;
  return companyTokens(label).some((token) => normalized.includes(token));
};

const main = async () => {
  await connectDatabase();

  const filter = slugs.length ? { companySlug: { $in: slugs } } : {};
  const rows = await QuestionConcept.find({
    ...filter,
    status: { $in: ['active', 'pending_review'] },
    specificity: 'company',
  })
    .select('companySlug conceptLabel category status specificity')
    .lean();

  const suspicious = rows.filter((row) => {
    const entry = getCatalogEntry(String(row.companySlug));
    if (!entry) return false;
    return !mentionsCompany(String(row.conceptLabel), entry.label);
  });

  const byCompany = new Map<string, typeof suspicious>();
  for (const row of suspicious) {
    const slug = String(row.companySlug);
    if (!byCompany.has(slug)) byCompany.set(slug, []);
    byCompany.get(slug)!.push(row);
  }

  console.log(`Tagged "company" without naming the firm: ${suspicious.length} concept(s)\n`);
  for (const [slug, items] of [...byCompany.entries()].sort()) {
    const entry = getCatalogEntry(slug);
    console.log(`${entry?.label || slug}: ${items.length} over-tagged`);
    items.slice(0, 5).forEach((item) => {
      console.log(`  [${item.category}] ${item.conceptLabel}`);
    });
    if (items.length > 5) console.log(`  … +${items.length - 5} more`);
    console.log('');
  }

  await disconnectDatabase();
};

void main();
