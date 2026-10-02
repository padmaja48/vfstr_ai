import type { ConceptCategory } from '../models/QuestionConcept';

export const ROLE_CONCEPT_KEYS = [
  'sde',
  'data_analyst',
  'ai_ml',
  'frontend',
  'backend',
  'qa',
  'hr_behavioral',
] as const;

export type RoleConceptKey = (typeof ROLE_CONCEPT_KEYS)[number];

type RoleFocus = {
  topic: string;
  category: ConceptCategory;
};

export type RoleConceptCatalogEntry = {
  key: RoleConceptKey;
  label: string;
  aliases: string[];
  focusAreas: RoleFocus[];
  guidance: string;
};

const TECHNICAL_VARIANTS = [
  'fundamentals and terminology',
  'failure modes and diagnostic signals',
  'practical trade-offs in a project',
  'validation and quality checks',
  'project or workplace example',
];

const CODING_VARIANTS = [
  'implementation approach and edge cases',
  'complexity analysis and test strategy',
  'debugging and failure handling',
  'scalable or maintainable solution choices',
  'project application and verification',
];

const BEHAVIORAL_VARIANTS = [
  'a real team situation',
  'a difficult decision and its outcome',
  'handling disagreement or ambiguity',
  'communication with a stakeholder',
  'reflection, learning, and improvement',
];

/** All em-dash suffix fragments used by buildRoleFallbackConceptSet padding. */
export const ROLE_FALLBACK_VARIANT_SUFFIXES = [
  ...TECHNICAL_VARIANTS,
  ...CODING_VARIANTS,
  ...BEHAVIORAL_VARIANTS,
] as const;

const ROLE_FALLBACK_VARIANT_SET = new Set(
  ROLE_FALLBACK_VARIANT_SUFFIXES.map((variant) => variant.toLowerCase()),
);

/** Detects "{topic} — {variant}" rows from buildRoleFallbackConceptSet. */
export const isTemplatedRoleFallbackLabel = (label: string) => {
  const trimmed = String(label || '').trim();
  const separator = ' — ';
  const index = trimmed.lastIndexOf(separator);
  if (index < 0) return false;
  const suffix = trimmed.slice(index + separator.length).trim().toLowerCase();
  return ROLE_FALLBACK_VARIANT_SET.has(suffix);
};

const focus = (topic: string, category: ConceptCategory): RoleFocus => ({ topic, category });

