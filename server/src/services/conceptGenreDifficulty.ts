import type { ConceptCategory } from '../models/QuestionConcept';
import { isTemplatedRoleFallbackLabel } from '../data/roleConceptCatalog';
import type { CompanyCatalogEntry, CompanyGenre } from '../data/companyConceptCatalog';
import { GENRE_LABELS } from '../data/companyConceptCatalog';
import type { ConceptTier } from '../models/QuestionConcept';

export type ConceptDraft = {
  category: ConceptCategory;
  conceptLabel: string;
  specificity?: 'company' | 'industry' | 'mixed';
};

/** Senior/advanced Coding topics inappropriate for mass-hiring IT Services fresher screens. */
export const ADVANCED_IT_SERVICES_CODING_PATTERN =
  /\b(concurrency|thread\s*synchron|multithread|deadlock|race condition|design patterns?|refactor(?:ing)?\s+(?:a\s+)?legacy|system[\s-]design|distributed systems|microservices?\s+architecture|event[\s-]driven architecture|dynamic programming|segment tree|graph traversal|advanced algorithm|formal design|singleton pattern|factory pattern|observer pattern|clean architecture|domain[\s-]driven design|cap theorem|load balancer design|sharding strategy|kubernetes orchestration|object-oriented design patterns?)\b/i;

export const ADVANCED_IT_SERVICES_TECHNICAL_PATTERN =
  /\b(advanced concurrency|formal design pattern|enterprise[\s-]scale system design|microservices migration strategy|complex distributed)\b/i;

export const isAdvancedItServicesCodingConcept = (label: string) =>
  ADVANCED_IT_SERVICES_CODING_PATTERN.test(label);

export const isAdvancedItServicesTechnicalConcept = (label: string) =>
  ADVANCED_IT_SERVICES_TECHNICAL_PATTERN.test(label);

/** Software-engineering coding topics inappropriate for strategy consulting case interviews. */
export const SOFTWARE_ENGINEERING_CODING_PATTERN =
  /\b(array|string manipulation|reverse a string|reverse words|palindrome|sorting algorithm|binary search|hash.?map|graph traversal|dynamic programming|data structure|leetcode|implement a function|time complexity|space complexity|linked list|tree traversal|fibonacci|nested loops|OOP|SQL query|coding round|fizzbuzz|two.?pointer)\b/i;

export const isSoftwareEngineeringCodingConcept = (label: string) =>
  SOFTWARE_ENGINEERING_CODING_PATTERN.test(label);

export const STRATEGY_CASE_CONCEPT_POOL: ConceptDraft[] = [
  { category: 'Technical', conceptLabel: 'Structured case breakdown using MECE and hypothesis-driven frameworks', specificity: 'industry' },
  { category: 'Technical', conceptLabel: 'Market sizing estimation with explicit assumptions and sanity checks', specificity: 'industry' },
  { category: 'Technical', conceptLabel: 'Profitability analysis — revenue vs cost drivers and improvement levers', specificity: 'industry' },
  { category: 'Technical', conceptLabel: 'Interpreting charts and tables from a client business scenario', specificity: 'industry' },
  { category: 'Technical', conceptLabel: 'Pricing strategy case — value-based vs cost-plus trade-offs', specificity: 'industry' },
  { category: 'Technical', conceptLabel: 'Market entry recommendation with risks, timing, and success metrics', specificity: 'industry' },
  { category: 'Technical', conceptLabel: 'Operations improvement case — bottleneck diagnosis and impact sizing', specificity: 'industry' },
  { category: 'Technical', conceptLabel: 'Merger synergy case — cost and revenue synergy hypothesis testing', specificity: 'industry' },
  { category: 'Technical', conceptLabel: 'Growth strategy case — segmentation, channels, and prioritization', specificity: 'industry' },
  { category: 'Technical', conceptLabel: 'Client recommendation synthesis with executive storyline structure', specificity: 'industry' },
  { category: 'Technical', conceptLabel: 'Competitive landscape analysis with strategic response options', specificity: 'industry' },
  { category: 'Technical', conceptLabel: 'Breakeven and sensitivity analysis for a new product launch', specificity: 'industry' },
];

