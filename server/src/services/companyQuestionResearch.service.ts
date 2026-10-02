import fs from 'fs';
import path from 'path';

import { env } from '../config/env';
import {
  AiCallsDisabledError,
  executeOpenAiChatCompletion,
  isAiCallsEnabled,
} from './aiCallGateway.service';
import type { CompanyQuestionEntry, ExperienceLevel } from './promptBuilder';
import {
  getCompanyQuestions,
  getCompanyQuestionsDataDir,
  slugifyCompanyName,
  type CompanyQuestionBankFile,
} from './companyQuestionBank';

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_QUESTIONS_BEFORE_SKIP_AI = 5;
const MAX_PAGES_TO_FETCH = 6;
const PAGE_FETCH_TIMEOUT_MS = 7000;
const SEARCH_TIMEOUT_MS = 8000;

const memoryCache = new Map<string, { fetchedAt: number; bank: CompanyQuestionBankFile; mode: 'verified' | 'web_research' }>();
const ensureCompanyQuestionsInFlight = new Map<string, Promise<{
  questions: CompanyQuestionEntry[];
  mode: 'verified' | 'web_research' | 'generic';
  companyLabel: string;
  fromCache: boolean;
}>>();
const webResearchInFlight = new Map<string, Promise<CompanyQuestionEntry[]>>();

const ALLOWED_QUESTION_DOMAINS = [
  'geeksforgeeks.org',
  'interviewbit.com',
  'javatpoint.com',
  'simplilearn.com',
  'indeed.com',
  'ambitionbox.com',
  'prepinsta.com',
  'faceprep.in',
  'hackerrank.com',
  'leetcode.com',
  'medium.com',
  'dev.to',
  'github.io',
  'github.com',
  'interviewing.io',
  'levels.fyi',
  'teamblind.com',
  'educative.io',
  'interviewcake.com',
  'careercup.com',
];

const QUESTION_STARTERS =
  /^(?:tell me|describe|explain|how would|how do|what is|what are|why do|why would|walk me through|can you|could you|given|implement|design|write|discuss|share|talk about|have you|do you|what was|what would|what happens|when would|where would|which|compare|outline|present|solve|find|calculate|analyze|evaluate|justify|define|list|name|state|summarize|if you|suppose|imagine|debug|optimize|refactor|trade.?off)/i;

const NOISE_PATTERNS = [
  /\bclick here\b/i,
  /\bread more\b/i,
  /\bsign in\b/i,
  /\bcookie/i,
  /\bprivacy policy\b/i,
  /\bterms of service\b/i,
  /\binterview experience at\b/i,
  /\b\d+\s*(?:comments|answers|views|upvotes)\b/i,
  /\b(?:glassdoor|leetcode|geeksforgeeks|indeed|ambitionbox|prepinsta)\.com\b/i,
  /\binterview expectations\b/i,
  /\bcompany-style\b/i,
  /\blet'?s move to some\b/i,
  /\bhow would you demonstrate\b.*\bexpectations\b/i,
  /\bwhat do you know about our company culture in general\b/i,
];

const MEANINGLESS_PATTERNS = [
  /^why .+, and what do you understand about/i,
  /^why .+, and which product/i,
  /^why .+, and what interests you about/i,
  /how would you demonstrate .+ interview expectations/i,
  /company-style expectations/i,
  /^let'?s move to some .+ expectations/i,
];

type SearchHit = {
  title: string;
  url: string;
  snippet: string;
};

const decodeHtmlEntities = (value: string) =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');

const cleanSnippet = (value: string) =>
  decodeHtmlEntities(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const classifyQuestionType = (question: string): CompanyQuestionEntry['type'] => {
  const lower = question.toLowerCase();
  if (/\b(?:design|architecture|scalab|distributed|microservice|system)\b/.test(lower)) return 'system_design';
  if (/\b(?:algorithm|complexity|implement|code|array|tree|graph|linked list|dynamic programming|sort|search|leetcode|hackerrank|coding|dsa|data structure)\b/.test(lower)) {
    return 'coding';
  }
  if (/\b(?:tell me about a time|describe a situation|behavioral|conflict|teamwork|leadership|star|when did you|situation where)\b/.test(lower)) {
    return 'behavioral';
  }
  if (/\b(?:what would you do|scenario|suppose|imagine|if you were|production issue|failure)\b/.test(lower)) {
    return 'situational';
  }
  return 'technical';
};

const normalizeQuestion = (question: string) =>
  question
    .replace(/^[\d.)\-\s•]+/, '')
    .replace(/\s+/g, ' ')
    .replace(/[.!]+$/, '?')
    .replace(/\?+$/, '?')
    .trim();

