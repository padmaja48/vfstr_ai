/**
 * Resume-aware speech cleanup for interviews.
 * We do NOT maintain a national college dictionary — we reuse THIS student's resume.
 */

const EDUCATION_ANCHOR =
  /\b(?:university|college|institute|institution|school|academy|polytechnic)\b/i;

const DEGREE_REPLACEMENTS = [
  [/\bbee\s*tech\b/gi, 'B.Tech'],
  [/\bb\s*tech\b/gi, 'B.Tech'],
  [/\bm\s*tech\b/gi, 'M.Tech'],
];

const levenshtein = (a, b) => {
  const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= a.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i += 1) {
    for (let j = 1; j <= a.length; j += 1) {
      matrix[i][j] =
        b.charAt(i - 1) === a.charAt(j - 1)
          ? matrix[i - 1][j - 1]
          : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return matrix[b.length][a.length];
};

const significantTokens = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(
      (token) =>
        token.length >= 3 &&
        !['the', 'and', 'for', 'from', 'with', 'university', 'college', 'institute', 'of'].includes(token),
    );

export const extractEducationEntities = (resumeText = '') => {
  if (!resumeText.trim()) return [];
  const lines = resumeText
    .split(/\r?\n|[,;|]/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const entities = [];
  for (const line of lines) {
    if (!EDUCATION_ANCHOR.test(line)) continue;
    if (line.length < 6 || line.length > 120) continue;
    const cleaned = line
      .replace(/^(education|academic|qualification|college|university)\s*[:\-–]?\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length >= 6) entities.push(cleaned);
  }
  return [...new Set(entities)].slice(0, 12);
};

export const alignTranscriptWithResumeEducation = (transcript, educationEntities = []) => {
  if (!transcript?.trim() || !educationEntities.length) return transcript;

  const anchorMatch = transcript.match(
    /\b(?:[\w'.-]+\s+){0,5}(?:university|college|institute|institution|school|academy|polytechnic)\b(?:\s+[\w'.-]+){0,3}/gi,
  );
  if (!anchorMatch?.length) return transcript;

  let updated = transcript;
  for (const phrase of anchorMatch) {
    const phraseTokens = new Set(significantTokens(phrase));
    let best = null;
    for (const entity of educationEntities) {
      const entityTokens = significantTokens(entity);
      if (!entityTokens.length) continue;
      const overlap = entityTokens.filter((token) => {
        if (phraseTokens.has(token)) return true;
        return [...phraseTokens].some((pt) => {
          const distance = levenshtein(pt, token);
          const maxDistance = token.length >= 6 ? 2 : 1;
          return distance <= maxDistance;
        });
      }).length;
      const coverage = overlap / entityTokens.length;
      const score = coverage + (educationEntities.length === 1 ? 0.35 : 0);
      if (!best || score > best.score) best = { name: entity, score };
    }
    if (best && best.score >= 0.35) updated = updated.replace(phrase, best.name);
  }
  return updated.replace(/\bfrom\s+with\s+/gi, 'from ').replace(/\s+/g, ' ').trim();
};

export const normalizeSpeechTranscript = (text, resumeText = '') => {
  if (!text || typeof text !== 'string') return '';
  let normalized = text.replace(/\s+/g, ' ').trim();
  for (const [pattern, replacement] of DEGREE_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }
  const education = extractEducationEntities(resumeText);
  return alignTranscriptWithResumeEducation(normalized, education);
};