let strategyCasePoolIndex = 0;

export const nextStrategyCaseConcept = (): ConceptDraft => {
  const item = STRATEGY_CASE_CONCEPT_POOL[strategyCasePoolIndex % STRATEGY_CASE_CONCEPT_POOL.length];
  strategyCasePoolIndex += 1;
  return { ...item };
};

export const resetStrategyCasePool = () => {
  strategyCasePoolIndex = 0;
};

const companyMentionTokens = (companyLabel: string) =>
  companyLabel
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !['and', 'the', 'company', 'global', 'india'].includes(token));

const conceptMentionsCompany = (conceptLabel: string, companyLabel: string) => {
  const text = conceptLabel.toLowerCase();
  const label = companyLabel.toLowerCase();
  if (text.includes(label)) return true;
  return companyMentionTokens(companyLabel).some((token) => text.includes(token));
};

/**
 * Downgrade over-tagged "company" specificity when the label is generic industry content.
 */
export const calibrateConceptSpecificity = (
  concepts: ConceptDraft[],
  entry: Pick<CompanyCatalogEntry, 'label'>,
): ConceptDraft[] =>
  concepts.map((concept) => {
    const specificity = concept.specificity ?? 'mixed';
    if (specificity !== 'company') return concept;
    if (conceptMentionsCompany(concept.conceptLabel, entry.label)) return concept;
    if (concept.category === 'Behavioral' || concept.category === 'Culture') {
      return { ...concept, specificity: 'industry' };
    }
    if (concept.category === 'Technical' || concept.category === 'Coding') {
      return { ...concept, specificity: 'industry' };
    }
    return { ...concept, specificity: 'mixed' };
  });

export const buildCategoryMixGuidance = (
  entry: Pick<CompanyCatalogEntry, 'genre' | 'tier'>,
): string => {
  if (entry.genre === 'strategy_consulting') {
    return 'Roughly: 10–12 Technical (case-interview business problems), 4–6 Behavioral, 4–6 Culture, 0 Coding — do NOT use the Coding category';
  }
  if (entry.tier === 'high') {
    return 'Roughly: 6–8 Technical, 4–6 Culture, 4–6 Coding, 5–7 Behavioral';
  }
  if (entry.tier === 'medium') {
    return 'Roughly: 4–5 Technical, 3–4 Culture, 3–4 Coding, 4–5 Behavioral';
  }
  return 'Roughly: 2–3 Technical, 2 Culture, 2 Coding, 2–3 Behavioral';
};

export const buildConceptPromptContext = (
  entry: Pick<CompanyCatalogEntry, 'genre' | 'label'>,
): string => {
  if (entry.genre === 'strategy_consulting') {
    return `Draw on well-known, publicly-discussed patterns about ${entry.label}'s case-interview style — structured business problem-solving, market sizing, profitability frameworks, data interpretation, and client recommendation synthesis — NOT software-engineering coding rounds.`;
  }
  return 'Draw on well-known, publicly-discussed patterns about this company\'s interview style and focus areas when you have reasonable confidence — e.g. technical domains the company is recognized for, publicly stated values/culture principles, and realistic software-engineering topics for this industry.';
};

export const buildSpecificityRules = (
  entry: Pick<CompanyCatalogEntry, 'label'>,
): string =>
  `- Mark specificity "company" ONLY when the concept explicitly names ${entry.label} or a widely-known unique public hiring pattern unmistakably tied to that firm.
- Mark "industry" for standard interview topics that apply across similar employers (most Behavioral topics, generic culture values, typical case/technical patterns).
- Mark "mixed" when the topic is industry-standard but clearly framed for this employer type.
- Do NOT mark generic Behavioral or Culture topics as "company" just because the batch targets ${entry.label}.`;