const isMeaninglessCompanyQuestion = (text: string) =>
  MEANINGLESS_PATTERNS.some((pattern) => pattern.test(text));

const isLikelyInterviewQuestion = (text: string) => {
  const question = normalizeQuestion(text);
  if (question.length < 24 || question.length > 320) return false;
  if (NOISE_PATTERNS.some((pattern) => pattern.test(question))) return false;
  if (isMeaninglessCompanyQuestion(question)) return false;
  if (!question.endsWith('?') && !QUESTION_STARTERS.test(question)) return false;
  if (/^(?:yes|no|maybe|thanks|hello|hi)\b/i.test(question)) return false;
  // Prefer concrete question content over meta prompts
  if (/^(?:why this company|why our company)\b/i.test(question) && question.split(/\s+/).length < 10) return false;
  return true;
};

export const extractQuestionsFromText = (text: string, source = 'web research'): CompanyQuestionEntry[] => {
  const candidates = new Set<string>();

  const sentenceMatches = text.match(/[^.!?\n]{20,320}[?.!]/g) ?? [];
  sentenceMatches.forEach((match) => {
    const question = normalizeQuestion(match.replace(/[.!]+$/, '?'));
    if (isLikelyInterviewQuestion(question)) candidates.add(question);
  });

  text
    .split(/(?<=[.!?])\s+|[\n•]|(?:\d+[.)]\s+)/g)
    .map((part) => normalizeQuestion(part))
    .filter(isLikelyInterviewQuestion)
    .forEach((question) => candidates.add(question));

  return Array.from(candidates).map((question) => ({
    question,
    type: classifyQuestionType(question),
    source,
  }));
};

const hostnameOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
};

const isAllowedDomain = (url: string) => {
  const host = hostnameOf(url);
  if (!host) return false;
  return ALLOWED_QUESTION_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
};

const buildSearchQueries = (companyLabel: string, role: string) => {
  const year = new Date().getFullYear();
  const prevYear = year - 1;
  return [
    `${companyLabel} ${role} interview questions ${prevYear} OR ${year} site:geeksforgeeks.org`,
    `${companyLabel} ${role} interview questions site:interviewbit.com OR site:ambitionbox.com`,
    `${companyLabel} campus placement interview questions site:geeksforgeeks.org OR site:prepinsta.com`,
    `${companyLabel} ${role} coding interview questions leetcode OR hackerrank`,
    `"${companyLabel}" "${role}" "interview questions" ${year}`,
    `${companyLabel} HR technical round interview questions fresher`,
  ];
};

const searchWithSerper = async (query: string): Promise<SearchHit[]> => {
  if (!env.SERPER_API_KEY || process.env.NODE_ENV === 'test') return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'X-API-KEY': env.SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, num: 8 }),
    });
    if (!response.ok) return [];
    const data = (await response.json()) as {
      organic?: Array<{ title?: string; link?: string; snippet?: string }>;
    };
    return (data.organic ?? [])
      .map((item) => ({
        title: cleanSnippet(item.title || ''),
        url: item.link || '',
        snippet: cleanSnippet(item.snippet || ''),
      }))
      .filter((hit) => hit.url && hit.snippet);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
};

