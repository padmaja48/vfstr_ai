/**
 * Resume questions must anchor on entities (company, project, certification),
 * never on dates/months/years extracted from the resume.
 */

const MONTH_NAMES =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|sept(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

const MONTH_PATTERN = new RegExp(`\\b(?:${MONTH_NAMES})\\b`, 'i');
const MONTH_YEAR_RANGE_PATTERN = new RegExp(
  `\\b(?:${MONTH_NAMES})[a-z]*\\s+\\d{4}\\s+[–-]\\s+(?:(?:${MONTH_NAMES})[a-z]*\\s+)?(?:\\d{4}|present|current|now)\\b`,
  'i',
);
const YEAR_RANGE_PATTERN = /\b\d{4}\s*[–-]\s*(?:\d{4}|present|current|now)\b/i;
const FOUR_DIGIT_YEAR_PATTERN = /\b(?:19|20)\d{2}\b/;

const normalizeSpaces = (value: string) => value.replace(/\s+/g, ' ').trim();

/** Strip date/month/year metadata from resume entity labels (topics, employers, projects). */
export const stripResumeDateMetadata = (value: string): string => {
  let text = normalizeSpaces(String(value || ''));

  text = text.replace(
    new RegExp(
      `^(?:${MONTH_NAMES})[a-z]*\\s+\\d{4}\\s+[–-]\\s+(?:(?:${MONTH_NAMES})[a-z]*\\s+)?(?:\\d{4}|present|current|now)\\s*$`,
      'i',
    ),
    '',
  );
  text = text.replace(/^\d{4}\s*[–-]\s*(?:\d{4}|present|current|now)\s*$/i, '');

  text = text.replace(
    new RegExp(
      `\\s+(?:${MONTH_NAMES})[a-z]*\\s+\\d{4}\\s+[–-]\\s+(?:(?:${MONTH_NAMES})[a-z]*\\s+)?(?:\\d{4}|present|current|now)\\b.*$`,
      'i',
    ),
    '',
  );
  text = text.replace(/\s+\(?\d{4}\s*[–-]\s*(?:\d{4}|present|current|now)\)?\s*$/i, '');
  text = text.replace(
    new RegExp(
      `^(?:${MONTH_NAMES})[a-z]*\\s+\\d{4}\\s+[–-]\\s+(?:(?:${MONTH_NAMES})[a-z]*\\s+)?(?:\\d{4}|present|current|now)\\s*[–-]?\\s*`,
      'i',
    ),
    '',
  );
  text = text.replace(/^\d{4}\s*[–-]\s*(?:\d{4}|present|current|now)\s*[–-]?\s*/i, '');
  text = text.replace(new RegExp(`\\(\\s*(?:${MONTH_NAMES})[^)]*\\d{4}[^)]*\\)`, 'gi'), '');
  text = text.replace(/\(\s*\d{4}\s*[–-]\s*(?:\d{4}|present|current|now)[^)]*\)/gi, '');
  text = text.replace(new RegExp(`\\b(?:${MONTH_NAMES})[a-z]*\\s+\\d{4}\\b`, 'gi'), '');
  text = text.replace(/\b(?:19|20)\d{2}\b/g, '');
  text = text.replace(/\s+[–-]\s*$/g, '');
  text = text.replace(/\s*,\s*,/g, ',');
  return normalizeSpaces(text);
};

/** True when a resume line is only a date/duration with no named entity. */
export const isDateOnlyResumeEntity = (value: string): boolean => {
  const stripped = stripResumeDateMetadata(value)
    .replace(/[|,()/\-–—]/g, ' ')
    .replace(/\b(?:present|current|now|to|from|till|until|ongoing)\b/gi, '')
    .trim();

  if (!stripped) return true;
  if (/^[\d\s./-]+$/.test(stripped)) return true;
  if (/^[-–—]+$/.test(stripped)) return true;
  return stripped.length < 3;
};

/** Normalize a resume topic for question generation; returns null if date-only. */
export const sanitizeResumeEntityTopic = (value: string): string | null => {
  const cleaned = stripResumeDateMetadata(value);
  if (!cleaned || isDateOnlyResumeEntity(value)) return null;
  return cleaned;
};