/** Explicit replacements for known bad TCS (and similar) concepts. */
export const IT_SERVICES_CODING_REPLACEMENTS: Record<string, string> = {
  'debugging concurrency issues using thread synchronization techniques':
    'Implementing basic OOP concepts in Java — classes, inheritance, and polymorphism with a simple example',
  'applying object-oriented design patterns for maintainable codebases':
    'Writing SQL queries with JOINs and GROUP BY for a basic database schema',
};

const normalizeKey = (label: string) => label.trim().toLowerCase().replace(/\s+/g, ' ');

export const lookupItServicesCodingReplacement = (label: string) => {
  const key = normalizeKey(label);
  if (IT_SERVICES_CODING_REPLACEMENTS[key]) return IT_SERVICES_CODING_REPLACEMENTS[key];
  return null;
};

export const IT_SERVICES_ENTRY_CODING_POOL: ConceptDraft[] = [
  { category: 'Coding', conceptLabel: 'Simple array and string manipulation with loops', specificity: 'industry' },
  { category: 'Coding', conceptLabel: 'Basic sorting and searching on small arrays', specificity: 'industry' },
  { category: 'Coding', conceptLabel: 'Fundamental OOP — classes, inheritance, and polymorphism', specificity: 'industry' },
  { category: 'Coding', conceptLabel: 'Writing SQL with SELECT, JOIN, and GROUP BY', specificity: 'industry' },
  { category: 'Coding', conceptLabel: 'Simple pattern and logic problems for fresher screening', specificity: 'industry' },
  { category: 'Coding', conceptLabel: 'Finding duplicates or reverse words in a string', specificity: 'industry' },
  { category: 'Coding', conceptLabel: 'Basic exception handling in Java or C# with a small example', specificity: 'industry' },
];

let replacementPoolIndex = 0;

export const nextItServicesEntryCodingConcept = (): ConceptDraft => {
  const item = IT_SERVICES_ENTRY_CODING_POOL[replacementPoolIndex % IT_SERVICES_ENTRY_CODING_POOL.length];
  replacementPoolIndex += 1;
  return { ...item };
};

export const resetItServicesReplacementPool = () => {
  replacementPoolIndex = 0;
};

export const sanitizeConceptsForGenre = (
  concepts: ConceptDraft[],
  entry: Pick<CompanyCatalogEntry, 'genre' | 'label'>,
): ConceptDraft[] => {
  if (entry.genre === 'strategy_consulting') {
    return concepts.map((concept) => {
      if (
        concept.category === 'Coding'
        || (concept.category === 'Technical' && isSoftwareEngineeringCodingConcept(concept.conceptLabel))
      ) {
        const replacement = nextStrategyCaseConcept();
        return {
          category: 'Technical',
          conceptLabel: replacement.conceptLabel,
          specificity: 'industry',
        };
      }
      return concept;
    });
  }

  if (entry.genre !== 'it_services') return concepts;

  return concepts.map((concept) => {
    const explicit = concept.category === 'Coding'
      ? lookupItServicesCodingReplacement(concept.conceptLabel)
      : null;
    if (explicit) {
      return { ...concept, conceptLabel: explicit, specificity: concept.specificity ?? 'industry' };
    }

    if (concept.category === 'Coding' && isAdvancedItServicesCodingConcept(concept.conceptLabel)) {
      const replacement = nextItServicesEntryCodingConcept();
      return {
        ...concept,
        conceptLabel: `${replacement.conceptLabel} (${entry.label} fresher screen)`,
        specificity: 'industry',
      };
    }

    if (concept.category === 'Technical' && isAdvancedItServicesTechnicalConcept(concept.conceptLabel)) {
      return {
        ...concept,
        conceptLabel: `Explaining REST APIs and basic SQL for client delivery projects (${entry.label})`,
        specificity: concept.specificity ?? 'mixed',
      };
    }

    return concept;
  });
};

