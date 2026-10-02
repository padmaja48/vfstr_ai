import mongoose from 'mongoose';

import { connectDatabase, disconnectDatabase } from '../config/database';
import {
  PILOT_BATCH_SLUGS,
  getCatalogCompanies,
  getCatalogEntry,
  tierConceptTarget,
} from '../data/companyConceptCatalog';
import {
  approveConceptsForRole,
  buildConceptBasedRoleQuestions,
  approveConceptsForCompany,
  discardConcepts,
  generateAndSaveStarterConceptsForCompany,
  generateStarterConceptSetForCompany,
  generateStarterConceptSetForRole,
  generateAndSaveStarterConceptsForRole,
  getReviewQueueGrouped,
  updateConceptRecord,
} from '../services/questionConcept.service';
import { ROLE_CONCEPT_CATALOG, roleCategoryTargets } from '../data/roleConceptCatalog';
import { createConceptGenerationBatch } from '../services/conceptGenerationQueue.service';
import { QuestionConcept } from '../models/QuestionConcept';
import { ConceptGenerationBatch } from '../models/ConceptGenerationBatch';

/** Non-pilot catalog company — keeps integration tests off approved production pools. */
const TEST_COMPANY_SLUG = 'infosys';

describe('concept starter generation', () => {
  beforeAll(async () => {
    await connectDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('catalog includes 5 pilot companies across genres and tiers', () => {
    const pilot = getCatalogCompanies({ scope: 'pilot' });
    expect(pilot).toHaveLength(5);
    expect(pilot.map((entry) => entry.slug).sort()).toEqual([...PILOT_BATCH_SLUGS].sort());

    const genres = new Set(pilot.map((entry) => entry.genre));
    expect(genres.size).toBeGreaterThanOrEqual(4);

    const tiers = new Set(pilot.map((entry) => entry.tier));
    expect(tiers.size).toBeGreaterThanOrEqual(2);
  });

  it('generates 50 safe, role-specific concepts for all seven roles', async () => {
    for (const entry of ROLE_CONCEPT_CATALOG) {
      const result = await generateStarterConceptSetForRole(entry);
      const concepts = result.drafts;
      expect(concepts).toHaveLength(50);
      expect(result.isPartial).toBe(false);
      expect(result.categoryShortfalls).toHaveLength(0);
      expect(new Set(concepts.map((concept) => concept.conceptLabel.toLowerCase())).size).toBe(50);
      expect(concepts.every((concept) => !/\(.*context\s+\d+\)/i.test(concept.conceptLabel))).toBe(true);
      if (entry.key === 'hr_behavioral') {
        expect(concepts.every((concept) => ['Behavioral', 'Culture'].includes(concept.category))).toBe(true);
      } else {
        const counts = concepts.reduce<Record<string, number>>((result, concept) => {
          result[concept.category] = (result[concept.category] ?? 0) + 1;
          return result;
        }, {});
        const expected = roleCategoryTargets(entry);
        expect(counts.Technical).toBe(expected.Technical);
        expect(counts.Coding).toBe(expected.Coding);
        expect(counts.Culture).toBe(expected.Culture);
        expect(counts.Behavioral).toBe(expected.Behavioral);
      }
    }
  });

  it('groups role review, approves one role, and draws/paraphrases approved SDE concepts', async () => {
    const batch = await ConceptGenerationBatch.create({
      scope: 'custom',
      targetType: 'role',
      status: 'running',
      totalCompanies: 2,
      completedCompanies: 0,
      failedCompanies: [],
      companySlugs: [],
      roleKeys: ['sde', 'hr_behavioral'],
    });
    const sde = ROLE_CONCEPT_CATALOG.find((entry) => entry.key === 'sde')!;
    const hr = ROLE_CONCEPT_CATALOG.find((entry) => entry.key === 'hr_behavioral')!;
    const generatedSde = await generateAndSaveStarterConceptsForRole({ entry: sde, batchId: String(batch._id) });
    const generatedHr = await generateAndSaveStarterConceptsForRole({ entry: hr, batchId: String(batch._id) });

    const queue = await getReviewQueueGrouped({ batchId: String(batch._id) });
    expect(queue.groups.map((group) => group.role).sort()).toEqual(['hr_behavioral', 'sde']);
    expect(queue.groups.find((group) => group.role === 'sde')?.concepts).toHaveLength(50);

    const approval = await approveConceptsForRole({ role: 'sde', batchId: String(batch._id) });
    expect(approval.approvedCount).toBe(generatedSde.count);
    expect(await QuestionConcept.countDocuments({ role: 'sde', status: 'active' })).toBe(50);
    expect(await QuestionConcept.countDocuments({ role: 'hr_behavioral', status: 'pending_review' })).toBe(generatedHr.count);

    const questions = await buildConceptBasedRoleQuestions({
      role: 'SDE',
      experienceLevel: 'fresher',
      resumeProject: 'Inventory API',
    });
    expect(questions.length).toBeGreaterThanOrEqual(5);
    expect(questions.some((question) => question.conceptId)).toBe(true);
    expect(questions.every((question) => question.question.endsWith('?'))).toBe(true);

    await QuestionConcept.deleteMany({ role: { $in: ['sde', 'hr_behavioral'] } });
    await ConceptGenerationBatch.findByIdAndDelete(batch._id);
  });

  it('full catalog batch excludes already-approved pilot companies', () => {
    const full = getCatalogCompanies({ scope: 'full', limit: 100 });
    expect(full.length).toBeGreaterThan(0);
    expect(full.some((entry) => (PILOT_BATCH_SLUGS as readonly string[]).includes(entry.slug))).toBe(false);
  });

  it('generates pending_review concepts for a catalog company (test fallback)', async () => {
    const entry = getCatalogEntry(TEST_COMPANY_SLUG);
    expect(entry).toBeTruthy();

    const batch = await ConceptGenerationBatch.create({
      scope: 'custom',
      status: 'running',
      totalCompanies: 1,
      completedCompanies: 0,
      failedCompanies: [],
      companySlugs: [entry!.slug],
    });

    const result = await generateAndSaveStarterConceptsForCompany({
      entry: entry!,
      batchId: String(batch._id),
    });

    expect(result.count).toBeGreaterThanOrEqual(tierConceptTarget(entry!.tier).min);
    expect(result.archiveReport.archivedCount).toBe(0);
    result.created.forEach((concept) => {
      expect(concept.status).toBe('pending_review');
      expect(concept.companySlug).toBe(entry!.slug);
    });

    await QuestionConcept.deleteMany({ batchId: batch._id });
    await ConceptGenerationBatch.findByIdAndDelete(batch._id);
  });

  it('supports review queue approve and discard flow', async () => {
    const entry = getCatalogEntry(TEST_COMPANY_SLUG);
    expect(entry).toBeTruthy();

    const batch = await ConceptGenerationBatch.create({
      scope: 'custom',
      status: 'running',
      totalCompanies: 1,
      completedCompanies: 0,
      failedCompanies: [],
      companySlugs: [entry!.slug],
    });

    const generated = await generateAndSaveStarterConceptsForCompany({
      entry: entry!,
      batchId: String(batch._id),
    });
    expect(generated.count).toBeGreaterThan(0);

    const queueBefore = await getReviewQueueGrouped({ batchId: String(batch._id) });
    expect(queueBefore.totalPending).toBeGreaterThan(0);

    const toDiscard = generated.created[0];
    await discardConcepts({ conceptIds: [toDiscard.id] });

    const approve = await approveConceptsForCompany({
      companySlug: entry!.slug,
      batchId: String(batch._id),
    });
    expect(approve.approvedCount).toBe(generated.count - 1);

    const active = await QuestionConcept.find({
      companySlug: entry!.slug,
      status: 'active',
      batchId: batch._id,
    });
    expect(active.length).toBe(generated.count - 1);

    await QuestionConcept.deleteMany({ batchId: batch._id });
    await ConceptGenerationBatch.findByIdAndDelete(batch._id);
  });

  it('fails batch item when AI returns 429 after retries are exhausted', async () => {
    const entry = getCatalogEntry('siemens');
    expect(entry).toBeTruthy();

    const previousNodeEnv = process.env.NODE_ENV;
    const previousGroqKey = process.env.GROQ_API_KEY;
    const previousForce = process.env.FORCE_CONCEPT_AI_IN_TEST;
    const previousMaxAttempts = process.env.CONCEPT_GEN_MAX_ATTEMPTS;
    process.env.NODE_ENV = 'development';
    process.env.GROQ_API_KEY = 'test-groq-key';
    process.env.FORCE_CONCEPT_AI_IN_TEST = '1';
    process.env.CONCEPT_GEN_MAX_ATTEMPTS = '1';

    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: () => '1' },
      text: async () => JSON.stringify({ error: { message: 'Rate limit reached' } }),
    }) as unknown as typeof fetch;

    try {
      await expect(generateStarterConceptSetForCompany(entry!)).rejects.toThrow(/rate limit exhausted/i);
    } finally {
      global.fetch = originalFetch;
      process.env.NODE_ENV = previousNodeEnv;
      process.env.GROQ_API_KEY = previousGroqKey;
      process.env.FORCE_CONCEPT_AI_IN_TEST = previousForce;
      process.env.CONCEPT_GEN_MAX_ATTEMPTS = previousMaxAttempts;
    }
  });

  it('creates a generation batch job for a single catalog company', async () => {
    const batch = await createConceptGenerationBatch({
      scope: 'custom',
      slugs: [TEST_COMPANY_SLUG],
    });
    expect(batch.totalCompanies).toBe(1);
    expect(batch.companySlugs).toEqual([TEST_COMPANY_SLUG]);
    expect(['queued', 'running', 'completed', 'partial']).toContain(batch.status);

    await QuestionConcept.deleteMany({ batchId: batch.id });
    if (mongoose.Types.ObjectId.isValid(batch.id)) {
      await ConceptGenerationBatch.findByIdAndDelete(batch.id);
    }
  });

  it('supersedes prior active batch on approve after regenerating starter concepts', async () => {
    const entry = getCatalogEntry(TEST_COMPANY_SLUG);
    expect(entry).toBeTruthy();

    const batch1 = await ConceptGenerationBatch.create({
      scope: 'custom',
      status: 'running',
      totalCompanies: 1,
      completedCompanies: 0,
      failedCompanies: [],
      companySlugs: [entry!.slug],
    });
    const batch2 = await ConceptGenerationBatch.create({
      scope: 'custom',
      status: 'running',
      totalCompanies: 1,
      completedCompanies: 0,
      failedCompanies: [],
      companySlugs: [entry!.slug],
    });

    const first = await generateAndSaveStarterConceptsForCompany({
      entry: entry!,
      batchId: String(batch1._id),
    });
    expect(first.count).toBeGreaterThan(0);
    expect(first.archiveReport.archivedCount).toBe(0);

    const approveFirst = await approveConceptsForCompany({
      companySlug: entry!.slug,
      batchId: String(batch1._id),
    });
    expect(approveFirst.supersededArchivedCount).toBe(0);

    const activeAfterFirst = await QuestionConcept.countDocuments({
      companySlug: entry!.slug,
      status: 'active',
    });
    expect(activeAfterFirst).toBe(first.count);

    const second = await generateAndSaveStarterConceptsForCompany({
      entry: entry!,
      batchId: String(batch2._id),
    });
    expect(second.count).toBeGreaterThan(0);
    expect(second.archiveReport.archivedCount).toBe(0);

    const activeAfterSecond = await QuestionConcept.countDocuments({
      companySlug: entry!.slug,
      status: 'active',
    });
    expect(activeAfterSecond).toBe(first.count);

    const pendingSecond = await QuestionConcept.countDocuments({
      companySlug: entry!.slug,
      status: 'pending_review',
      batchId: batch2._id,
    });
    expect(pendingSecond).toBe(second.count);

    const approveSecond = await approveConceptsForCompany({
      companySlug: entry!.slug,
      batchId: String(batch2._id),
    });
    expect(approveSecond.supersededArchivedCount).toBe(first.count);

    const activeAfterApprove = await QuestionConcept.countDocuments({
      companySlug: entry!.slug,
      status: 'active',
    });
    expect(activeAfterApprove).toBe(second.count);

    const archivedFirst = await QuestionConcept.countDocuments({
      companySlug: entry!.slug,
      status: 'archived',
      batchId: batch1._id,
    });
    expect(archivedFirst).toBe(first.count);

    await QuestionConcept.deleteMany({ companySlug: entry!.slug });
    await ConceptGenerationBatch.deleteMany({ _id: { $in: [batch1._id, batch2._id] } });
  });

  it('preserves manually-edited concepts when approving a newer starter batch', async () => {
    const entry = getCatalogEntry(TEST_COMPANY_SLUG);
    expect(entry).toBeTruthy();

    const batch1 = await ConceptGenerationBatch.create({
      scope: 'custom',
      status: 'running',
      totalCompanies: 1,
      completedCompanies: 0,
      failedCompanies: [],
      companySlugs: [entry!.slug],
    });
    const batch2 = await ConceptGenerationBatch.create({
      scope: 'custom',
      status: 'running',
      totalCompanies: 1,
      completedCompanies: 0,
      failedCompanies: [],
      companySlugs: [entry!.slug],
    });

    const first = await generateAndSaveStarterConceptsForCompany({
      entry: entry!,
      batchId: String(batch1._id),
    });
    const edited = first.created[0];
    await updateConceptRecord(edited.id, {
      conceptLabel: 'Admin customized concept label for manual edit preservation test',
    });
    await approveConceptsForCompany({
      companySlug: entry!.slug,
      batchId: String(batch1._id),
    });

    await generateAndSaveStarterConceptsForCompany({
      entry: entry!,
      batchId: String(batch2._id),
    });

    const approveSecond = await approveConceptsForCompany({
      companySlug: entry!.slug,
      batchId: String(batch2._id),
    });
    expect(approveSecond.supersededArchivedCount).toBe(first.count - 1);

    const preserved = await QuestionConcept.findById(edited.id);
    expect(preserved?.status).toBe('active');
    expect(preserved?.manuallyEditedAt).toBeTruthy();

    await QuestionConcept.deleteMany({ companySlug: entry!.slug });
    await ConceptGenerationBatch.deleteMany({ _id: { $in: [batch1._id, batch2._id] } });
  });
});
