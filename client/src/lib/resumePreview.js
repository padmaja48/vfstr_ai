/**
 * Strong headers may appear mid-line in pasted resumes.
 * Ambiguous short labels only match whole lines.
 * Do NOT match singular "Certification" mid-line (breaks cert titles).
 */
const STRONG_SECTION_LABEL_PATTERN =
  /(^|\n|\s)(Career Objective|Objective|Profile Summary|Technical Skills|Technical Summary|Web\s*Technologies|Technologies|Technical Competencies|Academic Projects?|Personal Projects?|Projects?|Internship Experience|Work Experience|Professional Experience|Internships?|Technical Certifications|(?<!Technical )Certifications(?:\s*&\s*Training)?|Workshop Participation|Language Proficiency|Additional Information|Core Competencies|Relevant Coursework|Academic Background)\b\s*:?\s*/gim;

const WHOLE_LINE_SECTION_LABEL_PATTERN =
  /^(Education|Qualification|Skills|Summary|Experience|Internships?|Employment|Training|Certificates?|Certifications?|Licenses?|Coursework|Achievements?|Awards?|Honou?rs?|Hackathons?|Languages|Interests?|Areas? of Interest|Leadership|Publications?|Research Papers?|Research Work|Web\s*Technologies|Technologies|Technical Skills)\s*:?\s*$/gim;

/** Paste often omits a bullet before the next Title-Case project name. */
const INLINE_PROJECT_TITLE_PATTERN =
  /([a-z.,;)])\s+((?:[A-Z][\w+/&]*)(?:\s+[A-Z][\w+/&]*){1,8}\s*[–-]\s+)/g;

const normalizeResumeTextForParsing = (text = '') =>
  String(text || '')
    .replace(/\r/g, '\n')
    .replace(/[|·]/g, '\n')
    .replace(/[•●▪◆]/g, '\n')
    .replace(STRONG_SECTION_LABEL_PATTERN, '\n$2\n')
    .replace(WHOLE_LINE_SECTION_LABEL_PATTERN, '\n$1\n')
    .replace(INLINE_PROJECT_TITLE_PATTERN, '$1\n$2');

const resumeLines = (text = '') =>
  normalizeResumeTextForParsing(text)
    .split(/\n/)
    .map((line) => line.replace(/^[\s>*•\-–—]+/, '').trim())
    .filter((line) => line.length > 1);

const RESUME_HEADING_LIKE =
  /^(career objective|objective|profile summary|summary|education|academic background|qualification|technical skills|skills|technical summary|web\s*technologies|technologies|technical competencies|projects?|academic projects?|personal projects?|experience|internships?|internship experience|training|work experience|professional experience|employment|certifications?(?:\s*&\s*training)?|certificates?|licenses?|technical certifications|workshop participation|coursework|relevant coursework|achievements?|awards?|language proficiency|languages|additional information|core competencies|areas? of interest|interests?)$/i;

const isLinkOrMetaLine = (line) =>
  /^(?:live\s+demo|demo|github|gitlab|link|url)\b/i.test(line)
  || /^[\w.-]+\/(?:live\s*)?demo$/i.test(line)
  || /^(https?:\/\/|www\.)/i.test(line);

const isBulletDescriptionLine = (line) =>
  /^(?:developed|built|designed|implemented|created|integrated|deployed|worked|responsible|collaborated|optimized|improved|achieved|managed|led|used|utilized|configured|established|enabled|provided|supported|handled|wrote|maintained|tested|automated|analyzed|engineered|attended|participated|mentored|learned|gained)\b/i.test(line)
  || /[,;]$/.test(line)
  || (line.split(/\s+/).length >= 12 && /^(?:a|an|the|for|with|using|to)\b/i.test(line));

const isSectionNoiseLine = (line) =>
  /^(?:technical certifications?|workshop participation|language proficiency|achievements?|coursework|soft skills|tools?|technologies|technical skills?)\s*$/i.test(line);