/** Generic role-pool safety pass: remove malformed/duplicate labels and enforce HR category rules. */
export const sanitizeRoleConcepts = (
  concepts: ConceptDraft[],
  options: { hrOnly?: boolean } = {},
): ConceptDraft[] => {
  const seen = new Set<string>();
  const sanitized: ConceptDraft[] = [];
  for (const concept of concepts) {
    const label = String(concept.conceptLabel || '').trim().replace(/\s+/g, ' ');
    if (label.length < 8 || label.length > 500 || isBrokenFallbackConceptLabel(label)) continue;
    if (isTemplatedRoleFallbackLabel(label)) continue;
    if (options.hrOnly && !['Behavioral', 'Culture'].includes(concept.category)) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    sanitized.push({
      ...concept,
      conceptLabel: label,
      specificity: concept.specificity === 'company' ? 'industry' : concept.specificity ?? 'industry',
    });
  }
  return sanitized;
};

export const buildGenreDifficultyGuidance = (
  entry: Pick<CompanyCatalogEntry, 'genre' | 'tier' | 'label'>,
): string => {
  if (entry.genre === 'it_services') {
    return `Genre difficulty (IT Services / Consulting — applies regardless of tier "${entry.tier}"):
- ${entry.label} and similar IT Services/Consulting firms are known for high-volume fresher/entry-level hiring with basic technical screening rounds.
- Coding concepts MUST default to basic/entry-level: simple array/string manipulation, basic sorting/searching, fundamental OOP (inheritance, polymorphism, interfaces with simple examples), basic SQL (SELECT, JOIN, GROUP BY), and simple pattern/logic problems.
- Do NOT generate senior-level Coding concepts: advanced concurrency, thread synchronization, formal design pattern names, system-design-heavy topics, complex algorithms, or "refactoring legacy codebase" framing.
- Technical concepts may still reference legitimate company-specific technology or domain knowledge (e.g. banking platforms, SAP integration, client-domain expertise) — the difficulty correction applies primarily to Coding, not removing genuine company specificity elsewhere.
- Tier reflects company popularity/traffic for pool sizing, NOT implied interview difficulty for this genre.`;
  }

  if (entry.genre === 'strategy_consulting') {
    return `Genre difficulty (Strategy Consulting — applies regardless of tier "${entry.tier}"):
- ${entry.label} and similar strategy consulting firms hire primarily through CASE INTERVIEWS: structured business problem breakdown, market sizing, profitability analysis, chart/data interpretation, and executive-style recommendations.
- Do NOT generate software-engineering Coding concepts (arrays, strings, algorithms, SQL, OOP coding exercises, leetcode-style prompts). There is no traditional coding round.
- Use the Technical category for case-interview topic areas: MECE structuring, hypothesis trees, market sizing, profitability frameworks, competitive analysis, pricing/operations/growth cases, and synthesizing a client recommendation.
- Behavioral and Culture concepts should reflect consulting norms (client impact, structured communication, teamwork under ambiguity) but stay honest — do not invent fake insider process details.
- Tier reflects company popularity/traffic for pool sizing, NOT interview difficulty.`;
  }

  if (entry.genre === 'product_tech') {
    const codingDifficulty = entry.tier === 'high'
      ? 'Coding may include advanced DSA, challenging algorithms, and system-design-lite topics appropriate for competitive product-company hiring.'
      : entry.tier === 'medium'
      ? 'Coding at solid mid-level DSA difficulty with multi-step problems.'
      : 'Coding at approachable but still meaningful product-engineering difficulty.';
    return `Genre difficulty (Product-based Tech):
- Scale Coding/Technical depth with tier. ${codingDifficulty}`;
  }

  if (entry.genre === 'fintech') {
    const codingDifficulty = entry.tier === 'high'
      ? 'Coding may include strong DSA, transaction/logic problems, and security-aware algorithmic scenarios.'
      : entry.tier === 'medium'
      ? 'Coding at moderate DSA with fintech-relevant logic (payments, validation, data integrity).'
      : 'Coding at entry-to-mid level with practical fintech fundamentals.';
    return `Genre difficulty (Fintech & Banking):
- Scale Coding/Technical depth with tier. ${codingDifficulty}`;
  }

  return '';
};

