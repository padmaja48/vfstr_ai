import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { QuestionConcept } from '../src/models/QuestionConcept';

const audit = async () => {
  await connectDatabase();

  for (const slug of ['pennant-technologies', 'siemens']) {
    const rows = await QuestionConcept.find({ companySlug: slug }).sort({ updatedAt: -1 }).lean();
    console.log(`\n=== ${slug} total: ${rows.length} ===`);
    for (const r of rows) {
      const missing: string[] = [];
      if (!r.companySlug) missing.push('companySlug');
      if (!r.category) missing.push('category');
      if (!r.tier) missing.push('tier');
      if (!r.status) missing.push('status');
      if (!r.conceptLabel) missing.push('conceptLabel');
      console.log(JSON.stringify({
        id: String(r._id),
        status: r.status,
        category: r.category,
        tier: r.tier,
        label: (r.conceptLabel || '').slice(0, 100),
        missing,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));
    }
  }

  const bad = await QuestionConcept.find({
    $or: [
      { companySlug: { $in: [null, ''] } },
      { category: { $exists: false } },
      { tier: { $exists: false } },
      { status: { $exists: false } },
    ],
  }).lean();

  console.log(`\n=== globally incomplete: ${bad.length} ===`);
  for (const r of bad) {
    console.log(String(r._id), r.companySlug, r.category, r.tier, r.status, (r.conceptLabel || '').slice(0, 60));
  }

  // Find duplicate labels per company (potential orphans from edit bug)
  const dupes = await QuestionConcept.aggregate([
    { $match: { status: { $in: ['active', 'pending_review'] } } },
    {
      $group: {
        _id: { companySlug: '$companySlug', conceptLabel: '$conceptLabel' },
        count: { $sum: 1 },
        ids: { $push: '$_id' },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);
  console.log(`\n=== duplicate label groups: ${dupes.length} ===`);
  for (const d of dupes) {
    console.log(JSON.stringify(d));
  }

  // Concepts with empty-string required fields (UI may show as blank)
  const emptyFields = await QuestionConcept.find({
    $or: [
      { companySlug: '' },
      { category: '' },
      { tier: '' },
      { status: '' },
      { conceptLabel: '' },
    ],
  }).lean();
  console.log(`\n=== empty-string fields: ${emptyFields.length} ===`);
  for (const r of emptyFields) {
    console.log(JSON.stringify({
      id: String(r._id),
      companySlug: r.companySlug,
      category: r.category,
      tier: r.tier,
      status: r.status,
      label: r.conceptLabel,
    }));
  }

  // Active concepts per company — flag over-provisioned pilots
  for (const slug of ['pennant-technologies', 'siemens']) {
    const active = await QuestionConcept.countDocuments({ companySlug: slug, status: 'active' });
    const pending = await QuestionConcept.countDocuments({ companySlug: slug, status: 'pending_review' });
    const discarded = await QuestionConcept.countDocuments({ companySlug: slug, status: 'discarded' });
    console.log(`\n${slug}: active=${active}, pending=${pending}, discarded=${discarded}`);
  }

  await disconnectDatabase();
};

void audit();