const searchDuckDuckGoHits = async (query: string): Promise<SearchHit[]> => {
  if (process.env.NODE_ENV === 'test') return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  try {
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FluentAIInterviewResearch/3.0)',
        Accept: 'text/html',
      },
    });
    if (!response.ok) return [];

    const html = await response.text();
    const hits: SearchHit[] = [];

    const resultBlocks = html.match(/<div[^>]+class="result[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>/gi) ?? [];
    for (const block of resultBlocks) {
      const titleMatch = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/i);
      if (!titleMatch) continue;

      let url = decodeHtmlEntities(titleMatch[1] || '');
      // DuckDuckGo redirect links: /l/?uddg=<encoded>
      const redirectMatch = url.match(/[?&]uddg=([^&]+)/i);
      if (redirectMatch) {
        try {
          url = decodeURIComponent(redirectMatch[1]);
        } catch {
          /* keep original */
        }
      }

      hits.push({
        title: cleanSnippet(titleMatch[2] || ''),
        url,
        snippet: cleanSnippet(snippetMatch?.[1] || ''),
      });
    }

    // Fallback: collect snippets even when block parsing fails
    if (!hits.length) {
      const snippets = Array.from(
        html.matchAll(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/div>/gi),
      )
        .map((match) => cleanSnippet(match[1] || match[2] || ''))
        .filter((snippet) => snippet.length > 30);
      return snippets.map((snippet) => ({ title: '', url: '', snippet }));
    }

    return hits.filter((hit) => hit.snippet.length > 20 || hit.url);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
};

const searchWeb = async (query: string): Promise<SearchHit[]> => {
  const serperHits = await searchWithSerper(query);
  if (serperHits.length) return serperHits;
  return searchDuckDuckGoHits(query);
};

const stripHtmlToText = (html: string) =>
  cleanSnippet(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<header[\s\S]*?<\/header>/gi, ' '),
  );

const fetchPublicPageText = async (url: string): Promise<string> => {
  if (!url || !isAllowedDomain(url) || process.env.NODE_ENV === 'test') return '';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PAGE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FluentAIInterviewResearch/3.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });
    if (!response.ok) return '';
    const contentType = response.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType) && contentType) return '';
    const html = await response.text();
    if (html.length > 1_500_000) return stripHtmlToText(html.slice(0, 1_500_000));
    return stripHtmlToText(html).slice(0, 20000);
  } catch {
    return '';
  } finally {
    clearTimeout(timeout);
  }
};

const scoreQuestion = (entry: CompanyQuestionEntry, companyLabel: string, role: string) => {
  const q = entry.question.toLowerCase();
  const company = companyLabel.toLowerCase();
  const roleBits = role.toLowerCase().split(/\s+/).filter((part) => part.length > 2);
  let score = 0;
  if (q.includes(company)) score += 3;
  if (roleBits.some((bit) => q.includes(bit))) score += 2;
  if (entry.question.endsWith('?')) score += 1;
  if (entry.type === 'coding' || entry.type === 'system_design') score += 1;
  if (entry.type === 'behavioral') score += 1;
  if (isMeaninglessCompanyQuestion(entry.question)) score -= 10;
  if (entry.question.length >= 40 && entry.question.length <= 220) score += 1;
  return score;
};

const dedupeQuestions = (entries: CompanyQuestionEntry[]) => {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = entry.question.toLowerCase().replace(/[^a-z0-9\s?]/g, '').replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const refineQuestionsWithAi = async ({
  companyLabel,
  role,
  rawQuestions,
  evidenceText,
}: {
  companyLabel: string;
  role: string;
  rawQuestions: CompanyQuestionEntry[];
  evidenceText: string;
}): Promise<CompanyQuestionEntry[]> => {
  const apiKey = env.AI_PROVIDER === 'openai' ? env.OPENAI_API_KEY : env.GROQ_API_KEY;
  if (!apiKey || process.env.NODE_ENV === 'test') return [];

  const endpoint =
    env.AI_PROVIDER === 'openai'
      ? `${env.OPENAI_BASE_URL.replace(/\/$/, '')}/chat/completions`
      : `${env.GROQ_BASE_URL.replace(/\/$/, '')}/chat/completions`;
  const model = env.AI_PROVIDER === 'openai' ? env.OPENAI_MODEL : env.GROQ_MODEL;

  const prompt = `Extract REAL interview questions commonly asked at ${companyLabel} for a ${role} role.

Use ONLY the evidence below (search snippets + page text). Do NOT invent generic "why this company" filler.
Return 8-12 concrete interview questions a candidate would actually be asked (coding, technical, behavioral, HR, system design as appropriate).

RAW CANDIDATE QUESTIONS:
${rawQuestions.slice(0, 30).map((item) => `- ${item.question}`).join('\n') || '(none)'}

EVIDENCE:
${evidenceText.slice(0, 9000)}

Return ONLY JSON:
{
  "questions": [
    { "question": string, "type": "coding"|"technical"|"behavioral"|"situational"|"system_design", "source": string }
  ]
}`;

  try {
    const result = await executeOpenAiChatCompletion({
      operation: 'refineQuestionsWithAi',
      requestType: 'company_question_refine',
      sourceFile: 'companyQuestionResearch.service.ts',
      endpoint,
      apiKey,
      model,
      isBackground: true,
      body: {
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You extract real company interview questions from evidence. Return strict JSON only.',
          },
          { role: 'user', content: prompt },
        ],
      },
    });
    if (!result.ok) return [];
    const content = result.data.choices?.[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(content) as { questions?: CompanyQuestionEntry[] };
    return (parsed.questions ?? [])
      .map((item) => ({
        question: normalizeQuestion(String(item.question || '')),
        type: item.type || classifyQuestionType(String(item.question || '')),
        source: item.source || `web ${new Date().getFullYear()}`,
      }))
      .filter((item) => isLikelyInterviewQuestion(item.question));
  } catch (error) {
    if (error instanceof AiCallsDisabledError) return [];
    return [];
  }
};