export const buildItServicesFallbackSeed = (): ConceptDraft[] => [
  { category: 'Technical', conceptLabel: 'Explaining REST APIs and SDLC phases on client projects', specificity: 'industry' },
  { category: 'Technical', conceptLabel: 'Basic SQL queries and simple database concepts for delivery work', specificity: 'industry' },
  { category: 'Culture', conceptLabel: 'Communication with non-technical stakeholders on client projects', specificity: 'industry' },
  { category: 'Coding', conceptLabel: 'Simple array and string manipulation for fresher screening', specificity: 'industry' },
  { category: 'Coding', conceptLabel: 'Fundamental OOP — inheritance and polymorphism with a basic example', specificity: 'industry' },
  { category: 'Behavioral', conceptLabel: 'Handling production escalation on a client delivery project', specificity: 'industry' },
];

export const buildProductTechFallbackSeed = (tier: ConceptTier): ConceptDraft[] => {
  const coding = tier === 'high'
    ? { category: 'Coding' as const, conceptLabel: 'Advanced array/graph problem with optimization and complexity analysis', specificity: 'industry' as const }
    : tier === 'medium'
    ? { category: 'Coding' as const, conceptLabel: 'Array/hash-map fundamentals with edge-case handling', specificity: 'industry' as const }
    : { category: 'Coding' as const, conceptLabel: 'Basic array/string manipulation with straightforward edge cases', specificity: 'industry' as const };
  return [
    { category: 'Technical', conceptLabel: 'System design for high-traffic consumer features', specificity: 'industry' },
    { category: 'Technical', conceptLabel: 'API reliability, caching, and observability trade-offs', specificity: 'industry' },
    { category: 'Culture', conceptLabel: 'Ownership and customer-obsession in delivery decisions', specificity: 'industry' },
    coding,
    { category: 'Behavioral', conceptLabel: 'Disagreement with a teammate on technical direction', specificity: 'industry' },
  ];
};

/** Detects the old padded fallback artifact: "(Company context 7)" style suffixes. */
export const BROKEN_FALLBACK_ARTIFACT_PATTERN =
  /\([^)]*\bcontext\s+\d+\)/i;

export const isBrokenFallbackConceptLabel = (label: string) =>
  BROKEN_FALLBACK_ARTIFACT_PATTERN.test(String(label || '').trim());

const personalizeFallbackLabel = (label: string, companyLabel: string) =>
  label.replace(/\{company\}/g, companyLabel).trim();

const dedupeConceptDrafts = (items: ConceptDraft[]) => {
  const seen = new Set<string>();
  const results: ConceptDraft[] = [];
  for (const item of items) {
    const key = item.conceptLabel.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    results.push(item);
  }
  return results;
};

