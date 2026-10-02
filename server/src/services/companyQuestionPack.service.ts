import type { GeneratedQuestion } from './ai.service';
import type { CompanyQuestionEntry, ExperienceLevel } from './promptBuilder';
import {
  companyQuestionsToGenerated,
  ensureCompanyQuestions,
  isMeaninglessCompanyQuestion,
} from './companyQuestionResearch.service';
import { COMPANY_LABELS, getCompanyInterviewGuidance } from './companyQuestions.service';
import { slugifyCompanyName } from './companyQuestionBank';
import { buildConceptBasedCompanyQuestions } from './questionConcept.service';

export type CompanyQuestionMode = 'verified' | 'web_research' | 'role_based' | 'generic' | 'concept_pool' | 'none';

export type CompanyQuestionPack = {
  questions: GeneratedQuestion[];
  mode: CompanyQuestionMode;
  companyLabel: string;
  composition: {
    culture: number;
    technical: number;
    coding: number;
  };
};

const yearTag = () => `web ${new Date().getFullYear()}`;

const CULTURE_BY_COMPANY: Record<string, string> = {
  amazon:
    'Amazon interviews often explore ownership and customer impact. Tell me about a time you owned a problem end-to-end — what trade-offs did you make, and what was the customer or user outcome?',
  google:
    'Google-style interviews value clear reasoning under ambiguity. Tell me about a time you had to solve a vague problem with incomplete information — how did you structure your approach?',
  microsoft:
    'Microsoft often looks for growth mindset and collaboration. Tell me about a time you received critical feedback on your work — what did you change afterward?',
  meta:
    'Meta-style interviews often probe impact and moving fast with quality. Tell me about a time you shipped something quickly — how did you protect quality while moving fast?',
  tcs:
    'TCS roles often emphasize client delivery, adaptability, and clear communication. Which project from your resume best shows you can learn quickly and communicate with stakeholders?',
  infosys:
    'Infosys interviews often check communication and project ownership. Tell me about a project where you had to explain a technical decision to someone non-technical.',
  accenture:
    'Accenture-style interviews often include client scenarios. Tell me about a time you clarified unclear requirements before building a solution — what did you ask, and what changed?',
  wipro:
    'Wipro interviews often value adaptability in delivery teams. Tell me about a time requirements changed late — how did you adjust without breaking the timeline?',
  cognizant:
    'Cognizant-style interviews often probe teamwork in delivery settings. Tell me about a time you worked across roles to get a feature shipped.',
  deloitte:
    'Deloitte-style interviews often mix problem-solving with client awareness. Tell me about a time you balanced technical correctness with business deadlines.',
};

const ROLE_BASED_TECHNICAL = (company: string, experienceLevel: ExperienceLevel): CompanyQuestionEntry[] => {
  if (experienceLevel === 'fresher') {
    return [
      {
        question: `For a role at a company like ${company}, explain the difference between a stack and a queue, and give one real place you would use each in an application.`,
        type: 'technical',
        source: 'role-based',
      },
      {
        question: `Walk me through how a REST API request flows from the client to the database and back. Where would you add validation and error handling?`,
        type: 'technical',
        source: 'role-based',
      },
      {
        question: `What is an index in a database, and when would adding one help or hurt performance?`,
        type: 'technical',
        source: 'role-based',
      },
      {
        question: `Explain OOP inheritance vs composition using a small example from one of your projects.`,
        type: 'technical',
        source: 'role-based',
      },
    ];
  }

  return [
    {
      question: `Describe a production issue you diagnosed. What signals did you check first, and what was the root cause?`,
      type: 'technical',
      source: 'role-based',
    },
    {
      question: `How would you design pagination and filtering for a high-traffic API without overloading the database?`,
      type: 'technical',
      source: 'role-based',
    },
    {
      question: `Tell me about a technical trade-off you made between speed of delivery and long-term maintainability. What did you choose and why?`,
      type: 'technical',
      source: 'role-based',
    },
    {
      question: `How do you approach observability for a service you own — logs, metrics, alerts — and what would you page on?`,
      type: 'technical',
      source: 'role-based',
    },
  ];
};

const ROLE_BASED_CODING = (company: string, experienceLevel: ExperienceLevel): CompanyQuestionEntry => {
  if (experienceLevel === 'fresher') {
    return {
      question: `Let's do a coding-style question similar to what companies like ${company} use for fundamentals. Given an array of integers and a target, return indices of two numbers that add up to the target. Explain your approach, edge cases, and time/space complexity.`,
      type: 'coding',
      source: 'role-based',
    };
  }

  return {
    question: `Coding round style: given a stream of integers, design how you would continuously return the median. Explain data structures, complexity, and edge cases.`,
    type: 'coding',
    source: 'role-based',
  };
};

const cultureQuestionFor = (companyLabel: string, slug: string): CompanyQuestionEntry => {
  const known = CULTURE_BY_COMPANY[slug];
  if (known) {
    return { question: known, type: 'behavioral', source: 'verified-culture' };
  }

  const guidance = getCompanyInterviewGuidance(companyLabel);
  const topic = guidance?.preferredTopics?.[0] ?? 'ownership';
  return {
    question: `At a company like ${companyLabel}, interviewers often care about ${topic}. Tell me about a time you demonstrated that — what was the situation, what did you do, and what changed?`,
    type: 'behavioral',
    source: 'role-based',
  };
};

const pickByType = (
  entries: CompanyQuestionEntry[],
  types: CompanyQuestionEntry['type'][],
  limit: number,
) => entries.filter((entry) => types.includes(entry.type)).slice(0, limit);