/** Skill/technology catalog lines — never treat as projects/certs/experience. */
const looksLikeSkillListLine = (line) => {
  const text = String(line || '').trim();
  if (!text) return false;
  if (
    /^(?:programming languages?|web\s*technologies?|webtechnologies|frontend(?: technologies)?|backend(?: technologies)?|databases?|developer tools?(?: & platforms)?|core concepts?|additional knowledge|tools?|technologies|technical skills?|frameworks?|libraries|soft skills?)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  // "Programming Languages: C, C++, Python…" / dense comma skill dumps
  if (text.includes(':') && text.split(/[,;/|]/).length >= 3) return true;
  if ((text.match(/,/g) || []).length >= 3 && !/\b(project|system|platform|chatbot|internship|certificate)\b/i.test(text)) {
    return true;
  }
  // Bare skill tokens / orphan stack fragments
  if (/^(?:c\+\+|python|java|javascript|html5?|css3?|sql|react\.?js|node\.?js|mongodb|express\.?js|mern(?:\s*stack)?)(?:\s*[,/].*)?$/i.test(text)) {
    return true;
  }
  return false;
};

const looksLikeDateOnlyLine = (line) =>
  /^(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}|\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{4})\s*(?:[-–—]\s*(?:present|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}|\d{4}))?$/i.test(
    String(line || '').trim(),
  );

const looksLikeNewResumeItem = (line) => {
  const text = String(line || '').trim();
  if (!text) return false;
  if (/^(?:\d{1,2}[\/.\-]|\d{4}\b|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b)/i.test(text)) {
    return true;
  }
  if (/^(?:aws|azure|google|microsoft|oracle|ibm|meta|nptel|hackerrank|coursera|udemy|linkedin|bytexl|sure trust)\b/i.test(text)) {
    return true;
  }
  if (/^(?:software|senior|junior|associate|graduate|intern\b|internship\b|developer\b|engineer\b|analyst\b|trainee\b|workshop)\b/i.test(text)
    && /\b(at|[-–]|intern|developer|engineer|analyst|participant)\b/i.test(text)) {
    return true;
  }
  if (/^(?:project\s*\d+|[\d]+[\).])/i.test(text)) return true;
  return false;
};

const looksLikeCompleteResumeItem = (line) => {
  const text = String(line || '').trim();
  if (/[.!?)]$/.test(text)) return true;
  if (/\b(20\d{2}|present)\b/i.test(text)) return true;
  return /\b(certificate|certification|certified|practitioner|nanodegree|internship|intern\b|developer|engineer|analyst|associate|trainee|project|application|system|platform|dashboard|website|chatbot|portal|model|course|essentials|workshop|academy|hackerrank|nptel)\b/i.test(text)
    && text.split(/\s+/).length >= 3;
};

