/** Fix rendering-breaking encoding artifacts only — never rewrite meaning. */
export const fixEncodingArtifacts = (value: unknown): string => {
  let text = String(value ?? '');
  if (!text) return '';

  text = text
    .replace(/\u0000/g, '')
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/\u2013|\u2014/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/!'/g, "'")
    .replace(/'\!/g, "'")
    .replace(/(\w)!'/g, "$1'")
    .replace(/(\d)\s*%\s*(?=[A-Za-z])/g, '$1 ')
    .replace(/\s+%\s+/g, ' ')
    .replace(/([a-z])%([a-z])/gi, '$1 $2')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return text;
};

/** Split run-on list strings into array items without rewriting content. */
export const splitListLikeText = (value: unknown, max = 12): string[] => {
  const text = fixEncodingArtifacts(value);
  if (!text) return [];

  if (Array.isArray(value)) {
    return value
      .map((item) => fixEncodingArtifacts(item))
      .filter(Boolean)
      .slice(0, max);
  }

  const bulletSplit = text.split(/\s*[•·▪]\s+|\s*-\s+(?=[A-Z])/).map((s) => s.trim()).filter(Boolean);
  if (bulletSplit.length > 1) return bulletSplit.slice(0, max);

  const numbered = text.split(/\s*(?:\d+[.)]\s+)/).map((s) => s.trim()).filter(Boolean);
  if (numbered.length > 1) return numbered.slice(0, max);

  const semicolon = text.split(/\s*;\s+/).map((s) => s.trim()).filter(Boolean);
  if (semicolon.length > 1) return semicolon.slice(0, max);

  return [text];
};

export const splitVerdictAndNote = (combined: string): { verdict: string; note: string } => {
  const text = fixEncodingArtifacts(combined);
  if (!text) return { verdict: '', note: '' };

  const dashSplit = text.match(/^(.+?)\s*[—–-]\s*(.+)$/);
  if (dashSplit) {
    return {
      verdict: dashSplit[1].replace(/^verdict:\s*/i, '').trim(),
      note: dashSplit[2].trim(),
    };
  }

  if (/^verdict:\s*/i.test(text)) {
    const rest = text.replace(/^verdict:\s*/i, '').trim();
    const inner = rest.match(/^(.+?)\s*[—–-]\s*(.+)$/);
    if (inner) {
      return { verdict: inner[1].trim(), note: inner[2].trim() };
    }
    return { verdict: rest, note: '' };
  }

  return { verdict: text, note: '' };
};