const tagSource = (entry: CompanyQuestionEntry, mode: CompanyQuestionMode): CompanyQuestionEntry => {
  if (entry.source) return entry;
  if (mode === 'verified') return { ...entry, source: 'verified' };
  if (mode === 'web_research') return { ...entry, source: yearTag() };
  return { ...entry, source: 'role-based' };
};

const lightlyParaphraseForResume = (
  entry: CompanyQuestionEntry,
  resumeProject?: string,
): CompanyQuestionEntry => {
  if (!resumeProject || entry.type === 'coding') return entry;
  if (/your (resume|project)/i.test(entry.question)) return entry;
  if (entry.type === 'behavioral') return entry;

  // Tie one technical question back to a resume project without inventing company claims.
  return {
    ...entry,
    question: `${entry.question.replace(/\?$/, '')}? If it helps, ground your answer in ${resumeProject}.`,
  };
};

/**
 * Ideal company block:
 * 1 culture/principles + 2–4 technical + 1 coding/fundamentals
 * Priority: verified bank → web research → role-shaped industry questions
 */
export const buildCompanyQuestionPack = async ({
  companyName,
  role,
  experienceLevel,
  resumeProject,
  resumeSkills,
  excludedConceptIds,
  studentConceptHistory,
}: {
  companyName: string;
  role: string;
  experienceLevel: ExperienceLevel;
  resumeProject?: string;
  resumeSkills?: string[];
  excludedConceptIds?: string[];
  studentConceptHistory?: Array<{ conceptId: string; lastUsedAt?: string }>;
}): Promise<CompanyQuestionPack> => {
  const slug = slugifyCompanyName(companyName);
  const companyLabel = COMPANY_LABELS[slug] ?? companyName;
  const technicalCount = experienceLevel === 'fresher' ? 3 : 4;
  const expectedConceptSlots = 1 + technicalCount + 1;

  const conceptQuestions = await buildConceptBasedCompanyQuestions({
    companyName,
    companyLabel,
    role,
    experienceLevel,
    resumeProject,
    resumeSkills,
    excludedConceptIds,
    studentConceptHistory,
  }).catch(() => [] as (GeneratedQuestion & { conceptId?: string })[]);

  if (conceptQuestions.length >= expectedConceptSlots) {
    return {
      questions: conceptQuestions,
      mode: 'concept_pool',
      companyLabel,
      composition: {
        culture: 1,
        technical: technicalCount,
        coding: 1,
      },
    };
  }

  const bankResult = await ensureCompanyQuestions({
    companyName,
    companyLabel,
    role,
    experienceLevel,
  }).catch(() => ({
    questions: [] as CompanyQuestionEntry[],
    mode: 'generic' as const,
    companyLabel,
    fromCache: false,
  }));

  const mode: CompanyQuestionMode =
    bankResult.mode === 'verified'
      ? 'verified'
      : bankResult.mode === 'web_research'
      ? 'web_research'
      : bankResult.questions.length
      ? 'generic'
      : 'role_based';

  const cleaned = (bankResult.questions ?? [])
    .filter((entry) => !isMeaninglessCompanyQuestion(entry.question))
    .map((entry) => tagSource(entry, mode === 'generic' ? 'role_based' : mode));

  const culture = cultureQuestionFor(companyLabel, slug);
  const technicalFromBank = pickByType(cleaned, ['technical', 'system_design', 'situational'], 4);
  const codingFromBank = pickByType(cleaned, ['coding'], 1);

  const technicalFallback = ROLE_BASED_TECHNICAL(companyLabel, experienceLevel);
  const technical = (technicalFromBank.length >= 2
    ? technicalFromBank
    : [...technicalFromBank, ...technicalFallback]
  ).slice(0, experienceLevel === 'fresher' ? 3 : 4);

  const coding = codingFromBank[0] ?? ROLE_BASED_CODING(companyLabel, experienceLevel);

  // Prefer bank/web first; fill gaps with honest role-based questions (never meta prompts).
  let packEntries: CompanyQuestionEntry[] = [culture, ...technical, coding];

  // Tie one non-coding technical question to resume when possible.
  if (resumeProject && technical[0]) {
    packEntries = packEntries.map((entry, index) =>
      index === 1 ? lightlyParaphraseForResume(entry, resumeProject) : entry,
    );
  }

  packEntries = packEntries.filter((entry) => !isMeaninglessCompanyQuestion(entry.question));

  const finalMode: CompanyQuestionMode =
    mode === 'verified' || mode === 'web_research' ? mode : 'role_based';

  let generated: (GeneratedQuestion & { conceptId?: string })[] = companyQuestionsToGenerated(packEntries, companyLabel).map((question, index) => ({
    ...question,
    topic:
      index === 0
        ? `${companyLabel} culture`
        : index === packEntries.length - 1
        ? `${companyLabel} coding`
        : `${companyLabel} technical`,
    resumeReference: `${companyLabel} · ${packEntries[index]?.source ?? finalMode}`,
    followUpIntent: index === packEntries.length - 1 ? ('challenge' as const) : question.followUpIntent,
  }));

  if (conceptQuestions.length) {
    const usedConceptIds = new Set(conceptQuestions.map((item) => item.conceptId).filter(Boolean));
    generated = [
      ...conceptQuestions,
      ...generated.filter((item) => !usedConceptIds.has((item as any).conceptId)),
    ].slice(0, expectedConceptSlots);
  }

  const packMode: CompanyQuestionMode =
    conceptQuestions.length >= expectedConceptSlots ? 'concept_pool' : finalMode;

  return {
    questions: generated,
    mode: packMode,
    companyLabel,
    composition: {
      culture: 1,
      technical: technical.length,
      coding: 1,
    },
  };
};