export const ROLE_CONCEPT_CATALOG: RoleConceptCatalogEntry[] = [
  {
    key: 'sde',
    label: 'SDE',
    aliases: ['sde', 'software engineer', 'software development engineer', 'software developer', 'software development'],
    focusAreas: [
      focus('data structures and algorithms', 'Coding'),
      focus('algorithmic problem solving and complexity', 'Coding'),
      focus('system design fundamentals', 'Technical'),
      focus('object-oriented design', 'Technical'),
      focus('API design and debugging', 'Technical'),
      focus('project and resume technical depth', 'Technical'),
      focus('ownership of engineering work', 'Behavioral'),
      focus('collaboration with engineering teammates', 'Culture'),
      focus('technical communication with stakeholders', 'Behavioral'),
      focus('learning a new engineering tool or system', 'Culture'),
    ],
    guidance: 'Cover DSA/algorithms, system-design basics, OOP, project/resume technical depth, APIs/debugging, and behavioral ownership/collaboration.',
  },
  {
    key: 'data_analyst',
    label: 'Data Analyst',
    aliases: ['data analyst', 'analytics analyst', 'business intelligence', 'bi analyst', 'data analytics'],
    focusAreas: [
      focus('SQL querying and data modeling', 'Coding'),
      focus('Excel and BI workflow fundamentals', 'Technical'),
      focus('data visualization and dashboard choices', 'Technical'),
      focus('statistics and uncertainty', 'Technical'),
      focus('A/B testing and experiment analysis', 'Coding'),
      focus('data cleaning and quality checks', 'Technical'),
      focus('storytelling with data', 'Culture'),
      focus('explaining findings to stakeholders', 'Culture'),
      focus('business impact from an analysis', 'Behavioral'),
      focus('ambiguity in requirements and metrics', 'Behavioral'),
    ],
    guidance: 'Cover SQL, visualization, statistics, Excel/BI, data cleaning, A/B testing, analytical storytelling, and stakeholder communication.',
  },
  {
    key: 'ai_ml',
    label: 'AI/ML Engineer',
    aliases: ['ai/ml engineer', 'ai engineer', 'ml engineer', 'machine learning engineer', 'artificial intelligence engineer'],
    focusAreas: [
      focus('machine learning fundamentals', 'Technical'),
      focus('ML algorithms and implementation reasoning', 'Coding'),
      focus('model evaluation and experiment design', 'Technical'),
      focus('feature engineering and data preparation', 'Technical'),
      focus('model deployment and serving', 'Technical'),
      focus('ML pipelines and reproducibility', 'Coding'),
      focus('project and model trade-offs', 'Technical'),
      focus('responsible AI and communication of limitations', 'Culture'),
      focus('ownership of an ML experiment or incident', 'Behavioral'),
      focus('collaboration with product and data teams', 'Culture'),
    ],
    guidance: 'Cover ML fundamentals, algorithms, evaluation, feature engineering, deployment, pipelines, project trade-offs, and responsible collaboration.',
  },
  {
    key: 'frontend',
    label: 'Frontend',
    aliases: ['frontend', 'frontend developer', 'front end developer', 'ui developer', 'web developer'],
    focusAreas: [
      focus('JavaScript fundamentals and implementation', 'Coding'),
      focus('React component design and state', 'Coding'),
      focus('CSS layout and browser rendering', 'Technical'),
      focus('frontend performance and loading', 'Technical'),
      focus('web accessibility', 'Technical'),
      focus('state management and data flow', 'Technical'),
      focus('debugging a user-facing defect', 'Behavioral'),
      focus('product and engineering trade-offs', 'Culture'),
      focus('collaboration with designers and backend engineers', 'Culture'),
      focus('communicating a frontend delivery risk', 'Behavioral'),
    ],
    guidance: 'Cover JavaScript/React, CSS/layout, browser rendering, performance, accessibility, state, debugging, and cross-functional collaboration.',
  },
  {
    key: 'backend',
    label: 'Backend',
    aliases: ['backend', 'backend developer', 'back end developer', 'server-side engineer', 'api developer'],
    focusAreas: [
      focus('API design and implementation', 'Coding'),
      focus('SQL and NoSQL database choices', 'Coding'),
      focus('caching and consistency', 'Technical'),
      focus('authentication and authorization', 'Technical'),
      focus('scalability and capacity planning', 'Technical'),
      focus('microservices and service boundaries', 'Technical'),
      focus('production incident ownership', 'Behavioral'),
      focus('reliability and operational culture', 'Culture'),
      focus('explaining backend constraints to stakeholders', 'Behavioral'),
      focus('collaboration across an API contract', 'Culture'),
    ],
    guidance: 'Cover APIs, SQL/NoSQL, caching, auth, scalability, capacity, microservices, reliability, incidents, and cross-team communication.',
  },
  {
    key: 'qa',
    label: 'QA',
    aliases: ['qa', 'qa engineer', 'quality assurance', 'test engineer', 'sdet', 'software test engineer'],
    focusAreas: [
      focus('testing fundamentals and test strategy', 'Technical'),
      focus('test-case design and boundary coverage', 'Technical'),
      focus('Selenium or Cypress automation', 'Coding'),
      focus('bug triage and root-cause isolation', 'Technical'),
      focus('API testing and contract validation', 'Coding'),
      focus('automation maintainability and CI quality gates', 'Technical'),
      focus('quality ownership before a release', 'Culture'),
      focus('communicating a critical defect', 'Behavioral'),
      focus('testing under ambiguous requirements', 'Behavioral'),
      focus('collaboration with developers and product teams', 'Culture'),
    ],
    guidance: 'Cover testing, cases, Selenium/Cypress automation, bug triage, API testing, CI quality gates, and quality-focused collaboration.',
  },
  {
    key: 'hr_behavioral',
    label: 'HR / Behavioral',
    aliases: ['hr', 'hr behavioral', 'hr / behavioral', 'behavioral', 'behavioural', 'human resources'],
    focusAreas: [
      focus('communication and clarity', 'Behavioral'),
      focus('teamwork and collaboration', 'Culture'),
      focus('conflict resolution', 'Behavioral'),
      focus('ownership and accountability', 'Behavioral'),
      focus('adaptability and learning', 'Culture'),
      focus('handling feedback', 'Behavioral'),
      focus('prioritization under pressure', 'Behavioral'),
      focus('integrity and professional judgment', 'Culture'),
      focus('motivation and career direction', 'Behavioral'),
      focus('inclusion and respect at work', 'Culture'),
    ],
    guidance: 'Use only behavioral and culture topics: communication, teamwork, conflict, ownership, adaptability, feedback, prioritization, integrity, motivation, and inclusion.',
  },
];

export const getRoleConceptEntry = (role: string | undefined): RoleConceptCatalogEntry | undefined => {
  const normalized = String(role || '').trim().toLowerCase();
  if (!normalized) return undefined;
  return ROLE_CONCEPT_CATALOG.find((entry) =>
    entry.key === normalized
    || entry.aliases.some((alias) => normalized === alias || normalized.includes(alias)),
  );
};

export const roleCategoryTargets = (entry: RoleConceptCatalogEntry, target = 50) => {
  const base = entry.focusAreas.map((area) => area.category);
  const counts = Object.fromEntries((['Technical', 'Culture', 'Coding', 'Behavioral'] as ConceptCategory[]).map((category) => [category, 0])) as Record<ConceptCategory, number>;
  base.forEach((category) => { counts[category] += 5; });
  const current = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (current < target) counts.Technical += target - current;
  return counts;
};