const matchRoleKey = (requestedRole: string, availableRoles: string[]) => {
  const normalized = requestedRole.trim().toLowerCase();
  const exact = availableRoles.find((key) => key.toLowerCase() === normalized);
  if (exact) return exact;

  const partial = availableRoles.find(
    (key) => normalized.includes(key.toLowerCase()) || key.toLowerCase().includes(normalized),
  );
  return partial ?? 'Software Engineer';
};

const readCachedBank = (slug: string): (CompanyQuestionBankFile & { fetchedAt?: string; source?: string }) | null => {
  const filePath = path.join(getCompanyQuestionsDataDir(), `${slug}.json`);
  if (!fs.existsSync(filePath)) return null;

  try {
    const bank = JSON.parse(fs.readFileSync(filePath, 'utf8')) as CompanyQuestionBankFile & {
      fetchedAt?: string;
      source?: string;
    };
    // Curated banks (no fetchedAt) never expire.
    if (!bank.fetchedAt) return bank;
    const age = Date.now() - new Date(bank.fetchedAt).getTime();
    return age <= CACHE_TTL_MS ? bank : null;
  } catch {
    return null;
  }
};

const writeCachedBank = (slug: string, bank: CompanyQuestionBankFile & { fetchedAt?: string; source?: string }) => {
  const dir = getCompanyQuestionsDataDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${slug}.json`), `${JSON.stringify(bank, null, 2)}\n`, 'utf8');
};

const pickRoleEntries = (
  bank: CompanyQuestionBankFile,
  role: string,
  experienceLevel: ExperienceLevel,
) => {
  const roleKey = matchRoleKey(role, Object.keys(bank.roles));
  return (
    bank.roles[roleKey]?.[experienceLevel] ??
    bank.roles[roleKey]?.experienced ??
    bank.roles[roleKey]?.fresher ??
    []
  );
};

export type EnsureCompanyQuestionsInput = {
  companyName: string;
  companyLabel?: string;
  role: string;
  experienceLevel: ExperienceLevel;
  forceRefresh?: boolean;
};

export const fetchCompanyQuestionsFromWeb = async ({
  companyLabel,
  role,
  experienceLevel,
}: {
  companyLabel: string;
  role: string;
  experienceLevel: ExperienceLevel;
}): Promise<CompanyQuestionEntry[]> => {
  if (!isAiCallsEnabled()) return [];

  const inFlightKey = `${companyLabel}:${role}:${experienceLevel}`;
  const existing = webResearchInFlight.get(inFlightKey);
  if (existing) return existing;

  const promise = fetchCompanyQuestionsFromWebInner({ companyLabel, role, experienceLevel })
    .finally(() => {
      webResearchInFlight.delete(inFlightKey);
    });
  webResearchInFlight.set(inFlightKey, promise);
  return promise;
};

const fetchCompanyQuestionsFromWebInner = async ({
  companyLabel,
  role,
  experienceLevel,
}: {
  companyLabel: string;
  role: string;
  experienceLevel: ExperienceLevel;
}): Promise<CompanyQuestionEntry[]> => {
  const queries = buildSearchQueries(companyLabel, role);
  const hits: SearchHit[] = [];

  for (const query of queries) {
    hits.push(...(await searchWeb(query)));
  }

  const uniqueUrls = Array.from(
    new Set(
      hits
        .map((hit) => hit.url)
        .filter((url) => url && isAllowedDomain(url)),
    ),
  ).slice(0, MAX_PAGES_TO_FETCH);

  const pageTexts: string[] = [];
  for (const url of uniqueUrls) {
    const text = await fetchPublicPageText(url);
    if (text.length > 200) pageTexts.push(`SOURCE ${url}\n${text}`);
  }

  const snippetText = hits.map((hit) => `${hit.title}\n${hit.snippet}`).join('\n');
  const evidenceText = [snippetText, ...pageTexts].join('\n\n');
  const year = new Date().getFullYear();
  const extracted = dedupeQuestions(extractQuestionsFromText(evidenceText, `web ${year}`));
  const aiRefined = await refineQuestionsWithAi({
    companyLabel,
    role,
    rawQuestions: extracted,
    evidenceText,
  });

  const merged = dedupeQuestions([...aiRefined, ...extracted])
    .filter((entry) => !isMeaninglessCompanyQuestion(entry.question))
    .sort((a, b) => scoreQuestion(b, companyLabel, role) - scoreQuestion(a, companyLabel, role));

  const filtered =
    experienceLevel === 'fresher'
      ? merged.filter(
          (entry) => entry.type !== 'system_design' || /lite|basic|high level|overview/i.test(entry.question),
        )
      : merged;

  return filtered.slice(0, 20);
};

export const ensureCompanyQuestions = async (
  input: EnsureCompanyQuestionsInput,
): Promise<{
  questions: CompanyQuestionEntry[];
  mode: 'verified' | 'web_research' | 'generic';
  companyLabel: string;
  fromCache: boolean;
}> => {
  const slug = slugifyCompanyName(input.companyName);
  const inFlightKey = `${slug}:${input.role}:${input.experienceLevel}:${Boolean(input.forceRefresh)}`;
  const existing = ensureCompanyQuestionsInFlight.get(inFlightKey);
  if (existing) return existing;

  const promise = ensureCompanyQuestionsInner(input).finally(() => {
    ensureCompanyQuestionsInFlight.delete(inFlightKey);
  });
  ensureCompanyQuestionsInFlight.set(inFlightKey, promise);
  return promise;
};

const ensureCompanyQuestionsInner = async ({
  companyName,
  companyLabel,
  role,
  experienceLevel,
  forceRefresh = false,
}: EnsureCompanyQuestionsInput): Promise<{
  questions: CompanyQuestionEntry[];
  mode: 'verified' | 'web_research' | 'generic';
  companyLabel: string;
  fromCache: boolean;
}> => {
  const slug = slugifyCompanyName(companyName);
  const label = companyLabel ?? companyName;
  const cacheKey = `${slug}:${role}:${experienceLevel}`;

  // 1) Prefer curated/verified static banks (amazon/google/etc.)
  const verified = await getCompanyQuestions(companyName, role, experienceLevel, 16);
  if (verified?.mode === 'verified' && verified.questions.length > 0 && !forceRefresh) {
    return {
      questions: verified.questions.filter((item) => !isMeaninglessCompanyQuestion(item.question)),
      mode: 'verified',
      companyLabel: verified.companyLabel || label,
      fromCache: true,
    };
  }

  if (!forceRefresh) {
    const memory = memoryCache.get(cacheKey);
    if (memory && Date.now() - memory.fetchedAt <= CACHE_TTL_MS) {
      const entries = pickRoleEntries(memory.bank, role, experienceLevel)
        .filter((item) => !isMeaninglessCompanyQuestion(item.question));
      if (entries.length) {
        return {
          questions: entries,
          mode: memory.mode,
          companyLabel: label,
          fromCache: true,
        };
      }
    }

    const cached = readCachedBank(slug);
    if (cached) {
      const mode: 'verified' | 'web_research' =
        !cached.fetchedAt || cached.source === 'verified' ? 'verified' : 'web_research';
      memoryCache.set(cacheKey, { fetchedAt: Date.now(), bank: cached, mode });
      const entries = pickRoleEntries(cached, role, experienceLevel)
        .filter((item) => !isMeaninglessCompanyQuestion(item.question));
      if (entries.length >= MIN_QUESTIONS_BEFORE_SKIP_AI || mode === 'verified') {
        return { questions: entries, mode, companyLabel: label, fromCache: true };
      }
    }
  }

  // 2) Live web research: search → fetch public pages → extract/refine
  const researched = await fetchCompanyQuestionsFromWeb({ companyLabel: label, role, experienceLevel });
  if (researched.length) {
    const roleKey = matchRoleKey(role, ['Software Engineer', role]);
    const bank: CompanyQuestionBankFile & { fetchedAt: string; source: string } = {
      company: label,
      fetchedAt: new Date().toISOString(),
      source: 'web_research',
      roles: {
        [roleKey]: {
          [experienceLevel]: researched,
        },
      },
    };

    const existing = readCachedBank(slug);
    if (existing) {
      bank.roles = {
        ...existing.roles,
        [roleKey]: {
          ...(existing.roles[roleKey] ?? {}),
          [experienceLevel]: dedupeQuestions([
            ...(existing.roles[roleKey]?.[experienceLevel] ?? []),
            ...researched,
          ]).filter((item) => !isMeaninglessCompanyQuestion(item.question)),
        },
      };
      // Preserve curated status if file was a static bank
      if (!existing.fetchedAt && existing.source !== 'web_research') {
        bank.source = 'verified+web_research';
      }
    }

    writeCachedBank(slug, bank);
    memoryCache.set(cacheKey, { fetchedAt: Date.now(), bank, mode: 'web_research' });

    return {
      questions: researched,
      mode: 'web_research',
      companyLabel: label,
      fromCache: false,
    };
  }

  // 3) Last resort: generic bank (still better than empty)
  if (verified?.questions?.length) {
    return {
      questions: verified.questions.filter((item) => !isMeaninglessCompanyQuestion(item.question)),
      mode: verified.mode,
      companyLabel: verified.companyLabel || label,
      fromCache: true,
    };
  }

  return { questions: [], mode: 'generic', companyLabel: label, fromCache: false };
};

export const companyQuestionsToGenerated = (
  entries: CompanyQuestionEntry[],
  companyLabel: string,
): import('./ai.service').GeneratedQuestion[] =>
  entries
    .filter((entry) => !isMeaninglessCompanyQuestion(entry.question))
    .map((entry, index) => ({
      question: entry.question,
      questionId: entry.questionId,
      bankQuestionId: entry.bankQuestionId || entry.questionId,
      expectedSignals:
        entry.type === 'behavioral'
          ? ['STAR structure', 'specific example', 'clear outcome']
          : entry.type === 'coding'
          ? ['approach explanation', 'complexity analysis', 'edge cases']
          : entry.type === 'system_design'
          ? ['components and flow', 'trade-offs', 'scalability considerations']
          : ['accurate explanation', 'practical example', 'role relevance'],
      questionType:
        entry.type === 'behavioral'
          ? 'behavioural'
          : entry.type === 'situational'
          ? 'situational'
          : 'technical',
      resumeReference: `${companyLabel} reported question (${entry.source ?? 'web research'})`,
      difficulty:
        entry.type === 'coding' || entry.type === 'system_design'
          ? 'medium-hard'
          : entry.type === 'behavioral'
          ? 'behavioral'
          : index === 0
          ? 'easy'
          : 'medium',
      topic: `${companyLabel} interview pattern`,
      followUpIntent: 'deepen' as const,
    }));

export const hasEnoughCompanyQuestions = (count: number) => count >= MIN_QUESTIONS_BEFORE_SKIP_AI;

export { MIN_QUESTIONS_BEFORE_SKIP_AI, isMeaninglessCompanyQuestion };

export const __testResetCompanyQuestionResearchInFlight = () => {
  ensureCompanyQuestionsInFlight.clear();
  webResearchInFlight.clear();
  memoryCache.clear();
};
