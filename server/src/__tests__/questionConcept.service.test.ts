import {
  collectStudentConceptUsage,
  conceptGlobalRank,
  paraphraseConceptToQuestion,
  selectConceptsFromPool,
  type ConceptRecord,
} from '../services/questionConcept.service';

const makeConcept = (
  id: string,
  category: ConceptRecord['category'],
  label: string,
  usageCount = 0,
  lastUsedAt?: string,
): ConceptRecord => ({
  id,
  companySlug: 'acme',
  category,
  conceptLabel: label,
  tier: 'medium',
  status: 'active',
  createdBy: 'admin',
  usageCount,
  lastUsedAt,
});

describe('question concept pool', () => {
  const pool: ConceptRecord[] = [
    makeConcept('c1', 'Culture', 'Ownership and customer obsession', 10, '2026-08-20T00:00:00.000Z'),
    makeConcept('c2', 'Technical', 'Distributed systems read scaling', 2, '2026-08-19T00:00:00.000Z'),
    makeConcept('c3', 'Technical', 'API pagination under load', 1),
    makeConcept('c4', 'Technical', 'Database indexing trade-offs', 0),
    makeConcept('c5', 'Technical', 'Observability and on-call', 5, '2026-08-18T00:00:00.000Z'),
    makeConcept('c6', 'Coding', 'Two-sum style array problem', 3),
    makeConcept('c7', 'Behavioral', 'Conflict with a teammate', 0),
  ];

  it('excludes concepts already seen by the same student', () => {
    const first = selectConceptsFromPool(pool, {
      categories: ['Technical'],
      count: 2,
      excludedConceptIds: [],
    });
    expect(first.map((item) => item.id)).not.toContain(undefined);
    expect(new Set(first.map((item) => item.id)).size).toBe(2);

    const second = selectConceptsFromPool(pool, {
      categories: ['Technical'],
      count: 2,
      excludedConceptIds: first.map((item) => item.id),
    });
    second.forEach((item) => {
      expect(first.some((prev) => prev.id === item.id)).toBe(false);
    });
  });

  it('falls back to least-recently-used-by-student when pool is exhausted', () => {
    const technicalIds = pool.filter((item) => item.category === 'Technical').map((item) => item.id);
    const picked = selectConceptsFromPool(pool, {
      categories: ['Technical'],
      count: 1,
      excludedConceptIds: technicalIds,
      studentConceptHistory: [
        { conceptId: 'c5', lastUsedAt: '2026-08-01T00:00:00.000Z' },
        { conceptId: 'c2', lastUsedAt: '2026-08-10T00:00:00.000Z' },
        { conceptId: 'c3', lastUsedAt: '2026-08-15T00:00:00.000Z' },
      ],
    });
    expect(picked).toHaveLength(1);
    expect(picked[0].id).toBe('c5');
  });

  it('spreads usage across the pool for concurrent students (LRU bias)', () => {
    const mediumPool: ConceptRecord[] = [
      ...Array.from({ length: 8 }, (_, index) =>
        makeConcept(`c${index}`, 'Culture', `Culture topic ${index}`, index % 2, index % 2 ? '2026-08-20T00:00:00.000Z' : undefined),
      ),
      ...Array.from({ length: 8 }, (_, index) =>
        makeConcept(`t${index}`, 'Technical', `Technical topic ${index}`, index, index % 3 ? '2026-08-20T00:00:00.000Z' : undefined),
      ),
      ...Array.from({ length: 4 }, (_, index) =>
        makeConcept(`d${index}`, 'Coding', `Coding topic ${index}`, index % 2),
      ),
    ];

    const usage = new Map<string, number>();
    for (let student = 0; student < 50; student += 1) {
      const culture = selectConceptsFromPool(mediumPool, {
        categories: ['Culture', 'Behavioral'],
        count: 1,
        excludedConceptIds: [],
      });
      const technical = selectConceptsFromPool(mediumPool, {
        categories: ['Technical'],
        count: 1,
        excludedConceptIds: culture.map((item) => item.id),
      });
      const coding = selectConceptsFromPool(mediumPool, {
        categories: ['Coding'],
        count: 1,
        excludedConceptIds: [...culture, ...technical].map((item) => item.id),
      });
      const batch = [...culture, ...technical, ...coding];
      batch.forEach((concept) => {
        usage.set(concept.id, (usage.get(concept.id) ?? 0) + 1);
      });
      batch.forEach((concept) => {
        const target = mediumPool.find((item) => item.id === concept.id);
        if (target) {
          target.usageCount += 1;
          target.lastUsedAt = new Date().toISOString();
        }
      });
    }

    const counts = [...usage.values()];
    const max = Math.max(...counts);
    const min = Math.min(...counts);
    expect(max - min).toBeLessThanOrEqual(12);
    expect(usage.size).toBeGreaterThanOrEqual(10);
  });

  it('ranks lower usage and older lastUsedAt concepts first', () => {
    const ranked = [...pool].sort((a, b) => conceptGlobalRank(a) - conceptGlobalRank(b));
    expect(ranked[0].usageCount).toBeLessThanOrEqual(ranked[1].usageCount);
  });

  it('generates different wording for the same concept across selections', async () => {
    const outputs: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
      outputs.push(
        await paraphraseConceptToQuestion({
          conceptLabel: 'Distributed systems / high-scale read traffic design',
          category: 'Technical',
          companyLabel: 'Acme Corp',
          role: 'Backend Engineer',
          experienceLevel: 'experienced',
          resumeProject: 'Realtime analytics dashboard',
        }),
      );
    }
    const unique = new Set(outputs);
    expect(unique.size).toBeGreaterThan(1);
  });

  it('collects per-student concept usage from prior interviews for one company', () => {
    const { excludedConceptIds, studentConceptHistory } = collectStudentConceptUsage(
      [
        {
          targetCompany: 'amazon',
          askedConceptIds: ['a1'],
          questions: [{ conceptId: 'a2' }],
          createdAt: '2026-08-01T00:00:00.000Z',
        },
        {
          targetCompany: 'google',
          askedConceptIds: ['g1'],
          questions: [],
          createdAt: '2026-08-02T00:00:00.000Z',
        },
      ],
      'amazon',
    );
    expect(excludedConceptIds.sort()).toEqual(['a1', 'a2']);
    expect(studentConceptHistory.some((item) => item.conceptId === 'a2')).toBe(true);
  });
});

describe('fixed-text question bank unaffected', () => {
  it('buildInterviewQuestionSet still works without concept-backed company pack', async () => {
    const { buildInterviewQuestionSet } = await import('../services/companyQuestions.service');
    const questions = buildInterviewQuestionSet({
      duration: 30,
      targetCompany: 'tcs',
      generatedQuestions: [
        {
          question: 'Explain your React project architecture.',
          expectedSignals: ['component structure'],
          questionType: 'technical',
          resumeReference: 'React project',
        },
      ],
      researchedCompanyQuestions: [],
    });
    expect(questions[0].question).toMatch(/^Tell me about yourself/);
    expect(questions.some((item) => item.question.includes('TCS'))).toBe(true);
    expect(questions.every((item) => !item.conceptId)).toBe(true);
  });
});