export const buildRoleFallbackConceptSet = (entry: RoleConceptCatalogEntry, target = 50) => {
  const drafts: Array<{ category: ConceptCategory; conceptLabel: string; specificity: 'industry' }> = [];
  for (const area of entry.focusAreas) {
    const variants = area.category === 'Coding'
      ? CODING_VARIANTS
      : area.category === 'Behavioral' || area.category === 'Culture'
      ? BEHAVIORAL_VARIANTS
      : TECHNICAL_VARIANTS;
    variants.forEach((variant) => {
      drafts.push({
        category: area.category,
        conceptLabel: `${area.topic} — ${variant}`,
        specificity: 'industry',
      });
    });
  }
  return drafts.slice(0, target);
};

const ROLE_CONCEPT_CATEGORIES: ConceptCategory[] = ['Technical', 'Culture', 'Coding', 'Behavioral'];

export const ROLE_CONCEPT_QUALITY_EXAMPLES = {
  goodBehavioral: [
    'Detailing how you prioritize tasks when multiple stakeholders request changes',
    'Explaining how you handled a missed deadline and what you changed afterward',
    'Describing how you resolved disagreement with a teammate on a technical approach',
  ],
  badBehavioral: [
    'Effective communication',
    'Handling failure and learning from mistakes',
    'Teamwork and collaboration',
  ],
  goodTechnical: [
    'Designing circuit-breaker pattern to improve service reliability',
    'Evaluating trade-offs between relational and document databases for a data model',
  ],
  badTechnical: [
    'System design fundamentals',
    'Database basics',
  ],
} as const;

const formatRoleFocusAreas = (
  entry: RoleConceptCatalogEntry,
  categories?: ConceptCategory[],
) => {
  const allowed = categories?.length ? new Set(categories) : null;
  const lines = entry.focusAreas
    .filter((area) => !allowed || allowed.has(area.category))
    .map((area) => `- ${area.category}: ${area.topic}`);
  return lines.length ? lines.join('\n') : entry.guidance;
};

/** Shared prompt for full-role and partial-section role concept generation. */
export const buildRoleConceptGenerationPrompt = (input: {
  entry: RoleConceptCatalogEntry;
  counts: Partial<Record<ConceptCategory, number>>;
  officialHonesty: string;
  continuationNote?: string;
}) => {
  const countLines = ROLE_CONCEPT_CATEGORIES
    .filter((category) => (input.counts[category] ?? 0) > 0)
    .map((category) => `${category} ${input.counts[category]}`)
    .join(', ');
  const total = ROLE_CONCEPT_CATEGORIES.reduce((sum, category) => sum + (input.counts[category] ?? 0), 0);
  const categories = ROLE_CONCEPT_CATEGORIES.filter((category) => (input.counts[category] ?? 0) > 0);
  const focusBlock = formatRoleFocusAreas(input.entry, categories.length ? categories : undefined);

  return `${input.continuationNote ? `${input.continuationNote}\n\n` : ''}Generate exactly ${total} SHORT interview topic concepts (NOT full questions) for generic ${input.entry.label} mock interviews.

Role focus: ${input.entry.guidance}
Required category counts: ${countLines}.

Anchor topics to develop (use as inspiration — expand into distinct, specific concept labels):
${focusBlock}

Rules:
- Each conceptLabel is 8–18 words and must describe a specific, interview-ready topic area — not a finished question.
- Use only the required role topics; do not invent company-specific interview claims.
- Concepts must be distinct, practical, and suitable for a fresher-to-early-career mock interview.
- HR / Behavioral must contain no Technical or Coding concepts.
- Behavioral and Culture labels must imply a concrete situation, decision, stakeholder, or professional skill — not vague values or themes.
- Prefer action-oriented, role-specific phrasing where natural (e.g. "Explaining how you...", "Detailing how you...", "Describing how you handled...").
- Technical and Coding labels must name a concrete technique, pattern, trade-off, or implementation concern relevant to ${input.entry.label} work.
- Quality bar — GOOD Behavioral: ${ROLE_CONCEPT_QUALITY_EXAMPLES.goodBehavioral.map((label) => `"${label}"`).join('; ')}.
- Quality bar — BAD (too generic, do NOT produce): ${ROLE_CONCEPT_QUALITY_EXAMPLES.badBehavioral.map((label) => `"${label}"`).join('; ')}.
- Quality bar — GOOD Technical: ${ROLE_CONCEPT_QUALITY_EXAMPLES.goodTechnical.map((label) => `"${label}"`).join('; ')}.
- Reject templated filler: do NOT append boilerplate suffixes after an em dash such as " — a real team situation" or " — fundamentals and terminology". Write one substantive phrase instead.
- ${input.officialHonesty}

Return ONLY JSON:
{
  "concepts": [
    { "category": "Technical"|"Culture"|"Coding"|"Behavioral", "conceptLabel": string, "specificity": "industry" }
  ]
}`;
};