const productTechPool = (tier: ConceptTier): ConceptDraft[] => {
  const codingHigh: ConceptDraft[] = [
    { category: 'Coding', conceptLabel: 'Graph shortest-path with complexity analysis', specificity: 'industry' },
    { category: 'Coding', conceptLabel: 'Dynamic programming subproblem with space optimization', specificity: 'industry' },
    { category: 'Coding', conceptLabel: 'Tree traversal with iterative and recursive approaches', specificity: 'industry' },
    { category: 'Coding', conceptLabel: 'Sliding window on arrays with time-complexity reasoning', specificity: 'industry' },
  ];
  const codingMid: ConceptDraft[] = [
    { category: 'Coding', conceptLabel: 'Hash-map two-sum style problem with edge cases', specificity: 'industry' },
    { category: 'Coding', conceptLabel: 'Stack-based parsing or bracket matching', specificity: 'industry' },
    { category: 'Coding', conceptLabel: 'Binary search on sorted data with off-by-one pitfalls', specificity: 'industry' },
  ];
  const codingLow: ConceptDraft[] = [
    { category: 'Coding', conceptLabel: 'Reverse words in a string with basic loops', specificity: 'industry' },
    { category: 'Coding', conceptLabel: 'Find duplicate values in a small array', specificity: 'industry' },
  ];
  const coding = tier === 'high' ? codingHigh : tier === 'medium' ? codingMid : codingLow;

  return dedupeConceptDrafts([
    ...buildProductTechFallbackSeed(tier),
    { category: 'Technical', conceptLabel: 'Designing scalable REST APIs for {company} product features', specificity: 'mixed' },
    { category: 'Technical', conceptLabel: 'Database indexing and query latency for user-facing flows', specificity: 'industry' },
    { category: 'Technical', conceptLabel: 'Feature flags, rollouts, and safe production releases', specificity: 'industry' },
    { category: 'Technical', conceptLabel: 'Monitoring, alerting, and on-call incident response', specificity: 'industry' },
    { category: 'Technical', conceptLabel: 'Mobile/web client performance and perceived latency', specificity: 'industry' },
    { category: 'Culture', conceptLabel: 'Bias for action vs. careful rollout at {company}', specificity: 'mixed' },
    { category: 'Culture', conceptLabel: 'Working backwards from customer pain points', specificity: 'industry' },
    { category: 'Culture', conceptLabel: 'Handling ambiguous requirements with incomplete data', specificity: 'industry' },
    { category: 'Behavioral', conceptLabel: 'Missed deadline on a high-visibility launch', specificity: 'industry' },
    { category: 'Behavioral', conceptLabel: 'Receiving critical code review feedback publicly', specificity: 'industry' },
    { category: 'Behavioral', conceptLabel: 'Mentoring a junior engineer through a tough bug', specificity: 'industry' },
    { category: 'Technical', conceptLabel: 'Load testing and capacity planning for peak traffic', specificity: 'industry' },
    { category: 'Technical', conceptLabel: 'Data modeling choices for analytics vs. OLTP workloads', specificity: 'industry' },
    { category: 'Technical', conceptLabel: 'Authentication, authorization, and session security basics', specificity: 'industry' },
    { category: 'Culture', conceptLabel: 'Disagree-and-commit after a heated architecture review', specificity: 'industry' },
    { category: 'Behavioral', conceptLabel: 'Prioritizing tech debt against feature pressure', specificity: 'industry' },
    ...coding,
  ]);
};

const strategyConsultingPool = (): ConceptDraft[] => dedupeConceptDrafts([
  ...STRATEGY_CASE_CONCEPT_POOL,
  { category: 'Technical', conceptLabel: 'Cost reduction case — fixed vs variable cost levers', specificity: 'industry' },
  { category: 'Technical', conceptLabel: 'Customer segmentation case with tailored go-to-market options', specificity: 'industry' },
  { category: 'Technical', conceptLabel: 'New product launch case — TAM sizing and adoption curve assumptions', specificity: 'industry' },
  { category: 'Culture', conceptLabel: 'Structured communication and top-down executive storytelling', specificity: 'industry' },
  { category: 'Culture', conceptLabel: 'Client-first mindset and professional presence in case discussions', specificity: 'industry' },
  { category: 'Culture', conceptLabel: 'Intellectual curiosity and hypothesis refinement under time pressure', specificity: 'industry' },
  { category: 'Behavioral', conceptLabel: 'Leading a team through ambiguous problem definition', specificity: 'industry' },
  { category: 'Behavioral', conceptLabel: 'Handling pushback on your recommendation from a skeptical stakeholder', specificity: 'industry' },
  { category: 'Behavioral', conceptLabel: 'Balancing speed vs rigor when data is incomplete', specificity: 'industry' },
  { category: 'Behavioral', conceptLabel: 'Explaining a quantitative mistake discovered mid-case', specificity: 'industry' },
  { category: 'Behavioral', conceptLabel: 'Influencing without authority on a cross-functional project', specificity: 'industry' },
  { category: 'Technical', conceptLabel: 'Supply chain disruption case — root cause and mitigation options', specificity: 'industry' },
  { category: 'Technical', conceptLabel: 'Digital transformation case — value pools and implementation sequencing', specificity: 'industry' },
  { category: 'Culture', conceptLabel: 'Collaborative case team dynamics and peer coaching', specificity: 'industry' },
  { category: 'Behavioral', conceptLabel: 'Why consulting and why this firm — motivation and fit', specificity: 'mixed' },
]);