/** Detect month names, years, or date ranges used as question anchors. */
export const questionContainsDateAnchor = (question: string): boolean =>
  MONTH_PATTERN.test(question)
  || FOUR_DIGIT_YEAR_PATTERN.test(question)
  || MONTH_YEAR_RANGE_PATTERN.test(question)
  || YEAR_RANGE_PATTERN.test(question);

const extractEmployerFromTopic = (topic: string): string | undefined => {
  const atMatch = topic.match(/\bat\s+([A-Za-z0-9][A-Za-z0-9\s.&'-]{1,60})/i);
  if (atMatch?.[1]) return stripResumeDateMetadata(atMatch[1]);
  const internMatch = topic.match(
    /^(.{3,80}?)\s+(?:intern(?:ship)?|trainee)\b/i,
  );
  if (internMatch?.[1] && !isDateOnlyResumeEntity(internMatch[1])) {
    return stripResumeDateMetadata(internMatch[1]);
  }
  return undefined;
};

/** Rewrite a date-anchored question to reference an entity instead, or return null to discard. */
export const rewriteDateAnchoredQuestion = (
  question: string,
  entityHint?: string,
): string | null => {
  let text = normalizeSpaces(question);
  const entity = sanitizeResumeEntityTopic(entityHint || '') || undefined;
  const employer = entity || extractEmployerFromTopic(text);

  text = text.replace(new RegExp(`^in\\s+(?:${MONTH_NAMES})[a-z]*\\s+\\d{4},?\\s*`, 'i'), '');
  text = text.replace(/^in\s+(?:19|20)\d{2},?\s*/i, '');

  if (employer) {
    text = text.replace(
      /during\s+(?:your\s+)?internship\s+(?:in|from)\s+[^,?]+,?/i,
      `During your internship at ${employer}, `,
    );
    text = text.replace(
      /during\s+(?:your\s+)?(?:work experience|internship)\s+(?:in|from)\s+[^,?]+,?/i,
      `In your work experience at ${employer}, `,
    );
    text = text.replace(
      new RegExp(`in\\s+(?:${MONTH_NAMES})[a-z]*\\s+\\d{4}[^,?]*,?\\s*`, 'i'),
      '',
    );
    text = text.replace(
      /\bin\s+(?:19|20)\d{2}\b,?\s*(?=what|which|how|describe|explain|walk|tell)/i,
      '',
    );
  }

  text = text.replace(new RegExp(`\\(\\s*(?:${MONTH_NAMES})[^)]*\\)`, 'gi'), '');
  text = text.replace(/\(\s*\d{4}\s*[–-]\s*(?:\d{4}|present|current|now)[^)]*\)/gi, '');
  text = text.replace(MONTH_YEAR_RANGE_PATTERN, '');
  text = text.replace(YEAR_RANGE_PATTERN, '');
  text = text.replace(new RegExp(`\\b(?:in|during|from|since|between|around|throughout)\\s+(?:the\\s+)?(?:${MONTH_NAMES})[a-z]*\\s+\\d{4}\\b,?\\s*`, 'gi'), '');
  text = text.replace(/\b(?:in|during|from|since|between|around|throughout)\s+(?:the\s+)?(?:year\s+)?(?:19|20)\d{2}\b,?\s*/gi, '');
  text = text.replace(new RegExp(`\\b(?:${MONTH_NAMES})[a-z]*\\s+\\d{4}\\b`, 'gi'), '');
  text = text.replace(/\b(?:19|20)\d{2}\b/g, '');
  text = text.replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').replace(/,\s*,/g, ',').trim();

  if (!text || questionContainsDateAnchor(text) || text.length < 24) return null;
  const normalized = text.charAt(0).toUpperCase() + text.slice(1);
  return normalized.endsWith('?') ? normalized : `${normalized}?`;
};

export type DateAnchorSanitizeInput = {
  question: string;
  topic?: string;
  resumeReference?: string;
};

/** Self-check and rewrite/discard date-anchored resume questions before finalizing. */
export const sanitizeDateAnchoredQuestionText = (
  input: DateAnchorSanitizeInput,
): string | null => {
  const entityHint =
    sanitizeResumeEntityTopic(input.topic || '')
    || sanitizeResumeEntityTopic((input.resumeReference || '').split(':').slice(1).join(':').trim() || '');

  if (!questionContainsDateAnchor(input.question)) return input.question;

  const rewritten = rewriteDateAnchoredQuestion(input.question, entityHint || undefined);
  return rewritten;
};
