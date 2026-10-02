/**
 * Analyze concept batches per company to pick which ObjectId prefix to keep.
 */
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { QuestionConcept } from '../src/models/QuestionConcept';

const EDIT_THRESHOLD_MS = 60_000;

const analyze = async (slug: string) => {
  const rows = await QuestionConcept.find({
    companySlug: slug,
    status: { $in: ['active', 'pending_review'] },
  }).lean();

  const byPrefix = new Map<string, Array<(typeof rows)[number]>>();
  for (const row of rows) {
    const prefix = String(row._id).slice(0, 8);
    const bucket = byPrefix.get(prefix) ?? [];
    bucket.push(row);
    byPrefix.set(prefix, bucket);
  }

  console.log(`\n=== ${slug} total active/pending: ${rows.length} ===`);
  const prefixStats = [...byPrefix.entries()].map(([prefix, bucket]) => {
    const edited = bucket.filter(
      (r) => new Date(r.updatedAt).getTime() - new Date(r.createdAt).getTime() > EDIT_THRESHOLD_MS,
    );
    const createdMin = Math.min(...bucket.map((r) => new Date(r.createdAt).getTime()));
    const updatedMax = Math.max(...bucket.map((r) => new Date(r.updatedAt).getTime()));
    return { prefix, count: bucket.length, edited: edited.length, createdMin, updatedMax, editedRows: edited };
  }).sort((a, b) => a.createdMin - b.createdMin);

  prefixStats.forEach((stat) => {
    console.log(
      `  ${stat.prefix}: ${stat.count} concepts, ${stat.edited} manually edited, `
      + `created ${new Date(stat.createdMin).toISOString()}, lastUpdated ${new Date(stat.updatedMax).toISOString()}`,
    );
  });

  // Recommend keep: batch with most manual edits, tie-break by latest updatedMax
  const recommended = [...prefixStats].sort((a, b) => {
    if (b.edited !== a.edited) return b.edited - a.edited;
    return b.updatedMax - a.updatedMax;
  })[0];

  if (recommended) {
    console.log(`  RECOMMENDED KEEP: ${recommended.prefix} (${recommended.count} concepts, ${recommended.edited} edited)`);
    recommended.editedRows.slice(0, 8).forEach((r) => {
      console.log(`    EDIT ${String(r._id).slice(0, 8)} [${r.category}] ${(r.conceptLabel || '').slice(0, 60)}`);
    });
  }

  return { slug, prefixStats, recommended: recommended?.prefix };
};

const main = async () => {
  await connectDatabase();
  const slugs = ['amazon', 'tcs', 'razorpay'];
  const results = [];
  for (const slug of slugs) {
    results.push(await analyze(slug));
  }
  console.log('\n=== SUMMARY (keep prefixes) ===');
  results.forEach((r) => console.log(`${r.slug}: ${r.recommended}`));
  await disconnectDatabase();
};

void main();