const itServicesPool = (): ConceptDraft[] => dedupeConceptDrafts([
  ...buildItServicesFallbackSeed(),
  { category: 'Technical', conceptLabel: 'Agile ceremonies and sprint delivery on client accounts', specificity: 'industry' },
  { category: 'Technical', conceptLabel: 'Unit testing basics and defect triage in maintenance projects', specificity: 'industry' },
  { category: 'Technical', conceptLabel: 'Version control workflow with Git branching for team delivery', specificity: 'industry' },
  { category: 'Technical', conceptLabel: 'Writing clear technical documentation for client handoff', specificity: 'industry' },
  { category: 'Culture', conceptLabel: 'Adapting communication style for global client stakeholders', specificity: 'industry' },
  { category: 'Culture', conceptLabel: 'Working under strict SLA timelines on support projects', specificity: 'industry' },
  { category: 'Coding', conceptLabel: 'Finding max/min in an array with simple loops', specificity: 'industry' },
  { category: 'Coding', conceptLabel: 'Check palindrome string with two-pointer basics', specificity: 'industry' },
  { category: 'Coding', conceptLabel: 'Count frequency of characters in a string', specificity: 'industry' },
  { category: 'Behavioral', conceptLabel: 'Learning a new tech stack quickly for a client project', specificity: 'industry' },
  { category: 'Behavioral', conceptLabel: 'Handling conflicting priorities from two project managers', specificity: 'industry' },
  { category: 'Behavioral', conceptLabel: 'Quality vs speed trade-off near a release date', specificity: 'industry' },
  { category: 'Technical', conceptLabel: 'Debugging a production defect reported by a client UAT team', specificity: 'industry' },
  { category: 'Technical', conceptLabel: 'Integrating third-party APIs with retry and timeout handling', specificity: 'industry' },
  { category: 'Technical', conceptLabel: 'Writing unit tests for a legacy Java module', specificity: 'industry' },
  { category: 'Culture', conceptLabel: 'Onboarding quickly onto an ongoing client engagement', specificity: 'industry' },
  { category: 'Coding', conceptLabel: 'Sum elements in a matrix row using nested loops', specificity: 'industry' },
  { category: 'Coding', conceptLabel: 'Remove duplicates from a sorted array in-place', specificity: 'industry' },
  { category: 'Behavioral', conceptLabel: 'Explaining a delay to a client project manager', specificity: 'industry' },
  { category: 'Behavioral', conceptLabel: 'Receiving constructive feedback in a performance review', specificity: 'industry' },
]);

const fintechPool = (tier: ConceptTier): ConceptDraft[] => {
  const coding: ConceptDraft = tier === 'high'
    ? { category: 'Coding', conceptLabel: 'Idempotent payment retry logic with deduplication', specificity: 'industry' }
    : { category: 'Coding', conceptLabel: 'Validate transaction amounts and ledger balance rules', specificity: 'industry' };
  return dedupeConceptDrafts([
    { category: 'Technical', conceptLabel: 'Data integrity and idempotency in payment flows', specificity: 'industry' },
    { category: 'Technical', conceptLabel: 'Fraud detection signals and secure API design', specificity: 'industry' },
    { category: 'Technical', conceptLabel: 'PCI-aware handling of sensitive payment metadata', specificity: 'industry' },
    { category: 'Technical', conceptLabel: 'Reconciliation between payment gateway and internal ledger', specificity: 'industry' },
    { category: 'Technical', conceptLabel: 'KYC workflow design and audit-friendly logging', specificity: 'industry' },
    { category: 'Culture', conceptLabel: 'Risk awareness and compliance-minded engineering', specificity: 'industry' },
    { category: 'Culture', conceptLabel: 'Explaining regulatory constraints to product partners', specificity: 'industry' },
    { category: 'Culture', conceptLabel: 'Handling customer money incidents with urgency and calm', specificity: 'industry' },
    coding,
    { category: 'Coding', conceptLabel: 'Rate-limiter design for checkout APIs', specificity: 'industry' },
    { category: 'Coding', conceptLabel: 'Detect duplicate transactions in an event stream', specificity: 'industry' },
    { category: 'Behavioral', conceptLabel: 'Trade-off between speed and regulatory correctness', specificity: 'industry' },
    { category: 'Behavioral', conceptLabel: 'Incident response when a payment pipeline stalls', specificity: 'industry' },
    { category: 'Behavioral', conceptLabel: 'Pushing back on a feature that weakens audit trails', specificity: 'industry' },
    { category: 'Behavioral', conceptLabel: 'Owning a reconciliation bug discovered after release', specificity: 'industry' },
  ]);
};

