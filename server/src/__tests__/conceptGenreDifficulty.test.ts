import {
  ADVANCED_IT_SERVICES_CODING_PATTERN,
  buildGenreDifficultyGuidance,
  buildIndustryFallbackConceptSet,
  buildProductTechFallbackSeed,
  calibrateConceptSpecificity,
  isAdvancedItServicesCodingConcept,
  isBrokenFallbackConceptLabel,
  lookupItServicesCodingReplacement,
  sanitizeConceptsForGenre,
} from '../services/conceptGenreDifficulty';
import { getCatalogEntry } from '../data/companyConceptCatalog';
import { generateStarterConceptSetForCompany } from '../services/questionConcept.service';

describe('IT Services genre difficulty', () => {
  it('buildGenreDifficultyGuidance instructs entry-level coding for IT Services regardless of tier', () => {
    const tcs = getCatalogEntry('tcs');
    const guidance = buildGenreDifficultyGuidance(tcs!);
    expect(guidance).toMatch(/fresher|entry-level/i);
    expect(guidance).toMatch(/Do NOT generate senior-level Coding/i);
    expect(guidance).toMatch(/regardless of tier/i);
  });

  it('does not apply IT Services entry-level rules to Product Tech high tier', () => {
    const amazon = getCatalogEntry('amazon');
    const guidance = buildGenreDifficultyGuidance(amazon!);
    expect(guidance).toMatch(/advanced DSA|system-design-lite/i);
    expect(guidance).not.toMatch(/Do NOT generate senior-level Coding/i);
  });

  it('does not apply IT Services rules to Fintech', () => {
    const razorpay = getCatalogEntry('razorpay');
    const guidance = buildGenreDifficultyGuidance(razorpay!);
    expect(guidance).toMatch(/Fintech/i);
    expect(guidance).not.toMatch(/fresher\/entry-level hiring/i);
  });

  it('flags advanced IT Services coding concepts', () => {
    expect(isAdvancedItServicesCodingConcept('Debugging concurrency issues using thread synchronization techniques')).toBe(true);
    expect(isAdvancedItServicesCodingConcept('Applying object-oriented design patterns for maintainable codebases')).toBe(true);
    expect(isAdvancedItServicesCodingConcept('Simple array manipulation for fresher screening')).toBe(false);
  });

  it('replaces known TCS coding concepts with entry-level alternatives', () => {
    expect(lookupItServicesCodingReplacement(
      'Debugging concurrency issues using thread synchronization techniques',
    )).toMatch(/basic OOP/i);
    expect(lookupItServicesCodingReplacement(
      'Applying object-oriented design patterns for maintainable codebases',
    )).toMatch(/SQL queries with JOINs/i);
  });

  it('sanitizes advanced coding concepts for IT Services companies', () => {
    const entry = getCatalogEntry('tcs')!;
    const sanitized = sanitizeConceptsForGenre(
      [
        { category: 'Coding', conceptLabel: 'Debugging concurrency issues using thread synchronization techniques' },
        { category: 'Technical', conceptLabel: 'TCS BaNCS platform integration for banking clients' },
      ],
      entry,
    );
    expect(sanitized[0].conceptLabel).toMatch(/basic OOP/i);
    expect(sanitized[1].conceptLabel).toMatch(/BaNCS/i);
    expect(ADVANCED_IT_SERVICES_CODING_PATTERN.test(sanitized[0].conceptLabel)).toBe(false);
  });

  it('leaves Product Tech high-tier fallback coding advanced', () => {
    const seed = buildProductTechFallbackSeed('high');
    const coding = seed.find((item) => item.category === 'Coding');
    expect(coding?.conceptLabel).toMatch(/Advanced array\/graph/i);
  });

  it('generates entry-level coding for Infosys in test fallback path', async () => {
    const entry = getCatalogEntry('infosys');
    expect(entry?.genre).toBe('it_services');
    const drafts = await generateStarterConceptSetForCompany(entry!);
    const coding = drafts.filter((item) => item.category === 'Coding');
    expect(coding.length).toBeGreaterThan(0);
    coding.forEach((item) => {
      expect(isAdvancedItServicesCodingConcept(item.conceptLabel)).toBe(false);
    });
  });

  it('assigns strategy consulting genre to McKinsey and Bain', () => {
    expect(getCatalogEntry('mckinsey-and-company')?.genre).toBe('strategy_consulting');
    expect(getCatalogEntry('bain-and-company')?.genre).toBe('strategy_consulting');
    expect(getCatalogEntry('tcs')?.genre).toBe('it_services');
    expect(getCatalogEntry('deloitte')?.genre).toBe('it_services');
  });

  it('uses case-interview guidance for strategy consulting', () => {
    const entry = getCatalogEntry('mckinsey-and-company')!;
    const guidance = buildGenreDifficultyGuidance(entry);
    expect(guidance).toMatch(/CASE INTERVIEWS/i);
    expect(guidance).toMatch(/Do NOT generate software-engineering Coding/i);
  });

  it('sanitizes software coding concepts for strategy consulting firms', () => {
    const entry = getCatalogEntry('mckinsey-and-company')!;
    const sanitized = sanitizeConceptsForGenre(
      [
        { category: 'Coding', conceptLabel: 'Reverse words in a string using two pointers', specificity: 'company' },
        { category: 'Technical', conceptLabel: 'Market sizing for a new retail category', specificity: 'industry' },
      ],
      entry,
    );
    expect(sanitized[0].category).toBe('Technical');
    expect(sanitized[0].conceptLabel).toMatch(/market sizing|MECE|profitability|framework/i);
    expect(sanitized[0].specificity).toBe('industry');
  });

  it('downgrades generic behavioral concepts tagged company', () => {
    const entry = getCatalogEntry('mckinsey-and-company')!;
    const calibrated = calibrateConceptSpecificity(
      [
        {
          category: 'Behavioral',
          conceptLabel: 'Handling conflicting priorities from two project managers',
          specificity: 'company',
        },
      ],
      entry,
    );
    expect(calibrated[0].specificity).toBe('industry');
  });

  it('strategy consulting fallback pool has no Coding category', () => {
    const entry = getCatalogEntry('bain-and-company')!;
    const drafts = buildIndustryFallbackConceptSet(entry, 28);
    expect(drafts.some((item) => item.category === 'Coding')).toBe(false);
    expect(drafts.some((item) => /market sizing|profitability|case/i.test(item.conceptLabel))).toBe(true);
  });

  it('keeps Amazon product-tech fallback coding appropriately strong', async () => {
    const entry = getCatalogEntry('amazon');
    expect(entry?.genre).toBe('product_tech');
    const drafts = await generateStarterConceptSetForCompany(entry!);
    const coding = drafts.filter((item) => item.category === 'Coding');
    expect(coding.some((item) => /advanced|hash-map|graph|complexity/i.test(item.conceptLabel))).toBe(true);
  });

  it('industry fallback never emits numbered "(context N)" artifact labels', () => {
    const entry = getCatalogEntry('adobe')!;
    const drafts = buildIndustryFallbackConceptSet(entry, 28);
    expect(drafts.length).toBeGreaterThan(0);
    const labels = drafts.map((item) => item.conceptLabel);
    expect(labels.some((label) => isBrokenFallbackConceptLabel(label))).toBe(false);
    expect(new Set(labels.map((label) => label.toLowerCase())).size).toBe(labels.length);
  });
});
