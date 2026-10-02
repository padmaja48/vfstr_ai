import mongoose from 'mongoose';

import { connectDatabase, disconnectDatabase } from '../config/database';
import { ConceptGenerationBatch } from '../models/ConceptGenerationBatch';
import { QuestionConcept } from '../models/QuestionConcept';
import {
  ROLE_CONCEPT_CATALOG,
  isTemplatedRoleFallbackLabel,
  roleCategoryTargets,
} from '../data/roleConceptCatalog';
import {
  finalizeRoleConceptDrafts,
  generateAndSaveStarterConceptsForRole,
  generateStarterConceptSetForRole,
  markBatchProgress,
} from '../services/questionConcept.service';

const buildMockConceptPayload = (entry: (typeof ROLE_CONCEPT_CATALOG)[number]) => {
  const targets = roleCategoryTargets(entry);
  const concepts: Array<{ category: string; conceptLabel: string; specificity: string }> = [];
  let index = 1;
  (['Technical', 'Culture', 'Coding', 'Behavioral'] as const).forEach((category) => {
    const count = category === 'Behavioral' ? Math.max(0, targets[category] - 4) : targets[category];
    for (let row = 0; row < count; row += 1) {
      concepts.push({
        category,
        conceptLabel: `Mock ${entry.label} ${category} concept topic ${index}`,
        specificity: 'industry',
      });
      index += 1;
    }
  });
  concepts.push({
    category: 'Behavioral',
    conceptLabel: `SQL querying — a real team situation`,
    specificity: 'industry',
  });
  return { concepts };
};

describe('role concept partial generation', () => {
  beforeAll(async () => {
    await connectDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('finalizeRoleConceptDrafts rejects templated fallback labels and reports category shortfalls', () => {
    const entry = ROLE_CONCEPT_CATALOG.find((row) => row.key === 'sde')!;
    const targets = roleCategoryTargets(entry);
    const aiDrafts = [
      ...Array.from({ length: targets.Technical }, (_, index) => ({
        category: 'Technical' as const,
        conceptLabel: `Genuine SDE technical topic ${index + 1}`,
        specificity: 'industry' as const,
      })),
      {
        category: 'Behavioral' as const,
        conceptLabel: 'Ownership of engineering work — a real team situation',
        specificity: 'industry' as const,
      },
      {
        category: 'Behavioral' as const,
        conceptLabel: 'Genuine behavioral ownership example',
        specificity: 'industry' as const,
      },
    ];

    const result = finalizeRoleConceptDrafts(aiDrafts, entry, 50);

    expect(result.isPartial).toBe(true);
    expect(result.drafts.every((draft) => !isTemplatedRoleFallbackLabel(draft.conceptLabel))).toBe(true);
    expect(result.drafts.filter((draft) => draft.category === 'Behavioral')).toHaveLength(1);
    expect(result.categoryShortfalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'Behavioral',
          expected: targets.Behavioral,
          actual: 1,
          shortBy: targets.Behavioral - 1,
        }),
        expect.objectContaining({ category: 'Culture' }),
        expect.objectContaining({ category: 'Coding' }),
      ]),
    );
  });

  it('flags partial role batch when mocked AI returns a short category', async () => {
    const entry = ROLE_CONCEPT_CATALOG.find((row) => row.key === 'sde')!;
    const targets = roleCategoryTargets(entry);
    const previousNodeEnv = process.env.NODE_ENV;
    const previousGroqKey = process.env.GROQ_API_KEY;
    const previousForce = process.env.FORCE_CONCEPT_AI_IN_TEST;

    process.env.NODE_ENV = 'development';
    process.env.GROQ_API_KEY = 'test-groq-key';
    process.env.FORCE_CONCEPT_AI_IN_TEST = '1';

    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(buildMockConceptPayload(entry)) } }],
      }),
    }) as unknown as typeof fetch;

    const batch = await ConceptGenerationBatch.create({
      scope: 'custom',
      targetType: 'role',
      status: 'running',
      totalCompanies: 1,
      completedCompanies: 0,
      failedCompanies: [],
      partialTargets: [],
      companySlugs: [],
      roleKeys: ['sde'],
    });

    try {
      const generation = await generateStarterConceptSetForRole(entry);
      expect(generation.isPartial).toBe(true);
      expect(generation.drafts.length).toBeLessThan(50);
      expect(generation.drafts.every((draft) => !isTemplatedRoleFallbackLabel(draft.conceptLabel))).toBe(true);
      expect(generation.categoryShortfalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: 'Behavioral',
            expected: targets.Behavioral,
            actual: targets.Behavioral - 4,
            shortBy: 4,
          }),
        ]),
      );

      const saved = await generateAndSaveStarterConceptsForRole({
        entry,
        batchId: String(batch._id),
      });
      expect(saved.isPartial).toBe(true);
      expect(saved.generatedCount).toBe(generation.drafts.length);

      await markBatchProgress({
        batchId: String(batch._id),
        role: entry.key,
        targetLabel: entry.label,
        success: false,
        categoryShortfalls: saved.categoryShortfalls,
      });

      const batchDoc = await ConceptGenerationBatch.findById(batch._id).lean();
      expect(batchDoc?.partialTargets).toHaveLength(1);
      expect(batchDoc?.partialTargets?.[0]?.categoryShortfalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ category: 'Behavioral', shortBy: 4 }),
        ]),
      );
      expect(batchDoc?.partialTargets?.[0]?.message).toMatch(/Behavioral/i);

      const pending = await QuestionConcept.find({ role: 'sde', status: 'pending_review', batchId: batch._id }).lean();
      expect(pending.length).toBe(saved.generatedCount);
      expect(pending.every((row) => !isTemplatedRoleFallbackLabel(String(row.conceptLabel)))).toBe(true);
    } finally {
      global.fetch = originalFetch;
      process.env.NODE_ENV = previousNodeEnv;
      process.env.GROQ_API_KEY = previousGroqKey;
      process.env.FORCE_CONCEPT_AI_IN_TEST = previousForce;
      await QuestionConcept.deleteMany({ role: 'sde', batchId: batch._id });
      await ConceptGenerationBatch.findByIdAndDelete(batch._id);
    }
  });
});