const coreEngineeringPool = (): ConceptDraft[] => dedupeConceptDrafts([
  { category: 'Technical', conceptLabel: 'Embedded reliability and sensor/data validation', specificity: 'industry' },
  { category: 'Technical', conceptLabel: 'Safety-critical software design trade-offs', specificity: 'industry' },
  { category: 'Technical', conceptLabel: 'Hardware-software interface debugging on the factory floor', specificity: 'industry' },
  { category: 'Technical', conceptLabel: 'Telemetry pipelines for industrial equipment monitoring', specificity: 'industry' },
  { category: 'Technical', conceptLabel: 'Firmware update rollback and device fleet management', specificity: 'industry' },
  { category: 'Technical', conceptLabel: 'Signal noise filtering and calibration in sensor networks', specificity: 'industry' },
  { category: 'Culture', conceptLabel: 'Cross-functional work with hardware/domain experts', specificity: 'industry' },
  { category: 'Culture', conceptLabel: 'Documentation discipline for regulated manufacturing', specificity: 'industry' },
  { category: 'Culture', conceptLabel: 'Quality gates before shipping to production lines', specificity: 'industry' },
  { category: 'Coding', conceptLabel: 'Time-series anomaly detection on sensor readings', specificity: 'industry' },
  { category: 'Coding', conceptLabel: 'State-machine logic for equipment control sequences', specificity: 'industry' },
  { category: 'Coding', conceptLabel: 'Parse and validate CSV telemetry uploads', specificity: 'industry' },
  { category: 'Behavioral', conceptLabel: 'Late requirement change on a regulated product', specificity: 'industry' },
  { category: 'Behavioral', conceptLabel: 'Escalating a safety concern during crunch time', specificity: 'industry' },
  { category: 'Behavioral', conceptLabel: 'Coordinating with suppliers when a component fails validation', specificity: 'industry' },
]);

export const getIndustryFallbackPool = (
  entry: Pick<CompanyCatalogEntry, 'genre' | 'tier' | 'label'>,
): ConceptDraft[] => {
  if (entry.genre === 'product_tech') return productTechPool(entry.tier);
  if (entry.genre === 'strategy_consulting') return strategyConsultingPool();
  if (entry.genre === 'it_services') return itServicesPool();
  if (entry.genre === 'fintech') return fintechPool(entry.tier);
  if (entry.genre === 'core_engineering') return coreEngineeringPool();
  return itServicesPool();
};

/**
 * Industry fallback when AI generation is unavailable.
 * Returns only genuinely distinct concepts — never pads with numbered "(context N)" duplicates.
 */
export const buildIndustryFallbackConceptSet = (
  entry: Pick<CompanyCatalogEntry, 'genre' | 'tier' | 'label'>,
  count: number,
): ConceptDraft[] => {
  const pool = getIndustryFallbackPool(entry);
  const results: ConceptDraft[] = [];
  const seen = new Set<string>();

  for (const item of pool) {
    if (results.length >= count) break;
    const conceptLabel = personalizeFallbackLabel(item.conceptLabel, entry.label);
    if (isBrokenFallbackConceptLabel(conceptLabel)) continue;
    const key = conceptLabel.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ ...item, conceptLabel });
  }

  return results;
};

export const genreLabelFor = (genre: CompanyGenre) => GENRE_LABELS[genre];
