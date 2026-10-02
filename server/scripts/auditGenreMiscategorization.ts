/**
 * Audit active/pending concepts whose stored genre differs from catalog genre.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/auditGenreMiscategorization.ts
 */
import dotenv from 'dotenv';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import {
  GENRE_LABELS,
  getCatalogCompanies,
  getCatalogEntry,
  type CompanyGenre,
} from '../src/data/companyConceptCatalog';
import { QuestionConcept } from '../src/models/QuestionConcept';

dotenv.config();

const main = async () => {
  await connectDatabase();

  const fullSlugs = getCatalogCompanies({ scope: 'full', limit: 100 }).map((entry) => entry.slug);
  const rows = await QuestionConcept.find({
    companySlug: { $in: fullSlugs },
    status: { $in: ['active', 'pending_review'] },
  })
    .select('companySlug genre status')
    .lean();

  type CompanyGenreStats = {
    catalogGenre: CompanyGenre;
    label: string;
    storedGenres: Map<string, number>;
    status: Set<string>;
    count: number;
  };

  const byCompany = new Map<string, CompanyGenreStats>();

  for (const row of rows) {
    const slug = String(row.companySlug);
    const entry = getCatalogEntry(slug);
    if (!entry) continue;

    const stats = byCompany.get(slug) ?? {
      catalogGenre: entry.genre,
      label: entry.label,
      storedGenres: new Map<string, number>(),
      status: new Set<string>(),
      count: 0,
    };

    stats.count += 1;
    stats.status.add(String(row.status));
    const stored = String(row.genre || '(missing)');
    stats.storedGenres.set(stored, (stats.storedGenres.get(stored) ?? 0) + 1);
    byCompany.set(slug, stats);
  }

  const mismatches = [...byCompany.entries()]
    .filter(([, stats]) => {
      const storedKeys = [...stats.storedGenres.keys()].filter((key) => key !== '(missing)');
      if (!storedKeys.length) return false;
      return storedKeys.some((key) => key !== stats.catalogGenre);
    })
    .sort((left, right) => left[1].label.localeCompare(right[1].label));

  console.log(`Scanned ${rows.length} active/pending concepts across ${byCompany.size} companies\n`);

  if (!mismatches.length) {
    console.log('Genre mismatches: none');
  } else {
    console.log(`Genre mismatches: ${mismatches.length} companies\n`);
    for (const [slug, stats] of mismatches) {
      const storedSummary = [...stats.storedGenres.entries()]
        .map(([genre, count]) => `${genre} (${count})`)
        .join(', ');
      console.log(
        `${stats.label} [${slug}]`,
      );
      console.log(
        `  catalog: ${stats.catalogGenre} (${GENRE_LABELS[stats.catalogGenre]})`,
      );
      console.log(`  stored:  ${storedSummary}`);
      console.log(`  status:  ${[...stats.status].join(', ')} | ${stats.count} concepts`);
      console.log('');
    }

    console.log('--- Mismatch slug list ---');
    console.log(mismatches.map(([slug]) => slug).join(', '));
  }

  await disconnectDatabase();
};

void main().catch(async (error) => {
  console.error(error);
  await disconnectDatabase();
  process.exit(1);
});