const shouldMergeResumeLines = (previous, current) => {
  const prev = String(previous || '').trim();
  const curr = String(current || '').trim();
  if (!prev || !curr) return false;
  if (isLinkOrMetaLine(curr) || isBulletDescriptionLine(curr) || isSectionNoiseLine(curr) || looksLikeSkillListLine(curr)) return false;
  if (isLinkOrMetaLine(prev) || isBulletDescriptionLine(prev) || looksLikeSkillListLine(prev)) return false;
  if (looksLikeNewResumeItem(curr)) return false;
  if (looksLikeCompleteResumeItem(prev)) return false;
  if (/^[A-Z]/.test(curr) && !/[-–—,:/&]$/.test(prev) && !/\bat$/i.test(prev)) return false;
  if (/^[a-z(]/.test(curr)) return true;
  if (/[-–—,:/&]$/.test(prev)) return true;
  if (/\bat$/i.test(prev)) return true;
  if (curr.split(/\s+/).length <= 2 && /^(?:certification|certificate|certified|architect|developer|engineer|internship|platform|system|application)\b/i.test(curr)) {
    return true;
  }
  return false;
};

const mergeWrappedResumeLines = (lines = []) => {
  const merged = [];
  for (const line of lines) {
    const cleaned = String(line || '').replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;
    if (isLinkOrMetaLine(cleaned) || isSectionNoiseLine(cleaned) || isBulletDescriptionLine(cleaned) || looksLikeSkillListLine(cleaned)) {
      continue;
    }
    if (/^[a-z(]/.test(cleaned) && (!merged.length || looksLikeCompleteResumeItem(merged[merged.length - 1]))) {
      continue;
    }
    if (merged.length && shouldMergeResumeLines(merged[merged.length - 1], cleaned)) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${cleaned}`.replace(/\s+/g, ' ').trim();
    } else {
      merged.push(cleaned);
    }
  }
  return merged;
};

const collectSectionLines = (lines, headingPattern) => {
  const start = lines.findIndex((line) => headingPattern.test(line));
  if (start < 0) return [];
  const output = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (RESUME_HEADING_LIKE.test(lines[i]) && output.length > 0) break;
    if (!RESUME_HEADING_LIKE.test(lines[i])) output.push(lines[i]);
  }
  return output;
};

const sectionLines = (lines, headingPattern) =>
  mergeWrappedResumeLines(collectSectionLines(lines, headingPattern)).slice(0, 16);

const cleanResumeItem = (value) => {
  let cleaned = String(value || '')
    .replace(/\s+(?:live\s+demo|demo\s+link|github|gitlab|portfolio)\b.*$/i, '')
    .replace(/\b[\w.-]+\/(?:live\s*)?demo\b/gi, '')
    .replace(/\s+[A-Za-z][\w.-]*\/(?:Live\s*)?Demo\s*$/i, '')
    .replace(/\s+Live\s*Demo\s*$/i, '')
    .replace(/\s+/g, ' ')
    .replace(/[.]+$/g, '')
    .trim();

  const dashSplit = cleaned.match(/^(.{4,80}?)\s+[–-]\s+(.+)$/);
  if (dashSplit) {
    const right = dashSplit[2].trim();
    const rightWords = right.split(/\s+/).filter(Boolean).length;
    const looksLikeStack =
      rightWords <= 8
      && (/[,/|&]|react|node|python|java|aws|sql|mern|nlp|ai|ml|stack|full\s*stack|generative|hugging\s*face|streamlit/i.test(right));
    const looksLikeIssuer =
      rightWords <= 10
      && /\b(hackerrank|cisco|aws|azure|google|microsoft|coursera|udemy|nptel|zoho|cambridge|academy|certified|certification|bytexl|elite)\b/i.test(right);
    if (looksLikeStack || looksLikeIssuer || rightWords >= 6) {
      cleaned = dashSplit[1].trim();
    }
  }
  return cleaned;
};

const PROJECT_TITLE_HINT =
  /\b(chatbot|platform|system|app(?:lication)?|website|dashboard|portal|api|model|nlp|donation|inventory|knowledge|tracker|finder|engine|management|ordering|booking|management)\b|\b(?:full\s*stack|mern|hugging\s*face|streamlit)\b/i;

const CERT_TITLE_HINT =
  /\b(certified|certification|certificate|hackerrank|aws|azure|google|nptel|oracle|microsoft|cisco|mern\s*stack|mernstack|sql|python essentials|essentials|workshop|cambridge|pet|zoho|coursera|udemy|bytexl|elite|analytics|data structures|algorithms|problem solving|programming)\b/i;

const looksLikeCertificationLine = (line) =>
  /\b(certification|certified|certificate|hackerrank|workshop|essentials|practitioner|associate|nptel|elite|bytexl)\b/i.test(line);

/** Real project titles — not skill catalogs. */
const looksLikeProjectTitle = (line) => {
  const text = cleanResumeItem(line);
  if (!text || looksLikeSkillListLine(text) || looksLikeCertificationLine(text) || looksLikeDateOnlyLine(text)) {
    return false;
  }
  if (/^(?:technologies|web\s*technologies|technical skills?|skills|tools?)\b/i.test(text)) return false;
  // Org / role lines with a dash are experience, not projects.
  if (/\b(remote|intern|internship|trainee|participant|workshop|sure trust)\b/i.test(line)) return false;
  if (text.split(/\s+/).length < 2) return false;
  if (PROJECT_TITLE_HINT.test(text) || PROJECT_TITLE_HINT.test(line)) return true;
  // "Food Ordering System- MERN Stack" style — right side should look like a stack/domain.
  if (/\s*[–-]\s*/.test(line) && text.split(/\s+/).length >= 2 && text.split(/\s+/).length <= 12) {
    const right = String(line).split(/\s*[–-]\s*/).slice(1).join(' - ');
    const looksLikeStack = /\b(mern|stack|react|node|python|java|nlp|ai|ml|full\s*stack|streamlit|hugging\s*face|mongodb|express)\b/i.test(right);
    return looksLikeStack && !looksLikeSkillListLine(line);
  }
  return false;
};

const extractTitleItems = (lines, { titleHint, requireHint = false, maxItems = 8, acceptLine, keepRaw = false } = {}) => {
  const merged = mergeWrappedResumeLines(lines);
  const titles = [];

  for (const raw of merged) {
    let line = cleanResumeItem(raw);
    if (!line || line.length < 3) continue;
    if (isLinkOrMetaLine(line) || isSectionNoiseLine(line) || isBulletDescriptionLine(line)) continue;
    if (looksLikeSkillListLine(line) || looksLikeSkillListLine(raw)) continue;
    if (looksLikeDateOnlyLine(line) || looksLikeDateOnlyLine(raw)) continue;

    line = line
      .replace(/\s+[A-Za-z][\w.-]*\/(?:Live\s*)?Demo\s*$/i, '')
      .replace(/\s+Live\s*Demo\s*$/i, '')
      .replace(/^(?:awarded|completed|participated in|attended)\s+/i, '')
      .replace(/["'“”]/g, '')
      .trim();
    if (!line || isLinkOrMetaLine(line)) continue;

    const wordCount = line.split(/\s+/).length;
    if (wordCount > 18) continue;
    if (wordCount === 1 && line.length < 12) continue;
    if (acceptLine && !acceptLine(line) && !acceptLine(raw)) continue;
    if (requireHint && titleHint && !titleHint.test(line) && !titleHint.test(raw)) continue;
    if (titleHint && !titleHint.test(line) && !titleHint.test(raw) && wordCount > 10) continue;

    // Prefer stack-bearing original for project titles when cleanResumeItem strips the stack.
    let display = line;
    if (keepRaw && /\s*[–-]\s*/.test(raw) && PROJECT_TITLE_HINT.test(raw)) {
      display = String(raw)
        .replace(/\s+[A-Za-z][\w.-]*\/(?:Live\s*)?Demo\s*$/i, '')
        .replace(/\s+Live\s*Demo\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    }
    titles.push(display);
  }

  return Array.from(new Set(titles)).slice(0, maxItems);
};

const SKILL_CATALOG = [
  ['JavaScript', /\b(?:javascript|js)\b/i],
  ['TypeScript', /\b(?:typescript|ts)\b/i],
  ['React', /\breact(?:\.js|js)?\b/i],
  ['Node.js', /\bnode(?:\.js|js)?\b/i],
  ['Express.js', /\bexpress(?:\.js|js)?\b/i],
  ['Python', /\bpython\b/i],
  ['Java', /\bjava\b/i],
  ['C++', /\bc\+\+\b/i],
  ['C', /(?:^|[,:;\s(|/])C(?:$|[,:;\s)|/])/],
  ['HTML', /\bhtml5?\b/i],
  ['CSS', /\bcss3?\b/i],
  ['SQL', /\bsql\b/i],
  ['MySQL', /\bmysql\b/i],
  ['MongoDB', /\bmongodb\b/i],
  ['REST APIs', /\brest(?:ful)?\s+api?s?\b/i],
  ['Git', /\bgit\b/i],
  ['GitHub', /\bgithub\b/i],
  ['VS Code', /\bvs\s*code\b/i],
  ['Jupyter', /\bjupyter\b/i],
  ['Google Colab', /\b(?:google\s*)?colab\b/i],
  ['Vercel', /\bvercel\b/i],
  ['OOP', /\boops?\b|\bobject[- ]oriented\b/i],
  ['Data Structures', /\bdata structures?\b|\bdsa\b/i],
  ['Machine Learning', /\bmachine learning\b|\bai\s*\/\s*ml\b|\bgenerative ai\b/i],
  ['TensorFlow', /\btensorflow\b/i],
  ['Scikit-learn', /\bscikit(?:-|\s)?learn\b|\bsklearn\b/i],
  ['LangChain', /\blangchain\b/i],
  ['NLP', /\bnlp\b|\bnatural language processing\b/i],
  ['Streamlit', /\bstreamlit\b/i],
  ['Hugging Face', /\bhugging\s*face\b/i],
  ['Agile', /\bagile\b/i],
  ['Problem Solving', /\bproblem[-\s]?solving\b/i],
  ['Communication', /\bcommunication(?:\s+skills)?\b/i],
];

const isSoftSkillOnlyFallback = (skills = []) => {
  const normalized = skills.map((skill) => String(skill || '').trim().toLowerCase()).filter(Boolean);
  return (
    normalized.length > 0
    && normalized.length <= 2
    && normalized.every((skill) => skill === 'communication' || skill === 'problem solving')
  );
};

const skillSectionLines = (lines) => {
  const starts = [];
  lines.forEach((line, index) => {
    if (/^(technical skills|skills|technical summary|web\s*technologies|technologies|technical competencies)$/i.test(line)) {
      starts.push(index);
    }
  });
  if (!starts.length) return [];

  const output = [];
  for (const start of starts) {
    for (let i = start + 1; i < lines.length; i += 1) {
      // Stop at major sections, but keep absorbing sibling skill headings' content via multiple starts.
      if (/^(projects?|academic projects?|personal projects?|experience|internships?|work experience|certifications?|education|career objective)$/i.test(lines[i])) {
        break;
      }
      if (/^(technical skills|skills|technical summary|web\s*technologies|technologies|technical competencies)$/i.test(lines[i])) {
        break;
      }
      const cleaned = String(lines[i] || '').replace(/^[-*•]\s*/, '').replace(/\s+/g, ' ').trim();
      if (cleaned) output.push(cleaned);
    }
  }
  return output;
};

const PROJECT_HEADING = /^(projects?|academic projects?|personal projects?)$/i;
const EXPERIENCE_HEADING = /^(experience|internships?|internship experience|work experience|professional experience|employment)$/i;
const CERTIFICATION_HEADING = /^(technical certifications|certifications(?:\s*&\s*training)?|certificates?|licenses?)$/i;
const WORKSHOP_HEADING = /^workshop participation$/i;
const LANGUAGE_HEADING = /^language proficiency$/i;
const EDUCATION_HEADING = /^(education|academic background|qualification)$/i;
const AWARDS_HEADING = /^(achievements?|awards?|honou?rs?|accomplishments?)$/i;

/** Prizes / competition wins — never work experience. */
const looksLikeAwardOrPrizeLine = (line) => {
  const text = String(line || '').trim();
  if (!text) return false;
  return (
    /\b(won|secured|awarded|prize|medal|trophy|runner[- ]?up|hackathon winner)\b/i.test(text)
    || /\b(?:1st|2nd|3rd|first|second|third)\s+place\b/i.test(text)
    || /\b(place|rank(?:ed)?)\s+in\b/i.test(text)
    || /\b(department fest|inter[- ]school|competition|contest|olympiad|quiz)\b/i.test(text)
  );
};

/** Degrees / colleges / schools — never work experience. */
const looksLikeEducationLine = (line) => {
  const text = String(line || '').trim();
  if (!text) return false;
  if (looksLikeAwardOrPrizeLine(text)) return false;
  if (/\b(intern|internship|trainee|software engineer|developer intern)\b/i.test(text)) return false;
  return (
    /\b(b\.?\s*tech|btech|m\.?\s*tech|mtech|b\.?e\.?|m\.?e\.?|bsc|msc|bca|mca|mba|phd|bachelor|master|diploma|ssc|hsc|intermediate|class\s*(?:10|12|x|xii))\b/i.test(text)
    || /\b(cgpa|gpa|percentage)\b/i.test(text)
    || (
      /\b(university|college|institute|school)\b/i.test(text)
      && !/\b(intern|internship|worked|employee|engineer|developer)\b/i.test(text)
    )
  );
};

const fallbackProjectItems = (lines, maxItems = 6) =>
  extractTitleItems(
    lines.filter((line) => looksLikeProjectTitle(line) && !/@|linkedin|github\.com|www\.|http/i.test(line)),
    {
      titleHint: PROJECT_TITLE_HINT,
      requireHint: true,
      acceptLine: looksLikeProjectTitle,
      keepRaw: true,
      maxItems,
    },
  );

const fallbackCertificationItems = (lines, maxItems = 6) => {
  const workshopTitles = lines
    .filter((line) => /^(?:participated in|attended)\b/i.test(line) || /\bworkshop\b/i.test(line))
    .map((line) => cleanResumeItem(line.replace(/^(?:participated in|attended)\s+/i, '')))
    .filter((line) => line.length >= 4 && line.split(/\s+/).length <= 14)
    .filter((line) => !looksLikeSkillListLine(line))
    .filter((line) => !looksLikeAwardOrPrizeLine(line) && !looksLikeEducationLine(line));

  const certTitles = extractTitleItems(
    lines.filter((line) =>
      CERT_TITLE_HINT.test(line)
      && !looksLikeProjectTitle(line)
      && !looksLikeSkillListLine(line)
      && !looksLikeAwardOrPrizeLine(line)
      && !looksLikeEducationLine(line)),
    { titleHint: CERT_TITLE_HINT, maxItems },
  );

  return Array.from(new Set([...certTitles, ...workshopTitles])).slice(0, maxItems);
};

const looksLikeExperienceLine = (line) => {
  const text = String(line || '').trim();
  if (!text || looksLikeSkillListLine(text) || looksLikeDateOnlyLine(text)) return false;
  if (looksLikeAwardOrPrizeLine(text) || looksLikeEducationLine(text)) return false;
  // Workshops / participation are training — not employment.
  if (/\b(workshop|participant|participated|attended)\b/i.test(text) && !/\b(intern|internship|trainee|engineer|developer|analyst)\b/i.test(text)) {
    return false;
  }
  if (looksLikeProjectTitle(text) && !/\b(intern|internship|trainee|remote|sure trust)\b/i.test(text)) {
    return false;
  }
  const hasRoleWord =
    /\b(intern|internship|trainee|engineer|developer|analyst|associate|consultant)\b/i.test(text)
    || /\b(sure trust)\b/i.test(text)
    || /\b(remote)\b/i.test(text);
  const hasDateRange =
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b.*\b(20\d{2}|present)\b/i.test(text);
  // "at Company" only counts when a role word is also present (blocks "1st place at University").
  const hasEmployerShape =
    hasRoleWord
    && (
      /\bat\s+[A-Z]/i.test(text)
      || /\b(?:worked at|experience at)\b/i.test(text)
      || /\b(?:pvt\.?|ltd\.?|llc|inc\.?|labs|systems|solutions)\b/i.test(text)
    );

  return hasRoleWord || hasDateRange || hasEmployerShape;
};

export const extractSkillsFromResumeText = (rawText, maxItems = 30) => {
  const text = String(rawText || '');
  if (!text.trim()) return [];

  const lines = resumeLines(text);
  const skillSection = skillSectionLines(lines);
  const sectionText = skillSection.length ? skillSection.join('\n') : text;
  const fromCatalog = SKILL_CATALOG
    .filter(([, pattern]) => pattern.test(sectionText))
    .map(([name]) => name);

  const categoryNoise = /^(?:programming languages?|web\s*technologies?|webtechnologies|frontend(?: technologies)?|backend(?: technologies)?|databases?|developer tools?(?: & platforms)?|core concepts?|additional knowledge|tools?|technologies)\s*:?\s*$/i;
  const fromLists = skillSection
    .flatMap((line) => {
      const payload = line.includes(':') ? line.split(':').slice(1).join(':') : line;
      return payload.split(/[,;/|•]+/);
    })
    .map((item) => item.replace(/\s+/g, ' ').replace(/\(.*?\)/g, '').trim())
    .filter((item) => item.length >= 2 && item.length <= 40)
    .filter((item) => !categoryNoise.test(item))
    .filter((item) => !/^(?:and|&|oops?|proficient in)$/i.test(item))
    .filter((item) => !/^(?:webtechnologies|technologies)\b/i.test(item))
    .filter((item) => !/^\./.test(item))
    .filter((item) => !/:\s*\w/.test(item));

  return Array.from(new Set([...fromCatalog, ...fromLists])).slice(0, maxItems);
};

export const extractResumePreview = (resume) => {
  const rawText = resume?.rawText || resume?.extractedText || '';
  const lines = resumeLines(rawText);
  const analysisSkills = Array.from(
    new Set((resume?.analysis?.skills || []).map((skill) => String(skill || '').trim()).filter(Boolean)),
  );
  const skills = analysisSkills.length && !isSoftSkillOnlyFallback(analysisSkills)
    ? analysisSkills
    : extractSkillsFromResumeText(rawText);

  // Stop project section before Technologies / skill dumps; keep only real project titles.
  const rawProjectLines = collectSectionLines(lines, PROJECT_HEADING)
    .filter((line) => !looksLikeSkillListLine(line) && !looksLikeCertificationLine(line) && !looksLikeDateOnlyLine(line));
  const projectSectionItems = extractTitleItems(rawProjectLines, {
    titleHint: PROJECT_TITLE_HINT,
    requireHint: true,
    acceptLine: looksLikeProjectTitle,
    keepRaw: true,
    maxItems: 8,
  });
  const projects = projectSectionItems.length
    ? projectSectionItems
    : fallbackProjectItems(lines, 8);

  const experienceLines = collectSectionLines(lines, EXPERIENCE_HEADING)
    .filter((line) => !looksLikeSkillListLine(line) && !isBulletDescriptionLine(line) && !looksLikeDateOnlyLine(line))
    .filter((line) => !looksLikeAwardOrPrizeLine(line) && !looksLikeEducationLine(line));

  const internships = extractTitleItems(experienceLines, {
    titleHint: /\b(intern|internship|developer|engineer|analyst|associate|trainee|sure trust|remote|worked at|experience at)\b/i,
    requireHint: true,
    acceptLine: looksLikeExperienceLine,
    maxItems: 6,
  });

  const workshopTitles = collectSectionLines(lines, WORKSHOP_HEADING)
    .map((line) => line.replace(/^(?:participated in|attended)\s+/i, '').trim())
    .filter(Boolean)
    .filter((line) => !looksLikeSkillListLine(line))
    .filter((line) => !looksLikeAwardOrPrizeLine(line) && !looksLikeEducationLine(line));

  const prizeItems = Array.from(new Set([
    ...collectSectionLines(lines, AWARDS_HEADING),
    ...lines.filter((line) => looksLikeAwardOrPrizeLine(line)),
  ]
    .map((line) => cleanResumeItem(line))
    .filter((line) => line.length >= 4 && line.split(/\s+/).length <= 18)
    .filter((line) => !looksLikeSkillListLine(line)
      && !looksLikeEducationLine(line)
      && !looksLikeExperienceLine(line))))
    .slice(0, 6);

  const certificationSectionItems = extractTitleItems(
    [
      ...collectSectionLines(lines, CERTIFICATION_HEADING),
      ...workshopTitles,
      ...collectSectionLines(lines, LANGUAGE_HEADING).filter((line) => CERT_TITLE_HINT.test(line)),
    ].filter((line) => !looksLikeSkillListLine(line)
      && !looksLikeProjectTitle(line)
      && !isBulletDescriptionLine(line)
      && !looksLikeEducationLine(line)
      && !looksLikeAwardOrPrizeLine(line)),
    { titleHint: CERT_TITLE_HINT, maxItems: 8 },
  );
  const certifications = Array.from(new Set([
    ...(certificationSectionItems.length
      ? certificationSectionItems
      : fallbackCertificationItems(lines, 8)),
    ...prizeItems,
  ])).slice(0, 12);

  return { skills, projects, internships, certifications };
};

export const buildCorrectedResumeText = (resume, structured) => {
  const rawText = resume?.rawText || resume?.extractedText || '';
  const block = [
    'Corrected Interview Profile',
    'Skills',
    ...(structured.skills || []),
    'Projects',
    ...(structured.projects || []),
    'Internships',
    ...(structured.internships || []),
    'Certifications',
    ...(structured.certifications || []),
  ].join('\n');

  return `${rawText}\n\n${block}`.trim();
};
