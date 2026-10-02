import * as crypto from 'crypto';

import { isNearDuplicateQuestion } from './interviewReport.utils';
import {
  sanitizeDateAnchoredQuestionText,
  sanitizeResumeEntityTopic,
  stripResumeDateMetadata,
} from './resumeQuestionAnchoring.utils';

import type {
  CompanyInterviewGuidance,
  GeneratedQuestion,
  InterviewRoadmap,
  InterviewRoadmapSection,
  InterviewRoadmapSectionKey,
  InterviewRuntimeState,
  JobDescriptionProfile,
  ResumeInterviewProfile,
} from './ai.service';

const COMPANY_NAMES = [
  'JPMorgan Chase',
  'Amazon',
  'UBS',
  'Bank of America',
  'Arcesium',
  'SAP',
  'Deloitte',
  'IBM',
  'Cognizant',
  'Accenture',
  'Capgemini',
  'Wipro',
  'RealPage',
  'HighRadius',
  'CDK Global',
  'Vitech Systems',
  'YASH Technologies',
  'Trianz',
  'Parexel',
  'Thryve Digital',
  'Carrier Technologies',
  'Ascensus',
  'OpenText',
  'Oracle',
  'ADP',
  'Dell',
  'Virtusa',
  'ValueLabs',
  'HCL',
  'Avineon India',
  'TEKsystems',
  'Quantela',
  'Megasoft',
  'Vertex Offshore Services',
  'Lantronix India',
  'Pennant Technologies',
  'Incipio Technologies',
  'Vilas Business Solutions',
  'Virpie Info Technologies',
  'Seanergy Digital Services',
  'Desidea Software Technologies',
  'Jointlook Services',
  'BostonLogix',
  'S2Tech',
  'Lanco Global Systems',
  'Vertex Computer Systems',
  'SmartPlay Technologies',
  'ZenQ',
  'CenturyLink',
  'MarketTools',
  'Sitel',
  'Salesforce',
  'GF Digital',
  'CenturyLink (Lumen)',
  'NTT DATA',
  'ABB',
  'Celigo',
  'Tech Mahindra',
  'Cambridge Technology',
  'Valyd Software',
  'Levadata',
  'Innopark',
  'SD Softech',
  'UMC',
  'eCentric Solutions',
  'RSA',
  'Valyd Info Solutions',
  'SmartDocs Technologies',
  'Covalense Digital',
  'Marlabs',
  'NXP Semiconductors',
  'Medtronic',
  'Collins Aerospace',
  'GlobalLogic',
  'Hitachi Solutions',
  'CGI',
  'Unisys',
  'Axtria',
  'Genpact',
  'Zensar',
  'GlobalLogic Technologies',
  'Sagility India (HGS Healthcare)',
  'TIBCO Software India',
  'Alight Solutions (NGA HR)',
  'DXC Technology India',
  'Microsoft',
  'Google',
  'Apple',
  'Meta',
  'NVIDIA',
  'Intel',
  'AMD',
  'Qualcomm',
  'Cisco',
  'Adobe',
  'VMware',
  'ServiceNow',
  'Atlassian',
  'Zoho',
  'Freshworks',
  'PayPal',
  'Walmart Global Tech',
  'Goldman Sachs',
  'Morgan Stanley',
  'American Express',
  'Visa',
  'Mastercard',
  'Flipkart',
  'Meesho',
  'PhonePe',
  'Razorpay',
  'CRED',
  'Swiggy',
  'Zomato',
  'Ola',
  'Uber',
  'InMobi',
  'Oracle Financial Services Software (OFSS)',
  'Intuit',
  'Synopsys',
  'Cadence',
  'Siemens',
  'Siemens Healthineers',
  'Honeywell',
  'Philips',
  'Bosch Global Software Technologies',
  'Schneider Electric',
  'GE Healthcare',
  'Ericsson',
  'Nokia',
  'Samsung R&D Institute India',
  'LG Soft India',
  'Harman',
  'Continental',
  'Aptiv',
  'Volvo Group',
  'Mercedes-Benz Research and Development India',
  'Renault Nissan Technology & Business Centre India',
  'Tata Elxsi',
  'LTIMindtree',
  'L&T Technology Services (LTTS)',
  'Mphasis',
  'Persistent Systems',
  'Hexaware Technologies',
  'Sonata Software',
  'Birlasoft',
  'KPIT Technologies',
  'Cyient',
  'Coforge',
  'UST',
  'Brillio',
  'Happiest Minds',
  'Nagarro',
  'Newgen Software',
  'CitiusTech',
  'Fiserv',
  'FIS',
  'Fidelity Investments',
  'FactSet',
  'Broadridge',
  'Western Digital',
  'Micron Technology',
  'AMDOCS',
  'McKinsey & Company',
  'Bain & Company',
  'KPMG',
  'EY',
  'PwC',
  'Grant Thornton',
  'RSM',
  'Ericsson India',
  'Juniper Networks',
  'Red Hat',
  'SAP Labs India',
  'Informatica',
  'Nutanix',
  'Rubrik',
  'Cohesity',
  'Cloudera',
  'Snowflake',
  'Palo Alto Networks',
  'CrowdStrike',
  'Check Point Software Technologies',
  'Fortinet',
  'Cloudflare',
  'Expedia Group',
  'Agoda',
  'Booking.com',
  'BlackRock',
  'Shell',
  'BP',
  'ExxonMobil',
  'Shell Info Technologies',
  'PepsiCo Global Business Services',
  'Unilever',
  'Procter & Gamble (P&G)',
  'Reckitt',
  'Mondelez International',
  'PepsiCo',
  'Johnson Controls',
  'Optum',
  'UnitedHealth Group',
  'Cerner (Oracle Health)',
  'Epic Systems',
  'AstraZeneca',
  'Novartis',
  'Roche',
  'Pfizer',
  'Eli Lilly',
  'Sanofi',
  "Dr. Reddy's Laboratories",
  'Biocon',
  'IQVIA',
  'Deloitte USI',
  'EY GDS',
  'PwC India',
  'KPMG India',
  'BNY',
  'State Street',
  'Barclays',
  'HSBC',
  'Standard Chartered',
  'NatWest Group',
  'Deutsche Bank',
  'Societe Generale',
  'Wells Fargo',
  'Northern Trust',
  'TCS',
  'Infosys',
  'HCLTech',
] as const;

const slugifyCompany = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const COMPANY_LABELS = Object.fromEntries(
  Array.from(new Map(COMPANY_NAMES.map((name) => [slugifyCompany(name), name])).entries()),
) as Record<string, string>;

export const COMPANY_KEYS = Object.keys(COMPANY_LABELS);

export const isKnownCompany = (company?: string) =>
  Boolean(company && Object.prototype.hasOwnProperty.call(COMPANY_LABELS, company));

const INTRO_QUESTION: GeneratedQuestion = {
  question:
    'Tell me about yourself. Walk me through your education, internship, technical skills, projects, and why you are interested in this role.',
  expectedSignals: [
    'clear career summary',
    'relevant skills and projects',
    'concise reason for the role',
  ],
  questionType: 'behavioural',
  resumeReference: 'candidate overview',
  difficulty: 'easy',
  topic: 'Candidate overview',
  followUpIntent: 'bridge-topic',
};

const normalizeCompany = (company?: string) => {
  if (!company) return undefined;
  const normalized = slugifyCompany(company.trim());
  return isKnownCompany(normalized) ? normalized : undefined;
};

export const getInterviewQuestionCount = (duration: number) => {
  if (duration <= 15) return 10;
  if (duration <= 20) return 13;
  if (duration <= 30) return 18;
  if (duration <= 45) return 26;
  return 34;
};

const normalizeTopic = (value: string) => value.replace(/\s+/g, ' ').trim();

const uniqueTopics = (values: string[]) =>
  Array.from(
    new Set(
      values
        .map((value) => sanitizeResumeEntityTopic(value) ?? normalizeTopic(value))
        .filter(Boolean),
    ),
  );

const sentenceCase = (value: string) => {
  const clean = normalizeTopic(value);
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : clean;
};

const textHas = (text: string, pattern: RegExp) => pattern.test(text);

const detectTerms = (text: string, catalog: Array<[string, RegExp]>) =>
  uniqueTopics(catalog.filter(([, pattern]) => textHas(text, pattern)).map(([label]) => label));

const PROGRAMMING_LANGUAGE_PATTERNS: Array<[string, RegExp]> = [
  ['Python', /\bpython\b/i],
  ['Java', /\bjava\b/i],
  ['C++', /\bc\+\+\b/i],
  ['C', /\bc programming\b|\blanguage c\b/i],
  ['JavaScript', /\b(?:javascript|js)\b/i],
  ['TypeScript', /\b(?:typescript|ts)\b/i],
  ['C#', /\bc#\b/i],
  ['Go', /\bgolang\b|\bgo\b/i],
  ['PHP', /\bphp\b/i],
  ['Ruby', /\bruby\b/i],
  ['Kotlin', /\bkotlin\b/i],
  ['Swift', /\bswift\b/i],
  ['R', /\br programming\b|\blanguage r\b/i],
];

const FRAMEWORK_PATTERNS: Array<[string, RegExp]> = [
  ['React', /\breact(?:\.js|js)?\b/i],
  ['Angular', /\bangular\b/i],
  ['Vue.js', /\bvue(?:\.js|js)?\b/i],
  ['Node.js', /\bnode(?:\.js|js)?\b/i],
  ['Express.js', /\bexpress(?:\.js|js)?\b/i],
  ['Next.js', /\bnext(?:\.js|js)?\b/i],
  ['Django', /\bdjango\b/i],
  ['Flask', /\bflask\b/i],
  ['FastAPI', /\bfastapi|fast api\b/i],
  ['Spring Boot', /\bspring\s*boot\b/i],
  ['Laravel', /\blaravel\b/i],
  ['Redux', /\bredux\b/i],
];

const LIBRARY_PATTERNS: Array<[string, RegExp]> = [
  ['Pandas', /\bpandas\b/i],
  ['NumPy', /\bnumpy\b/i],
  ['TensorFlow', /\btensorflow\b/i],
  ['PyTorch', /\bpytorch\b/i],
  ['Scikit-learn', /\bscikit[-\s]?learn|sklearn\b/i],
  ['OpenCV', /\bopencv\b/i],
  ['Keras', /\bkeras\b/i],
  ['LangChain', /\blangchain\b/i],
];

const DATABASE_PATTERNS: Array<[string, RegExp]> = [
  ['SQL', /\bsql\b/i],
  ['MySQL', /\bmysql\b/i],
  ['PostgreSQL', /\bpostgres(?:ql)?\b/i],
  ['MongoDB', /\bmongodb|mongo db\b/i],
  ['Redis', /\bredis\b/i],
  ['Oracle Database', /\boracle database|oracle sql\b/i],
  ['SQLite', /\bsqlite\b/i],
  ['Firebase', /\bfirebase\b/i],
];

const CLOUD_PATTERNS: Array<[string, RegExp]> = [
  ['AWS', /\baws|amazon web services\b/i],
  ['Azure', /\bazure\b/i],
  ['Google Cloud', /\bgcp|google cloud\b/i],
  ['Docker', /\bdocker\b/i],
  ['Kubernetes', /\bkubernetes|k8s\b/i],
  ['Terraform', /\bterraform\b/i],
  ['Jenkins', /\bjenkins\b/i],
  ['CI/CD', /\bci\/cd|continuous integration|continuous deployment\b/i],
];

const OS_PATTERNS: Array<[string, RegExp]> = [
  ['Linux', /\blinux\b/i],
  ['Unix', /\bunix\b/i],
  ['Windows', /\bwindows\b/i],
  ['macOS', /\bmacos|mac os\b/i],
];

const TOOL_PATTERNS: Array<[string, RegExp]> = [
  ['GitHub', /\bgithub\b/i],
  ['Git', /\bgit\b/i],
  ['Postman', /\bpostman\b/i],
  ['VS Code', /\bvs\s*code|visual studio code\b/i],
  ['Jira', /\bjira\b/i],
  ['Figma', /\bfigma\b/i],
  ['Excel', /\bexcel|ms excel|microsoft excel\b/i],
  ['Google Sheets', /\bgoogle sheets?\b/i],
  ['Tableau', /\btableau\b/i],
  ['Power BI', /\bpower\s*bi\b/i],
];

const TECHNICAL_SKILL_PATTERNS: Array<[string, RegExp]> = [
  ['OOP', /\boop|object[-\s]?oriented\b/i],
  ['Data Structures', /\bdata structures?\b|\bdsa\b/i],
  ['Algorithms', /\balgorithms?\b|\bdsa\b/i],
  ['REST APIs', /\brest(?:ful)?\s+api?s?\b/i],
  ['GraphQL', /\bgraphql\b/i],
  ['Machine Learning', /\bmachine learning|\bml\b/i],
  ['Deep Learning', /\bdeep learning\b/i],
  ['Artificial Intelligence', /\bartificial intelligence|\bai\b/i],
  ['Generative AI', /\bgenerative ai|genai|llm|large language model\b/i],
  ['RAG', /\brag|retrieval augmented generation\b/i],
  ['Vector Databases', /\bvector database|embeddings?\b/i],
  ['System Design', /\bsystem design\b/i],
  ['DBMS', /\bdbms\b/i],
  ['Operating Systems', /\boperating systems?\b|\bos\b/i],
  ['Computer Networks', /\bcomputer networks?|networking\b/i],
  ['Cyber Security', /\bcyber ?security|security\b/i],
  ['Data Analysis', /\bdata analysis|data analytics\b/i],
  ['Data Cleaning', /\bdata cleaning|clean(?:ed|ing)? data|data preprocessing\b/i],
  ['Data Visualization', /\bdata visualization|visuali[sz](?:e|ation)|charts?|graphs?\b/i],
  ['Statistics', /\bstatistics?|statistical analysis\b/i],
  ['Dashboarding', /\bdashboards?|dashboarding\b/i],
  ['ETL', /\betl|extract transform load\b/i],
  ['HTML', /\bhtml\b/i],
  ['CSS', /\bcss\b/i],
  ['Digital Marketing', /\bdigital marketing\b/i],
  ['SEO', /\bseo|search engine optimization\b/i],
  ['SEM', /\bsem|search engine marketing\b/i],
  ['Google Ads', /\bgoogle ads|adwords\b/i],
  ['Meta Ads', /\bmeta ads|facebook ads|instagram ads\b/i],
  ['Social Media Marketing', /\bsocial media marketing|social media\b/i],
  ['Content Marketing', /\bcontent marketing|content strategy\b/i],
  ['Email Marketing', /\bemail marketing\b/i],
  ['Google Analytics', /\bgoogle analytics|ga4\b/i],
  ['PPC', /\bppc|pay per click\b/i],
  ['Campaign Management', /\bcampaign management|campaign strategy\b/i],
  ['Conversion Optimization', /\bconversion optimization|cro\b/i],
];

const SOFT_SKILL_PATTERNS: Array<[string, RegExp]> = [
  ['Communication', /\bcommunication|presentation\b/i],
  ['Leadership', /\bleadership|led\b/i],
  ['Teamwork', /\bteamwork|collaboration|collaborated\b/i],
  ['Problem Solving', /\bproblem[-\s]?solving|debugging\b/i],
  ['Adaptability', /\badaptability|learned quickly|fast[-\s]?paced\b/i],
];

const SECTION_HEADINGS: Record<string, RegExp> = {
  careerObjective: /^(career objective|objective|profile summary|summary)$/i,
  projects: /^(projects?|academic projects?|personal projects?)$/i,
  internships: /^(internships?|internship experience|training)$/i,
  workExperience: /^(work experience|professional experience|employment|experience)$/i,
  technicalSkills: /^(technical skills?|skills|technical summary)$/i,
  certifications: /^(certifications?(?:\s*&\s*training)?|certificates?|licenses?|technical certifications)$/i,
  achievements: /^(achievements?|awards?|honou?rs?)$/i,
  hackathons: /^(hackathons?|coding competitions?)$/i,
  researchPapers: /^(research papers?|research work)$/i,
  publications: /^(publications?)$/i,
  leadership: /^(leadership|positions? of responsibility|responsibilities)$/i,
  areasOfInterest: /^(areas? of interest|interests?)$/i,
  coursework: /^(coursework|relevant coursework|courses|subjects)$/i,
  education: /^(education|academic background|qualification)$/i,
  languageProficiency: /^(language proficiency|languages)$/i,
  additionalInformation: /^(additional information|core competencies)$/i,
};

const SECTION_LABEL_PATTERN =
  /(^|\n)\s*(Career Objective|Objective|Profile Summary|Summary|Education|Academic Background|Qualification|Technical Skills|Skills|Technical Summary|Projects?|Academic Projects?|Personal Projects?|Internships?|Internship Experience|Training|Work Experience|Professional Experience|Employment|Experience|Certifications?(?:\s*&\s*Training)?|Certificates?|Licenses?|Technical Certifications|Achievements?|Awards?|Honou?rs?|Hackathons?|Coding Competitions?|Research Papers?|Research Work|Publications?|Leadership|Positions? of Responsibility|Responsibilities|Areas? of Interest|Interests?|Coursework|Relevant Coursework|Courses|Subjects|Language Proficiency|Languages|Additional Information|Core Competencies)\b\s*:?\s*/gim;

const MAX_RESUME_TEXT_CHARS = 180000;
const MAX_SECTION_LINES = 28;

const boundResumeText = (resumeText?: string) => {
  const text = resumeText ?? '';
  if (text.length <= MAX_RESUME_TEXT_CHARS) return text;
  return `${text.slice(0, 120000)}\n${text.slice(-60000)}`;
};

const normalizeResumeTextForParsing = (resumeText?: string) =>
  boundResumeText(resumeText)
    .replace(/\r/g, '\n')
    .replace(/[|·]/g, '\n')
    .replace(/[•●▪◆]/g, '\n')
    .replace(SECTION_LABEL_PATTERN, '\n$2\n');

const splitResumeLines = (resumeText?: string) =>
  normalizeResumeTextForParsing(resumeText)
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s>*-]+/, '').trim())
    .filter((line) => line.length > 1);

const isLikelyHeading = (line: string) =>
  Object.values(SECTION_HEADINGS).some((pattern) => pattern.test(line)) ||
  (/^[A-Z][A-Z\s/&-]{2,}$/.test(line) && line.length <= 50);

const extractSectionLines = (lines: string[], heading: RegExp) => {
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) return [];
  const output: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (isLikelyHeading(line) && output.length > 0) break;
    if (!isLikelyHeading(line)) output.push(line);
  }
  return output.slice(0, MAX_SECTION_LINES);
};

const extractNamedItems = (lines: string[], fallbackPattern: RegExp, maxItems = 8) =>
  uniqueTopics(
    lines
      .filter((line) => line.length >= 4)
      .map((line) => cleanBullet(line).replace(/\s+\|\s+.*$/, '').replace(/\s+-\s+.*$/, '').trim())
      .filter((line) => fallbackPattern.test(line) || line.split(/\s+/).length <= 12),
  ).slice(0, maxItems);

const cleanBullet = (line: string) =>
  line
    .replace(/^[•\-\u2022\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();

const cleanProjectName = (line: string) => {
  let cleaned = cleanBullet(line)
    .replace(/\s+(?:ChatBot|LifeConnect)?\/Live Demo.*$/i, '')
    .trim();
  // Keep the exact project title; strip tech-stack tags or long prose after a dash (A05, E01).
  const dashSplit = cleaned.match(/^(.{4,80}?)\s+[–-]\s+(.+)$/);
  if (dashSplit) {
    const right = dashSplit[2].trim();
    const rightWords = right.split(/\s+/).filter(Boolean).length;
    const looksLikeStack =
      rightWords <= 8
      && (/[,/|&]|react|node|python|java|aws|sql|mern|nlp|ai|ml|stack/i.test(right));
    const looksLikeProse = rightWords >= 6 && !looksLikeStack;
    if (looksLikeStack || looksLikeProse) {
      cleaned = dashSplit[1].trim();
    }
  }
  return cleaned;
};

const extractProjectItems = (lines: string[], maxItems = 8) =>
  uniqueTopics(
    lines
      .map(cleanProjectName)
      .filter((line) => line.length >= 4)
      .filter((line) => !/^(?:\d+\s+of\s+\d+|developed|built|implemented|deployed|integrated|designed)\b/i.test(line))
      .filter((line) => /\b(project|app|system|platform|model|dashboard|website|portal|engine|chatbot|tracker|finder)\b/i.test(line) || line.split(/\s+/).length <= 6),
  ).slice(0, maxItems);

const fallbackProjectItems = (lines: string[], maxItems = 6) =>
  uniqueTopics(
    lines
      .filter((line) => /\b(project|app|application|system|platform|portal|dashboard|website|chatbot|model|api|service|tracker|management)\b/i.test(line))
      .filter((line) => !/@|linkedin|github\.com|www\.|http/i.test(line))
      .map(cleanProjectName)
      .filter((line) => line.split(/\s+/).length <= 10)
      .filter((line) => !/^(?:developed|built|implemented|created|designed|used|worked|responsible)\b/i.test(line)),
  ).slice(0, maxItems);

const cleanExperienceName = (line: string) => stripResumeDateMetadata(cleanBullet(line));

/** Skill/tool catalog lines must never become "internship at Developer Tools…". */
const SKILL_CATALOG_HEADING =
  /^(?:developer tools?(?:\s*&\s*platforms?)?|programming languages?|frontend technologies|backend technologies|databases?|technical skills?|core concepts?|additional knowledge|soft skills?|tools?(?:\s*&\s*platforms?)?|frameworks?|libraries|skills)$/i;

const isSkillOrToolCatalogLine = (line: string) => {
  const text = cleanBullet(line);
  if (!text) return false;

  // Exact catalog headings (do NOT use bare "frontend/backend" — those match real job titles).
  if (SKILL_CATALOG_HEADING.test(text)) return true;

  // "Developer Tools & Platforms: Git, GitHub, …"
  const heading = (text.split(':')[0] || '').trim();
  if (heading && heading.length <= 48 && SKILL_CATALOG_HEADING.test(heading)) {
    return true;
  }

  // Pure tool dumps with no role/employer markers.
  if (
    /^(?:git|github|vs\s*code|google colab|jupyter|render|vercel|postman|docker)(?:\s*[,/&]|$).*/i.test(text)
    || (
      /\b(git|github|vs\s*code|colab|jupyter|render|vercel)\b/i.test(text)
      && (text.match(/,/g) || []).length >= 2
      && !/\b(intern|internship|trainee|engineer|developer|analyst|at )\b/i.test(text)
    )
  ) {
    return true;
  }
  return false;
};

const looksLikeRoleOrEmployerLine = (line: string) => {
  const text = cleanExperienceName(line);
  if (!text || text.split(/\s+/).length > 18) return false;
  if (isSkillOrToolCatalogLine(text)) return false;

  // Prizes / education must never land in work experience.
  if (
    /\b(won|secured|awarded|prize|medal|trophy|runner[- ]?up)\b/i.test(text)
    || /\b(?:1st|2nd|3rd|first|second|third)\s+place\b/i.test(text)
    || /\b(department fest|inter[- ]school|competition|contest|olympiad)\b/i.test(text)
  ) {
    return false;
  }
  if (
    /\b(b\.?\s*tech|btech|m\.?\s*tech|mtech|b\.?e\.?|m\.?e\.?|bsc|msc|bca|mca|mba|phd|bachelor|master|diploma|cgpa|gpa)\b/i.test(text)
    || (
      /\b(university|college|institute|school)\b/i.test(text)
      && !/\b(intern|internship|worked|employee|engineer|developer)\b/i.test(text)
    )
  ) {
    return false;
  }
  // Workshops / participation without an employment role.
  if (/\b(workshop|participant|participated|attended)\b/i.test(text) && !/\b(intern|internship|trainee|engineer|developer|analyst)\b/i.test(text)) {
    return false;
  }

  const hasRoleWord =
    /\b(intern|internship|trainee|engineer|developer|analyst|consultant|associate)\b/i.test(text);
  if (!hasRoleWord) return false;

  // Employer / role shape (blocks bare "developer" inside skill lists).
  const shaped =
    /\b(?:intern|internship|trainee)\b/i.test(text)
    || /\bat\s+[A-Za-z]/i.test(text)
    || /\b(?:worked at|experience at)\b/i.test(text)
    || /\b(?:pvt\.?|ltd\.?|llc|inc\.?|corp\.?|solutions|labs|systems)\b/i.test(text)
    || /\b(?:software|senior|junior|graduate|backend|frontend|full\s*stack|data|ml|ai|sde)\s+(?:engineer|developer|intern|analyst)\b/i.test(text);

  return shaped;
};

const extractExperienceItems = (lines: string[], maxItems = 6) =>
  uniqueTopics(lines.map(cleanExperienceName).filter(looksLikeRoleOrEmployerLine)).slice(0, maxItems);

const fallbackExperienceItems = (lines: string[], maxItems = 5) =>
  uniqueTopics(lines.map(cleanExperienceName).filter(looksLikeRoleOrEmployerLine)).slice(0, maxItems);

const extractCertificationItems = (lines: string[], maxItems = 8) =>
  uniqueTopics(
    lines
      .map(cleanBullet)
      .filter((line) => line.length >= 4)
      .filter((line) => !/^(technical certifications|professional development)$/i.test(line))
      .map((line) => line.replace(/\s+[–-]\s+.*$/, '').trim())
      .filter((line) => /\b(certification|certified|sql|python|mern|aws|azure|google|tensorflow|oracle|microsoft|nptel|zoho|cambridge|pet)\b/i.test(line)),
  ).slice(0, maxItems);

const fallbackCertificationItems = (lines: string[], maxItems = 6) =>
  uniqueTopics(
    lines
      .filter((line) => /\b(certification|certified|certificate|hackerrank|coursera|udemy|nptel|practitioner|associate|professional|fundamentals|essentials)\b/i.test(line))
      .filter((line) => !/\b(project|app|system|platform|dashboard|website|portal)\b/i.test(line))
      .map(cleanBullet)
      .map((line) => line.replace(/\s+[–-]\s+.*$/, '').trim())
      .filter((line) => line.length >= 4 && line.split(/\s+/).length <= 12),
  ).slice(0, maxItems);

const extractEducation = (lines: string[]) => {
  const educationLines = extractSectionLines(lines, SECTION_HEADINGS.education);
  const allText = lines.join('\n');
  const educationText = educationLines.join('\n') || allText;
  const degree =
    educationText.match(/\bB\.?\s?Tech\b|\bBTech\b/i)?.[0] ??
    educationText.match(/\bM\.?\s?Tech\b|\bMTech\b/i)?.[0] ??
    educationText.match(/\bB\.E\.?\b|\bBE\b/)?.[0] ??
    educationText.match(/\bM\.E\.?\b|\bME\b/)?.[0] ??
    educationText.match(/\b(BSc|MSc|BCA|MCA|MBA|PhD)\b/i)?.[0];
  return {
    education: educationLines.slice(0, 5),
    degree,
    branch: educationText.match(/\b(?:Computer Science|Information Technology|Electronics|Electrical|Mechanical|Civil|AI|Data Science|Cyber Security)[^,\n]*/i)?.[0],
    cgpa: educationText.match(/\b(?:CGPA|GPA)\s*[:\-]?\s*([0-9.]+\/?[0-9.]*)/i)?.[1],
    college:
      educationLines.find((line) => /\b(university|college|institute|school)\b/i.test(line)) ??
      lines.find((line) => /\b(university|college|institute)\b/i.test(line)),
  };
};

export const analyzeResumeForInterview = ({
  resumeText,
  resumeSkills = [],
  resumeSummary,
  roleDomain,
  targetCompany,
}: {
  resumeText?: string;
  resumeSkills?: string[];
  resumeSummary?: string;
  roleDomain: string;
  targetCompany?: string;
}): ResumeInterviewProfile => {
  const lines = splitResumeLines(resumeText);
  const fullText = `${normalizeResumeTextForParsing(resumeText)}\n${resumeSummary ?? ''}\n${resumeSkills.join(' ')}`;
  const education = extractEducation(lines);
  const firstContentLine = lines.find((line) => !isLikelyHeading(line) && !/@|http|www\.|linkedin|github/i.test(line));
  const experienceSectionLines = extractSectionLines(lines, SECTION_HEADINGS.workExperience);
  const experienceSectionItems = extractExperienceItems(experienceSectionLines, 6);
  const experienceItems = experienceSectionItems.length
    ? experienceSectionItems
    : fallbackExperienceItems(lines, 6);
  const projectSectionItems = extractProjectItems(extractSectionLines(lines, SECTION_HEADINGS.projects), 8);
  const projects = projectSectionItems.length ? projectSectionItems : fallbackProjectItems(lines, 8);
  const internships = uniqueTopics([
    ...extractExperienceItems(extractSectionLines(lines, SECTION_HEADINGS.internships), 5),
    ...experienceItems.filter((item) => /\bintern\b/i.test(item)),
  ]).slice(0, 5);
  const workExperience = experienceItems;
  const certificationSectionItems = extractCertificationItems(extractSectionLines(lines, SECTION_HEADINGS.certifications), 8);
  const certifications = certificationSectionItems.length ? certificationSectionItems : fallbackCertificationItems(lines, 8);
  const coursework = extractNamedItems(extractSectionLines(lines, SECTION_HEADINGS.coursework), /\b(data structures?|algorithms?|dbms|operating systems?|computer networks?|machine learning|artificial intelligence|cloud|software engineering|statistics|marketing|analytics)\b/i, 10);
  const interests = extractNamedItems(extractSectionLines(lines, SECTION_HEADINGS.areasOfInterest), /\b(ai|cloud|web|data|security|software|machine learning|marketing|analytics|development)\b/i, 8);

  const programmingLanguages = uniqueTopics([...detectTerms(fullText, PROGRAMMING_LANGUAGE_PATTERNS), ...resumeSkills.filter((skill) => detectTerms(skill, PROGRAMMING_LANGUAGE_PATTERNS).length)]);
  const frameworks = uniqueTopics([...detectTerms(fullText, FRAMEWORK_PATTERNS), ...resumeSkills.filter((skill) => detectTerms(skill, FRAMEWORK_PATTERNS).length)]);
  const libraries = uniqueTopics([...detectTerms(fullText, LIBRARY_PATTERNS), ...resumeSkills.filter((skill) => detectTerms(skill, LIBRARY_PATTERNS).length)]);
  const databases = uniqueTopics([...detectTerms(fullText, DATABASE_PATTERNS), ...resumeSkills.filter((skill) => detectTerms(skill, DATABASE_PATTERNS).length)]);
  const cloudTechnologies = uniqueTopics([...detectTerms(fullText, CLOUD_PATTERNS), ...resumeSkills.filter((skill) => detectTerms(skill, CLOUD_PATTERNS).length)]);
  const operatingSystems = detectTerms(fullText, OS_PATTERNS);
  const developerTools = uniqueTopics([...detectTerms(fullText, TOOL_PATTERNS), ...resumeSkills.filter((skill) => detectTerms(skill, TOOL_PATTERNS).length)]);
  const technicalSkills = uniqueTopics([...detectTerms(fullText, TECHNICAL_SKILL_PATTERNS), ...resumeSkills]);
  const softSkills = detectTerms(fullText, SOFT_SKILL_PATTERNS);

  return {
    candidateInformation: {
      name: firstContentLine,
      ...education,
    },
    skills: {
      programmingLanguages,
      frameworks,
      libraries,
      databases,
      cloudTechnologies,
      operatingSystems,
      developerTools,
      versionControl: developerTools.filter((tool) => /git/i.test(tool)),
      technicalSkills,
      softSkills,
    },
    projects,
    internships,
    workExperience,
    certifications,
    coursework,
    achievements: extractNamedItems(extractSectionLines(lines, SECTION_HEADINGS.achievements), /\b(winner|award|rank|selected|achieved|won|secured|place|prize|medal|competition)\b/i, 6),
    hackathons: extractNamedItems(extractSectionLines(lines, SECTION_HEADINGS.hackathons), /\b(hackathon|competition|challenge)\b/i, 5),
    researchPapers: extractNamedItems(extractSectionLines(lines, SECTION_HEADINGS.researchPapers), /\b(research|paper)\b/i, 4),
    publications: extractNamedItems(extractSectionLines(lines, SECTION_HEADINGS.publications), /\b(publication|published|journal|conference)\b/i, 4),
    leadership: extractNamedItems(extractSectionLines(lines, SECTION_HEADINGS.leadership), /\b(lead|coordinator|captain|president|secretary|managed)\b/i, 5),
    positionsOfResponsibility: extractNamedItems(extractSectionLines(lines, SECTION_HEADINGS.leadership), /\b(lead|coordinator|captain|president|secretary|managed)\b/i, 5),
    strengths: uniqueTopics([...softSkills, ...technicalSkills.slice(0, 4)]).slice(0, 6),
    areasOfInterest: uniqueTopics([
      ...interests,
      roleDomain,
    ]).slice(0, 6),
    interests,
    targetJobRole: roleDomain,
    expectedCompany: targetCompany ? COMPANY_LABELS[normalizeCompany(targetCompany) ?? ''] ?? targetCompany : undefined,
  };
};

const getDifficultyLimits = (complexity?: string) => {
  if (complexity === 'Advanced') return { difficulty: 'Hard' as const, projectQuestionLimit: 4, followUpLimit: 3 };
  if (complexity === 'Beginner') return { difficulty: 'Easy' as const, projectQuestionLimit: 2, followUpLimit: 1 };
  return { difficulty: 'Medium' as const, projectQuestionLimit: 3, followUpLimit: 2 };
};

const allTechnicalSkillTopics = (profile: ResumeInterviewProfile, jdProfile?: JobDescriptionProfile) =>
  uniqueTopics([
    ...(jdProfile?.requiredSkills ?? []),
    ...(jdProfile?.toolsTechnologies ?? []),
    ...profile.skills.programmingLanguages,
    ...profile.skills.frameworks,
    ...profile.skills.libraries,
    ...profile.skills.databases,
    ...profile.skills.cloudTechnologies,
    ...profile.skills.developerTools,
    ...profile.skills.technicalSkills,
  ]).filter((skill) => !profile.skills.softSkills.includes(skill));

const skillQuestionDepth = (duration: number, complexity?: string) => {
  if (duration >= 60) return complexity === 'Beginner' ? 2 : 3;
  if (duration >= 45) return complexity === 'Advanced' ? 3 : 2;
  if (duration >= 30) return complexity === 'Beginner' ? 1 : 2;
  return 1;
};

const isTechnicalInterviewRole = (roleDomain: string) =>
  /\b(?:sde|software\s+development\s+engineer|software|developer|engineer|frontend|backend|full\s*stack|data\s*(?:scientist|analyst|engineer)|ml|machine learning|ai|devops|cloud|cyber|security|qa|test|sdet|database|system|architect|programmer)\b/i.test(roleDomain);

const profileTopicText = (profile?: ResumeInterviewProfile, jdProfile?: JobDescriptionProfile) =>
  uniqueTopics([
    ...(profile?.skills.programmingLanguages ?? []),
    ...(profile?.skills.frameworks ?? []),
    ...(profile?.skills.libraries ?? []),
    ...(profile?.skills.databases ?? []),
    ...(profile?.skills.cloudTechnologies ?? []),
    ...(profile?.skills.developerTools ?? []),
    ...(profile?.skills.technicalSkills ?? []),
    ...(profile?.projects ?? []),
    ...(profile?.internships ?? []),
    ...(profile?.workExperience ?? []),
    ...(profile?.certifications ?? []),
    ...(profile?.coursework ?? []),
    ...(profile?.areasOfInterest ?? []),
    ...(jdProfile?.requiredSkills ?? []),
    ...(jdProfile?.toolsTechnologies ?? []),
    ...(jdProfile?.responsibilities ?? []),
  ]).join(' ');

const profileHas = (profile: ResumeInterviewProfile | undefined, pattern: RegExp, jdProfile?: JobDescriptionProfile) =>
  pattern.test(profileTopicText(profile, jdProfile));

const firstMatchingTopic = (topics: string[], pattern: RegExp) =>
  topics.find((topic) => pattern.test(topic));

const profileSkills = (profile?: ResumeInterviewProfile, jdProfile?: JobDescriptionProfile) =>
  uniqueTopics([
    ...(jdProfile?.requiredSkills ?? []),
    ...(jdProfile?.toolsTechnologies ?? []),
    ...(profile?.skills.programmingLanguages ?? []),
    ...(profile?.skills.frameworks ?? []),
    ...(profile?.skills.libraries ?? []),
    ...(profile?.skills.databases ?? []),
    ...(profile?.skills.cloudTechnologies ?? []),
    ...(profile?.skills.developerTools ?? []),
    ...(profile?.skills.technicalSkills ?? []),
  ]);

const primaryProject = (profile?: ResumeInterviewProfile) =>
  profile?.projects[0];

const projectReference = (profile?: ResumeInterviewProfile) =>
  primaryProject(profile) ? `your ${primaryProject(profile)} project` : 'one of your projects';

const roleSpecificTopics = (roleDomain: string, resumeProfile?: ResumeInterviewProfile, jdProfile?: JobDescriptionProfile) => {
  if (/\bdata\s*analyst|analytics analyst|business intelligence|bi analyst\b/i.test(roleDomain)) {
    return ['data collection', 'data cleaning', 'SQL querying', 'Excel analysis', 'Power BI dashboards', 'KPI reporting', 'insight communication'];
  }

  if (/\bdigital\s*marketing|marketing\b/i.test(roleDomain)) {
    return [
      'campaign strategy',
      'SEO and SEM',
      'social media marketing',
      'content planning',
      'marketing analytics',
      'conversion optimization',
      'budget allocation',
    ];
  }

  if (/\bai|artificial intelligence|ml|machine learning\b/i.test(roleDomain)) {
    return ['model selection', 'data preprocessing', 'feature evaluation', 'model validation', 'AI product integration', 'responsible AI checks', 'model deployment and monitoring'];
  }

  if (/\bsde|software\s+development\s+engineer|software|developer|programmer\b/i.test(roleDomain)) {
    const skills = profileSkills(resumeProfile, jdProfile);
    const backendRuntime =
      firstMatchingTopic(skills, /\bnode(?:\.js)?\b/i) ??
      firstMatchingTopic(skills, /\bexpress(?:\.js)?\b/i) ??
      firstMatchingTopic(skills, /\bjava\b|\bspring\b/i) ??
      firstMatchingTopic(skills, /\bpython\b|\bdjango\b|\bflask\b|\bfastapi\b/i);
    const frontendFramework = firstMatchingTopic(skills, /\breact(?:\.js)?\b|\bangular\b|\bvue(?:\.js)?\b|\bnext(?:\.js)?\b/i);
    const apiTopic = firstMatchingTopic(skills, /\brest(?:ful)?\s+api?s?\b|\bgraphql\b|\bapi\b/i);

    return uniqueTopics([
      'software development career choice',
      backendRuntime ? `${backendRuntime} request handling and concurrency` : 'backend request handling and concurrency',
      frontendFramework ? `${frontendFramework} performance optimization` : undefined,
      'processes and threads',
      apiTopic ? `${apiTopic} production debugging` : 'production service debugging',
      primaryProject(resumeProfile) ? `scalable secure architecture for ${primaryProject(resumeProfile)}` : 'scalable secure architecture',
    ].filter(Boolean) as string[]);
  }

  if (/\bfrontend\b/i.test(roleDomain)) {
    return ['responsive UI implementation', 'state management', 'API integration', 'accessibility', 'frontend performance optimization', 'browser debugging'];
  }

  if (/\bbackend\b/i.test(roleDomain)) {
    return ['API design basics', 'database interaction', 'authentication flow', 'error handling', 'backend request handling and concurrency', 'testing strategy'];
  }

  if (/\bqa|quality assurance|test engineer|sdet\b/i.test(roleDomain)) {
    return ['test case design', 'bug reporting', 'API testing', 'automation framework design', 'regression testing', 'defect triage'];
  }

  if (/\bbusiness\s*analyst|product|sales|operations|hr|human resources|finance|accounting\b/i.test(roleDomain)) {
    return ['requirements analysis', 'stakeholder communication', 'metrics and reporting', 'business impact'];
  }

  return ['role responsibilities', 'practical workflow', 'tools used', 'success metrics'];
};

const resumeSkillTopics = (resumeProfile: ResumeInterviewProfile) =>
  uniqueTopics([
    ...resumeProfile.skills.programmingLanguages,
    ...resumeProfile.skills.databases,
    ...resumeProfile.skills.developerTools,
    ...resumeProfile.skills.frameworks,
    ...resumeProfile.skills.libraries,
    ...resumeProfile.skills.cloudTechnologies,
    ...resumeProfile.skills.technicalSkills,
  ]).filter((skill) => !resumeProfile.skills.softSkills.includes(skill));

const problemSolvingTopicsForRole = (roleDomain: string, resumeProfile: ResumeInterviewProfile) => {
  const resumeTopics = resumeSkillTopics(resumeProfile);
  if (resumeTopics.length) return resumeTopics.slice(0, 8);

  return isTechnicalInterviewRole(roleDomain)
    ? roleSpecificTopics(roleDomain, resumeProfile).slice(0, 6)
    : uniqueTopics(['role scenario', 'prioritization', 'metrics analysis', 'execution plan']);
};

const sparseResumeFallbackTopics = (roleDomain: string, resumeProfile: ResumeInterviewProfile) => {
  const hasSparseEvidence =
    resumeProfile.projects.length === 0 &&
    resumeProfile.internships.length === 0 &&
    resumeProfile.workExperience.length === 0 &&
    resumeSkillTopics(resumeProfile).length <= 2;

  if (!hasSparseEvidence) return [];

  if (isTechnicalInterviewRole(roleDomain)) {
    return ['core fundamentals for the role', 'small project idea', 'debugging basics', 'testing and validation'];
  }

  return ['role motivation', 'transferable strengths', 'learning plan', 'practical role scenario'];
};

const prioritizeCertificationTopics = (certifications: string[], roleDomain: string) => {
  const technicalRole = isTechnicalInterviewRole(roleDomain);
  if (!technicalRole) return certifications;

  return [...certifications].sort((left, right) => {
    const score = (value: string) =>
      (/\bsql\b|hackerrank/i.test(value) ? 0 : 10) +
      (/\bpython\b/i.test(value) ? 1 : 0) +
      (/\bmern|full\s*stack|web development/i.test(value) ? 2 : 0);
    return score(left) - score(right);
  });
};

const shouldAskSystemDesign = (
  roleDomain: string,
  roleLevel: string,
  skillTopics: string[],
  jdProfile?: JobDescriptionProfile,
) => {
  const explicitSystemDesign = uniqueTopics([
    roleDomain,
    ...skillTopics,
    ...(jdProfile?.requiredSkills ?? []),
    ...(jdProfile?.responsibilities ?? []),
    ...(jdProfile?.toolsTechnologies ?? []),
  ]).some((topic) => /\b(system design|architecture|scalability|distributed systems|microservices|platform architecture)\b/i.test(topic));

  return isTechnicalInterviewRole(roleDomain) && (explicitSystemDesign || roleLevel === 'Senior' || roleLevel === 'Lead');
};

const distributeBudget = (sections: Omit<InterviewRoadmapSection, 'questionBudget'>[], targetQuestionCount: number) => {
  const weights: Record<InterviewRoadmapSectionKey, number> = {
    self_introduction: 1,
    resume_overview: 1,
    coursework: 1,
    programming_languages: 2,
    technical_skills: 4,
    projects: 5,
    internship: 2,
    certifications: 2,
    role_specific: 3,
    company_specific: 3,
    coding_problem_solving: 2,
    system_design: 2,
    behavioral: 2,
    hr: 1,
    candidate_questions: 0,
    closing: 0,
  };
  const totalWeight = sections.reduce((sum, section) => sum + (weights[section.key] ?? 1), 0) || 1;
  let remaining = targetQuestionCount;
  return sections.map((section, index) => {
    const isLast = index === sections.length - 1;
    const budget = isLast ? remaining : Math.max(1, Math.round((targetQuestionCount * (weights[section.key] ?? 1)) / totalWeight));
    remaining = Math.max(0, remaining - budget);
    return { ...section, questionBudget: budget };
  });
};

export const buildInterviewRoadmap = ({
  resumeText,
  resumeSkills = [],
  resumeSummary,
  roleDomain,
  roleLevel,
  duration,
  complexity,
  targetCompany,
  jdProfile,
  companyGuidance,
}: {
  resumeText?: string;
  resumeSkills?: string[];
  resumeSummary?: string;
  roleDomain: string;
  roleLevel: string;
  duration: number;
  complexity?: string;
  targetCompany?: string;
  jdProfile?: JobDescriptionProfile;
  companyGuidance?: CompanyInterviewGuidance;
}): InterviewRoadmap => {
  const resumeProfile = analyzeResumeForInterview({ resumeText, resumeSkills, resumeSummary, roleDomain, targetCompany });
  const technicalRole = isTechnicalInterviewRole(roleDomain);
  const technicalSkillTopics = allTechnicalSkillTopics(resumeProfile, jdProfile);
  const systemDesignApplicable = shouldAskSystemDesign(roleDomain, roleLevel, technicalSkillTopics, jdProfile);
  const targetQuestionCount = getInterviewQuestionCount(duration);
  const limits = getDifficultyLimits(complexity);
  const technicalTopics = uniqueTopics([
    ...technicalSkillTopics,
    ...sparseResumeFallbackTopics(roleDomain, resumeProfile),
  ]).slice(0, 30);
  const sections: Omit<InterviewRoadmapSection, 'questionBudget'>[] = [
    { key: 'self_introduction', title: 'Self Introduction', topics: ['Candidate overview'] },
    { key: 'resume_overview', title: 'Resume Overview', topics: uniqueTopics([resumeProfile.candidateInformation.degree ?? '', resumeProfile.candidateInformation.college ?? '', roleDomain]).slice(0, 4) },
    ...(resumeProfile.coursework.length
      ? [{ key: 'coursework' as const, title: 'Coursework', topics: resumeProfile.coursework }]
      : []),
    ...(resumeProfile.skills.programmingLanguages.length
      ? [{ key: 'programming_languages' as const, title: 'Programming Languages', topics: resumeProfile.skills.programmingLanguages }]
      : []),
    ...(technicalTopics.length
      ? [{ key: 'technical_skills' as const, title: 'Technical Skills', topics: technicalTopics }]
      : []),
    ...(resumeProfile.projects.length
      ? [{ key: 'projects' as const, title: 'Projects', topics: resumeProfile.projects }]
      : []),
    ...(resumeProfile.internships.length || resumeProfile.workExperience.length
      ? [{ key: 'internship' as const, title: 'Internship / Work Experience', topics: uniqueTopics([...resumeProfile.internships, ...resumeProfile.workExperience]) }]
      : []),
    ...(resumeProfile.certifications.length
      ? [{ key: 'certifications' as const, title: 'Certifications', topics: prioritizeCertificationTopics(resumeProfile.certifications, roleDomain) }]
      : []),
    { key: 'role_specific', title: 'Role-specific Questions', topics: uniqueTopics([...roleSpecificTopics(roleDomain, resumeProfile, jdProfile), ...(jdProfile?.responsibilities ?? []).slice(0, 4)]) },
    ...(targetCompany
      ? [{ key: 'company_specific' as const, title: 'Company-specific Questions', topics: uniqueTopics([companyGuidance?.company ?? targetCompany, ...(companyGuidance?.preferredTopics ?? [])]) }]
      : []),
    {
      key: 'coding_problem_solving',
      title: technicalRole ? 'Coding / Problem Solving' : 'Role Scenario / Problem Solving',
      topics: problemSolvingTopicsForRole(roleDomain, resumeProfile),
    },
    ...(systemDesignApplicable
      ? [{ key: 'system_design' as const, title: 'System Design', topics: uniqueTopics(['Scalability', 'API design', 'Data storage', ...(companyGuidance?.preferredTopics ?? []).slice(0, 2)]) }]
      : []),
    { key: 'behavioral', title: 'Behavioral Questions', topics: ['Conflict', 'Leadership', 'Failure', 'Teamwork', 'Deadline pressure', 'Adaptability'] },
    { key: 'hr', title: 'HR Questions', topics: ['Strengths', 'Weaknesses', 'Career goals', 'Why this company'] },
  ];

  return {
    duration,
    targetQuestionCount,
    difficulty: limits.difficulty,
    roleDomain,
    roleLevel,
    targetCompany,
    resumeProfile,
    sections: distributeBudget(sections, targetQuestionCount),
    projectQuestionLimit: limits.projectQuestionLimit,
    followUpLimit: limits.followUpLimit,
  };
};

const tcsQuestions = (company: string): GeneratedQuestion[] => [
  {
    question:
      `Why do you want to join ${company}, and how does this role fit your long-term career plan?`,
    expectedSignals: ['specific motivation', 'role alignment', 'career clarity'],
    questionType: 'behavioural',
    resumeReference: `${company} HR and managerial readiness`,
  },
  {
    question:
      `${company} projects can involve client locations, rotational shifts, or relocation. How would you handle that while keeping your performance consistent?`,
    expectedSignals: ['flexibility', 'professional communication', 'client delivery mindset'],
    questionType: 'situational',
    resumeReference: `${company} delivery culture`,
  },
  {
    question:
      'Pick one project from your resume and explain your exact contribution, the hardest technical issue, and the final result.',
    expectedSignals: ['ownership', 'technical depth', 'measurable outcome'],
    questionType: 'technical',
    resumeReference: 'resume project discussion',
  },
  {
    question:
      'If OOP appears in your coursework or projects, explain one design choice using encapsulation, inheritance, abstraction, or polymorphism.',
    expectedSignals: ['encapsulation', 'inheritance or polymorphism', 'practical example'],
    questionType: 'technical',
    resumeReference: 'coursework or project OOP fundamentals',
  },
  {
    question:
      'Think of a project, coursework exercise, or coding-round scenario. When would an array be a better choice than a linked list, and when would you avoid it?',
    expectedSignals: ['memory layout', 'access and insertion trade-offs', 'use-case judgment'],
    questionType: 'technical',
    resumeReference: 'coursework or coding-round data structures',
  },
  {
    question:
      'For a database-backed feature you have built or studied, how would normalization prevent data duplication or update mistakes?',
    expectedSignals: ['normal forms', 'data redundancy', 'update anomalies'],
    questionType: 'technical',
    resumeReference: 'database project or coursework fundamentals',
  },
  {
    question:
      'How would you approach debugging a production issue reported by an important client?',
    expectedSignals: ['triage steps', 'logs and monitoring', 'communication and prevention'],
    questionType: 'situational',
    resumeReference: 'client-facing problem solving',
  },
  {
    question:
      'In a TCS-style coding round, explain the logic for checking whether a string is a palindrome, including the edge cases you would test.',
    expectedSignals: ['algorithmic clarity', 'edge cases', 'time complexity'],
    questionType: 'technical',
    resumeReference: 'TCS basic coding round',
  },
];

const serviceCompanyQuestions = (company: string): GeneratedQuestion[] => [
  {
    question: `Why ${company}, and what do you understand about working in a client-service delivery environment?`,
    expectedSignals: ['company awareness', 'client focus', 'role fit'],
    questionType: 'behavioural',
    resumeReference: `${company} motivation`,
  },
  {
    question:
      'Describe a time you had to learn a new tool, framework, or domain quickly to complete a task.',
    expectedSignals: ['learning process', 'execution under pressure', 'outcome'],
    questionType: 'behavioural',
    resumeReference: 'adaptability',
  },
  {
    question:
      'How would you explain a technical delay or risk to a non-technical client stakeholder?',
    expectedSignals: ['plain-language explanation', 'risk ownership', 'next steps'],
    questionType: 'situational',
    resumeReference: 'client communication',
  },
  {
    question:
      'Choose a database-backed feature from your experience and explain the schema, queries, and performance considerations.',
    expectedSignals: ['schema reasoning', 'query design', 'optimization awareness'],
    questionType: 'technical',
    resumeReference: 'database and backend fundamentals',
  },
  {
    question:
      'Explain one OOP or modular-design decision you made in a project and why it improved maintainability.',
    expectedSignals: ['design principle', 'trade-off', 'maintainability impact'],
    questionType: 'technical',
    resumeReference: 'software design fundamentals',
  },
];

const productCompanyQuestions = (company: string): GeneratedQuestion[] => [
  {
    question: `Why ${company}, and which product, platform, or engineering principle from the company interests you most?`,
    expectedSignals: ['specific company or product awareness', 'technical curiosity', 'role fit'],
    questionType: 'behavioural',
    resumeReference: `${company} motivation`,
  },
  {
    question:
      'Design a scalable service for a feature you have used recently. Walk through APIs, storage, caching, and failure handling.',
    expectedSignals: ['system boundaries', 'scalability trade-offs', 'reliability thinking'],
    questionType: 'technical',
    resumeReference: 'system design',
  },
  {
    question:
      'Tell me about a time you improved performance, reliability, or user experience in a project.',
    expectedSignals: ['baseline and metric', 'technical action', 'measured impact'],
    questionType: 'behavioural',
    resumeReference: 'impact and ownership',
  },
  {
    question:
      'How would you debug a high-latency API in production if users started reporting slow responses?',
    expectedSignals: ['observability', 'hypothesis-driven debugging', 'mitigation plan'],
    questionType: 'situational',
    resumeReference: 'production debugging',
  },
  {
    question:
      'Explain the trade-offs between SQL and NoSQL storage for a high-traffic application.',
    expectedSignals: ['data model', 'consistency and scaling', 'practical choice'],
    questionType: 'technical',
    resumeReference: 'database design',
  },
];

const financeCompanyQuestions = (company: string): GeneratedQuestion[] => [
  {
    question: `Why ${company}, and what interests you about building technology for financial services?`,
    expectedSignals: ['domain motivation', 'risk and trust awareness', 'role alignment'],
    questionType: 'behavioural',
    resumeReference: `${company} finance domain motivation`,
  },
  {
    question:
      'How would you design a transaction-processing flow that prevents duplicate payments and keeps an audit trail?',
    expectedSignals: ['idempotency', 'transaction integrity', 'auditability'],
    questionType: 'technical',
    resumeReference: 'financial systems design',
  },
  {
    question:
      'A trade, payment, or invoice job fails halfway through processing. How would you recover safely without corrupting data?',
    expectedSignals: ['rollback or retry strategy', 'data reconciliation', 'monitoring'],
    questionType: 'situational',
    resumeReference: 'financial reliability',
  },
  {
    question:
      'Explain how you would secure sensitive customer or financial data in an application.',
    expectedSignals: ['access control', 'encryption', 'least privilege and compliance awareness'],
    questionType: 'technical',
    resumeReference: 'security and compliance',
  },
  {
    question:
      'Tell me about a time you handled accuracy, deadlines, or ambiguity in a high-stakes project.',
    expectedSignals: ['attention to detail', 'prioritization', 'stakeholder communication'],
    questionType: 'behavioural',
    resumeReference: 'high-stakes delivery',
  },
];

const consultingCompanyQuestions = (company: string): GeneratedQuestion[] => [
  {
    question: `Why ${company}, and how would you approach technology consulting for a new client?`,
    expectedSignals: ['consulting motivation', 'structured discovery', 'client empathy'],
    questionType: 'behavioural',
    resumeReference: `${company} consulting fit`,
  },
  {
    question:
      'A client asks for a feature that may not solve the real business problem. How would you clarify requirements?',
    expectedSignals: ['questioning', 'problem framing', 'stakeholder alignment'],
    questionType: 'situational',
    resumeReference: 'client discovery',
  },
  {
    question:
      'Walk me through how you would estimate, plan, and de-risk a six-week implementation project.',
    expectedSignals: ['scope breakdown', 'risk management', 'delivery milestones'],
    questionType: 'situational',
    resumeReference: 'project delivery',
  },
  {
    question:
      'Explain a technical decision to a business stakeholder who cares mainly about cost, timeline, and impact.',
    expectedSignals: ['translation of technical trade-offs', 'business impact', 'recommendation clarity'],
    questionType: 'behavioural',
    resumeReference: 'executive communication',
  },
  {
    question:
      'Describe a time you worked across teams to solve a problem with unclear ownership.',
    expectedSignals: ['collaboration', 'ownership', 'conflict resolution'],
    questionType: 'behavioural',
    resumeReference: 'cross-functional work',
  },
];

const enterpriseSaasQuestions = (company: string): GeneratedQuestion[] => [
  {
    question: `Why ${company}, and what do you understand about enterprise software customers?`,
    expectedSignals: ['enterprise customer awareness', 'product/platform interest', 'role fit'],
    questionType: 'behavioural',
    resumeReference: `${company} enterprise SaaS motivation`,
  },
  {
    question:
      'How would you design role-based access control for a multi-tenant SaaS product?',
    expectedSignals: ['tenant isolation', 'roles and permissions', 'security testing'],
    questionType: 'technical',
    resumeReference: 'enterprise security design',
  },
  {
    question:
      'A large customer reports a workflow regression after a release. How would you triage and communicate the fix?',
    expectedSignals: ['rollback or hotfix thinking', 'customer communication', 'root cause analysis'],
    questionType: 'situational',
    resumeReference: 'enterprise support',
  },
  {
    question:
      'Explain how you would make an API backward-compatible while still shipping new functionality.',
    expectedSignals: ['versioning', 'contract testing', 'migration strategy'],
    questionType: 'technical',
    resumeReference: 'API design',
  },
  {
    question:
      'Tell me about a time you improved maintainability or developer productivity in a project.',
    expectedSignals: ['code quality', 'tooling or process improvement', 'measurable impact'],
    questionType: 'behavioural',
    resumeReference: 'engineering productivity',
  },
];

const healthcareQuestions = (company: string): GeneratedQuestion[] => [
  {
    question: `Why ${company}, and what responsibilities come with building technology for healthcare or life sciences?`,
    expectedSignals: ['domain motivation', 'patient or clinical impact', 'data sensitivity'],
    questionType: 'behavioural',
    resumeReference: `${company} healthcare domain motivation`,
  },
  {
    question:
      'How would you design a system that stores sensitive health data while supporting auditability and access control?',
    expectedSignals: ['privacy', 'audit logs', 'role-based access'],
    questionType: 'technical',
    resumeReference: 'health data systems',
  },
  {
    question:
      'A clinical or healthcare workflow has missing or inconsistent data. How would you validate and recover safely?',
    expectedSignals: ['validation rules', 'data quality checks', 'escalation path'],
    questionType: 'situational',
    resumeReference: 'data quality',
  },
  {
    question:
      'Tell me about a time you balanced speed with quality in a project where mistakes would have serious consequences.',
    expectedSignals: ['quality discipline', 'risk management', 'testing approach'],
    questionType: 'behavioural',
    resumeReference: 'quality-sensitive delivery',
  },
  {
    question:
      'Explain how you would test an integration between two systems that exchange critical user or patient records.',
    expectedSignals: ['integration testing', 'edge cases', 'observability'],
    questionType: 'technical',
    resumeReference: 'healthcare integrations',
  },
];

const embeddedQuestions = (company: string): GeneratedQuestion[] => [
  {
    question: `Why ${company}, and what interests you about hardware, embedded, semiconductor, or low-level systems work?`,
    expectedSignals: ['domain interest', 'systems thinking', 'role fit'],
    questionType: 'behavioural',
    resumeReference: `${company} embedded systems motivation`,
  },
  {
    question:
      'Explain a low-level debugging approach for an intermittent performance or memory issue.',
    expectedSignals: ['profiling', 'memory or concurrency awareness', 'reproducible investigation'],
    questionType: 'technical',
    resumeReference: 'systems debugging',
  },
  {
    question:
      'How would you design software that must be reliable under resource constraints?',
    expectedSignals: ['resource limits', 'failure modes', 'testing strategy'],
    questionType: 'technical',
    resumeReference: 'embedded reliability',
  },
  {
    question:
      'Describe a time you optimized code for latency, throughput, memory, or power usage.',
    expectedSignals: ['baseline measurement', 'optimization trade-off', 'validated impact'],
    questionType: 'behavioural',
    resumeReference: 'performance optimization',
  },
  {
    question:
      'How would you explain a complex hardware-software interaction to a teammate from a different discipline?',
    expectedSignals: ['clear explanation', 'cross-functional collaboration', 'technical accuracy'],
    questionType: 'situational',
    resumeReference: 'cross-discipline communication',
  },
];

const consumerQuestions = (company: string): GeneratedQuestion[] => [
  {
    question: `Why ${company}, and what user or customer problem from its domain would you like to work on?`,
    expectedSignals: ['user empathy', 'business/domain awareness', 'role fit'],
    questionType: 'behavioural',
    resumeReference: `${company} consumer domain motivation`,
  },
  {
    question:
      'How would you design a high-traffic checkout, booking, ordering, or ride-matching flow?',
    expectedSignals: ['peak traffic handling', 'data consistency', 'graceful degradation'],
    questionType: 'technical',
    resumeReference: 'consumer-scale systems',
  },
  {
    question:
      'A key funnel metric drops after a release. How would you investigate whether it is a product issue or a technical issue?',
    expectedSignals: ['metrics analysis', 'experimentation', 'rollback or fix strategy'],
    questionType: 'situational',
    resumeReference: 'product debugging',
  },
  {
    question:
      'Tell me about a time you used data or feedback to improve a feature.',
    expectedSignals: ['feedback loop', 'decision making', 'measured outcome'],
    questionType: 'behavioural',
    resumeReference: 'data-informed product work',
  },
  {
    question:
      'Explain how you would protect user privacy while still personalizing an application experience.',
    expectedSignals: ['privacy controls', 'data minimization', 'secure personalization'],
    questionType: 'technical',
    resumeReference: 'user data protection',
  },
];

const cybersecurityQuestions = (company: string): GeneratedQuestion[] => [
  {
    question: `Why ${company}, and what security or cloud reliability problem interests you most?`,
    expectedSignals: ['security awareness', 'cloud/domain motivation', 'role fit'],
    questionType: 'behavioural',
    resumeReference: `${company} security or cloud motivation`,
  },
  {
    question:
      'How would you detect, investigate, and contain suspicious traffic or unauthorized access in a production system?',
    expectedSignals: ['detection signals', 'incident response', 'containment and remediation'],
    questionType: 'situational',
    resumeReference: 'security incident response',
  },
  {
    question:
      'Explain how TLS, authentication, and authorization work together to protect an API.',
    expectedSignals: ['transport security', 'identity', 'permission checks'],
    questionType: 'technical',
    resumeReference: 'API security fundamentals',
  },
  {
    question:
      'How would you design a cloud service to tolerate regional failures or sudden traffic spikes?',
    expectedSignals: ['redundancy', 'autoscaling', 'failover strategy'],
    questionType: 'technical',
    resumeReference: 'cloud reliability',
  },
  {
    question:
      'Tell me about a time you found or prevented a reliability, security, or data-quality issue.',
    expectedSignals: ['risk identification', 'preventive action', 'impact'],
    questionType: 'behavioural',
    resumeReference: 'risk prevention',
  },
];

const industrialQuestions = (company: string): GeneratedQuestion[] => [
  {
    question: `Why ${company}, and what interests you about engineering software for industrial, automotive, aerospace, or energy systems?`,
    expectedSignals: ['domain motivation', 'reliability mindset', 'role fit'],
    questionType: 'behavioural',
    resumeReference: `${company} industrial domain motivation`,
  },
  {
    question:
      'How would you design software for a system where downtime, sensor errors, or incorrect decisions can be costly?',
    expectedSignals: ['fault tolerance', 'validation', 'monitoring and alerts'],
    questionType: 'technical',
    resumeReference: 'industrial reliability',
  },
  {
    question:
      'Describe a time you handled integration between software and an external device, vendor system, or legacy platform.',
    expectedSignals: ['interface contract', 'testing strategy', 'error handling'],
    questionType: 'behavioural',
    resumeReference: 'systems integration',
  },
  {
    question:
      'How would you analyze telemetry or sensor data to identify anomalies before they affect users?',
    expectedSignals: ['data pipeline', 'thresholds or models', 'alerting'],
    questionType: 'technical',
    resumeReference: 'telemetry and analytics',
  },
  {
    question:
      'Explain a technical trade-off you would make between safety, cost, latency, and maintainability.',
    expectedSignals: ['trade-off reasoning', 'risk awareness', 'decision clarity'],
    questionType: 'situational',
    resumeReference: 'engineering judgment',
  },
];

const CATEGORY_KEYWORDS: Array<{ category: string; labels: string[] }> = [
  {
    category: 'finance',
    labels: [
      'JPMorgan Chase', 'UBS', 'Bank of America', 'Arcesium', 'HighRadius', 'Ascensus',
      'Goldman Sachs', 'Morgan Stanley', 'American Express', 'Visa', 'Mastercard',
      'Oracle Financial Services Software (OFSS)', 'PayPal', 'Razorpay', 'CRED', 'Fiserv',
      'FIS', 'Fidelity Investments', 'FactSet', 'Broadridge', 'BlackRock', 'BNY',
      'State Street', 'Barclays', 'HSBC', 'Standard Chartered', 'NatWest Group',
      'Deutsche Bank', 'Societe Generale', 'Wells Fargo', 'Northern Trust',
    ],
  },
  {
    category: 'consulting',
    labels: [
      'Deloitte', 'Accenture', 'Trianz', 'Axtria', 'Genpact', 'McKinsey & Company',
      'Bain & Company', 'KPMG', 'EY', 'PwC', 'Grant Thornton', 'RSM', 'Deloitte USI',
      'EY GDS', 'PwC India', 'KPMG India',
    ],
  },
  {
    category: 'embedded',
    labels: [
      'NXP Semiconductors', 'NVIDIA', 'Intel', 'AMD', 'Qualcomm', 'Cisco', 'Synopsys',
      'Cadence', 'Western Digital', 'Micron Technology', 'Juniper Networks',
      'Samsung R&D Institute India', 'LG Soft India', 'SmartPlay Technologies',
      'Lantronix India',
    ],
  },
  {
    category: 'healthcare',
    labels: [
      'Parexel', 'Thryve Digital', 'Medtronic', 'Sagility India (HGS Healthcare)',
      'Siemens Healthineers', 'GE Healthcare', 'CitiusTech', 'Optum', 'UnitedHealth Group',
      'Cerner (Oracle Health)', 'Epic Systems', 'AstraZeneca', 'Novartis', 'Roche',
      'Pfizer', 'Eli Lilly', 'Sanofi', "Dr. Reddy's Laboratories", 'Biocon', 'IQVIA',
    ],
  },
  {
    category: 'enterpriseSaas',
    labels: [
      'SAP', 'SAP Labs India', 'OpenText', 'Oracle', 'ADP', 'RealPage', 'Salesforce',
      'Celigo', 'TIBCO Software India', 'Microsoft', 'Adobe', 'VMware', 'ServiceNow',
      'Atlassian', 'Zoho', 'Freshworks', 'Intuit', 'Informatica', 'Nutanix', 'Rubrik',
      'Cohesity', 'Cloudera', 'Snowflake', 'Red Hat', 'Newgen Software', 'SmartDocs Technologies',
    ],
  },
  {
    category: 'cybersecurity',
    labels: [
      'Palo Alto Networks', 'CrowdStrike', 'Check Point Software Technologies', 'Fortinet',
      'Cloudflare', 'RSA',
    ],
  },
  {
    category: 'industrial',
    labels: [
      'Carrier Technologies', 'CDK Global', 'ABB', 'Collins Aerospace', 'Siemens',
      'Honeywell', 'Philips', 'Bosch Global Software Technologies', 'Schneider Electric',
      'Ericsson', 'Ericsson India', 'Nokia', 'Harman', 'Continental', 'Aptiv', 'Volvo Group',
      'Mercedes-Benz Research and Development India', 'Renault Nissan Technology & Business Centre India',
      'Tata Elxsi', 'L&T Technology Services (LTTS)', 'KPIT Technologies', 'Cyient',
      'Johnson Controls', 'Shell', 'BP', 'ExxonMobil', 'Shell Info Technologies',
    ],
  },
  {
    category: 'consumer',
    labels: [
      'Amazon', 'Apple', 'Meta', 'Google', 'Walmart Global Tech', 'Flipkart', 'Meesho',
      'PhonePe', 'Swiggy', 'Zomato', 'Ola', 'Uber', 'InMobi', 'Expedia Group', 'Agoda',
      'Booking.com', 'PepsiCo Global Business Services', 'Unilever', 'Procter & Gamble (P&G)',
      'Reckitt', 'Mondelez International', 'PepsiCo',
    ],
  },
];

const CATEGORY_BY_KEY = new Map(
  CATEGORY_KEYWORDS.flatMap(({ category, labels }) =>
    labels.map((label) => [slugifyCompany(label), category] as const),
  ),
);

const getCompanyBank = (companyKey: string): GeneratedQuestion[] => {
  const label = COMPANY_LABELS[companyKey] ?? companyKey;
  if (companyKey === 'tcs') return tcsQuestions(label);

  switch (CATEGORY_BY_KEY.get(companyKey)) {
    case 'finance':
      return financeCompanyQuestions(label);
    case 'consulting':
      return consultingCompanyQuestions(label);
    case 'embedded':
      return embeddedQuestions(label);
    case 'healthcare':
      return healthcareQuestions(label);
    case 'enterpriseSaas':
      return enterpriseSaasQuestions(label);
    case 'cybersecurity':
      return cybersecurityQuestions(label);
    case 'industrial':
      return industrialQuestions(label);
    case 'consumer':
      return consumerQuestions(label);
    default:
      return ['microsoft', 'google', 'amazon', 'apple', 'meta', 'ibm'].includes(companyKey)
        ? productCompanyQuestions(label)
        : serviceCompanyQuestions(label);
  }
};

export const getCompanyInterviewGuidance = (targetCompany?: string): CompanyInterviewGuidance | undefined => {
  const companyKey = normalizeCompany(targetCompany);
  if (!companyKey) return undefined;

  const company = COMPANY_LABELS[companyKey] ?? companyKey;
  const category = CATEGORY_BY_KEY.get(companyKey);
  const base: CompanyInterviewGuidance = {
    company,
    style: 'Use public interview-pattern inspiration only. Do not claim questions are official or historically guaranteed.',
    preferredTopics: ['resume projects', 'job-description skills', 'fundamentals', 'practical problem solving'],
    behavioralStyle: 'Use structured follow-ups around situation, role, action, result, and reflection.',
    codingStyle: 'Start with fundamentals, then ask for edge cases, complexity, alternatives, and optimization.',
    systemDesignExpectations: 'Scale system-design depth to candidate seniority and the job description.',
    technicalDepth: 'Probe depth after strong answers and reduce difficulty when the candidate struggles.',
    caution: 'Historical public reports are inspiration, not a question bank. Generate fresh questions grounded in the JD and resume.',
  };

  const explicit: Record<string, Partial<CompanyInterviewGuidance>> = {
    amazon: {
      preferredTopics: ['ownership', 'customer impact', 'scalable services', 'coding fundamentals', 'operational excellence'],
      behavioralStyle: 'Lean into STAR stories around ownership, bias for action, trade-offs, failures, and customer impact.',
      codingStyle: 'Ask practical coding and data-structure questions with edge cases and complexity.',
      systemDesignExpectations: 'For senior candidates, probe reliability, scale, operations, and trade-offs.',
      technicalDepth: 'Expect concrete examples and decision reasoning; challenge vague claims with follow-ups.',
    },
    google: {
      preferredTopics: ['algorithms', 'problem solving', 'data structures', 'scalability', 'technical reasoning'],
      behavioralStyle: 'Keep behavioral prompts concise and focus follow-ups on collaboration, ambiguity, and learning.',
      codingStyle: 'Probe reasoning, correctness, complexity, edge cases, and alternate approaches.',
      systemDesignExpectations: 'Probe constraints, APIs, storage, scaling, reliability, and clarity of assumptions.',
      technicalDepth: 'Ask deeper why/how follow-ups after correct answers.',
    },
    microsoft: {
      preferredTopics: ['practical coding', 'OOP', 'debugging', 'system design', 'collaboration'],
      behavioralStyle: 'Use collaboration, growth mindset, conflict, and product/customer scenarios.',
      codingStyle: 'Favor practical implementation, object-oriented design, debugging, and clean reasoning.',
      systemDesignExpectations: 'Focus on maintainable services, API design, reliability, and product constraints.',
      technicalDepth: 'Balance fundamentals with real-world engineering judgment.',
    },
    accenture: {
      preferredTopics: ['SQL', 'OOP', 'projects', 'communication', 'client scenarios'],
      behavioralStyle: 'Emphasize client communication, adaptability, team delivery, and structured thinking.',
      codingStyle: 'Start with fundamentals and practical coding or query reasoning.',
      systemDesignExpectations: 'Use implementation planning, requirements clarification, and delivery risk.',
      technicalDepth: 'Keep depth role-appropriate and verify fundamentals before advanced follow-ups.',
    },
    infosys: {
      preferredTopics: ['OOP', 'DBMS', 'programming basics', 'projects', 'HR readiness'],
      behavioralStyle: 'Ask concise HR and project-ownership questions with communication follow-ups.',
      codingStyle: 'Start from basics, syntax-independent logic, DBMS, OOP, and simple algorithms.',
      systemDesignExpectations: 'Limit system design unless the JD or seniority requires it.',
      technicalDepth: 'Prioritize fundamentals and reduce difficulty quickly if basics are weak.',
    },
    tcs: {
      preferredTopics: ['OOP', 'DBMS', 'data structures', 'projects', 'client delivery', 'communication'],
      behavioralStyle: 'Include HR, flexibility, communication, and project contribution follow-ups.',
      codingStyle: 'Ask basic logic, arrays/strings, OOP, DBMS, and edge cases.',
      systemDesignExpectations: 'Focus on maintainability and enterprise delivery rather than advanced architecture for junior roles.',
      technicalDepth: 'Assess fundamentals clearly before moving into scenarios.',
    },
  };

  const categoryGuidance: Record<string, Partial<CompanyInterviewGuidance>> = {
    finance: {
      preferredTopics: ['transactions', 'data integrity', 'security', 'auditability', 'risk-aware delivery'],
      behavioralStyle: 'Ask about accuracy, deadlines, risk, stakeholder communication, and ownership.',
      systemDesignExpectations: 'Probe idempotency, consistency, audit trails, recovery, and access control.',
    },
    consulting: {
      preferredTopics: ['requirements clarification', 'client communication', 'planning', 'delivery risk', 'business impact'],
      behavioralStyle: 'Use client scenarios, ambiguity, influence, and cross-team collaboration.',
      systemDesignExpectations: 'Ask for phased implementation, risk mitigation, trade-offs, and stakeholder alignment.',
    },
    embedded: {
      preferredTopics: ['systems fundamentals', 'performance', 'memory', 'concurrency', 'debugging'],
      codingStyle: 'Probe low-level reasoning, resource constraints, correctness, and profiling.',
      systemDesignExpectations: 'Focus on reliability, constraints, interfaces, and testability.',
    },
    healthcare: {
      preferredTopics: ['privacy', 'data quality', 'auditability', 'critical workflows', 'testing'],
      behavioralStyle: 'Ask about quality discipline, risk, compliance awareness, and careful communication.',
      systemDesignExpectations: 'Probe sensitive data handling, validation, audit logs, and safe recovery.',
    },
    enterpriseSaas: {
      preferredTopics: ['APIs', 'multi-tenancy', 'RBAC', 'backward compatibility', 'customer impact'],
      systemDesignExpectations: 'Probe tenancy, permissions, release safety, contracts, and customer support.',
    },
    consumer: {
      preferredTopics: ['scale', 'latency', 'experimentation', 'privacy', 'user experience'],
      behavioralStyle: 'Ask about user impact, data-informed decisions, speed, and quality trade-offs.',
      systemDesignExpectations: 'Probe peak traffic, graceful degradation, consistency, and metrics.',
    },
  };

  return {
    ...base,
    ...(category ? categoryGuidance[category] : {}),
    ...(explicit[companyKey] ?? {}),
    company,
  };
};

const decodeHtmlEntities = (value: string) =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

const cleanSearchSnippet = (value: string) =>
  decodeHtmlEntities(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const inferResearchTopics = (text: string) => {
  const topics: string[] = [];
  const checks: Array<[string, RegExp]> = [
    ['coding rounds', /\bcoding|dsa|data structures?|algorithm|leetcode|hackerrank\b/i],
    ['system design', /\bsystem design|scalability|architecture|distributed\b/i],
    ['behavioral stories', /\bbehavioral|leadership principles?|star|ownership|teamwork\b/i],
    ['SQL/database fundamentals', /\bsql|database|dbms|query\b/i],
    ['resume project deep dives', /\bproject|resume|experience\b/i],
    ['operating-system and OOP fundamentals', /\boop|operating system|process|thread|network\b/i],
    ['product and customer impact', /\bcustomer|product|impact|metrics\b/i],
  ];
  checks.forEach(([topic, pattern]) => {
    if (pattern.test(text)) topics.push(topic);
  });
  return uniqueTopics(topics).slice(0, 6);
};

const fetchCompanyResearchSnippets = async (company: string, roleDomain: string) => {
  if (process.env.NODE_ENV === 'test') return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  const query = encodeURIComponent(`${company} ${roleDomain} interview questions process`);
  try {
    const response = await fetch(`https://duckduckgo.com/html/?q=${query}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'FluentAIInterviewResearch/1.0' },
    });
    if (!response.ok) return [];
    const html = await response.text();
    return Array.from(html.matchAll(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/div>/gi))
      .map((match) => cleanSearchSnippet(match[1] || match[2] || ''))
      .filter((snippet) => snippet.length > 40)
      .slice(0, 5);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
};

export const getCompanyInterviewGuidanceWithResearch = async ({
  targetCompany,
  roleDomain,
}: {
  targetCompany?: string;
  roleDomain: string;
}): Promise<CompanyInterviewGuidance | undefined> => {
  const guidance = getCompanyInterviewGuidance(targetCompany);
  if (!guidance?.company) return guidance;

  const snippets = await fetchCompanyResearchSnippets(guidance.company, roleDomain);
  if (!snippets.length) {
    return { ...guidance, researchSource: 'static', researchedAt: new Date().toISOString() };
  }

  const researchedTopics = inferResearchTopics(snippets.join(' '));
  return {
    ...guidance,
    researchSource: 'static+web',
    researchedAt: new Date().toISOString(),
    researchQueries: [`${guidance.company} ${roleDomain} interview questions process`],
    researchInsights: snippets,
    preferredTopics: uniqueTopics([...researchedTopics, ...guidance.preferredTopics]).slice(0, 10),
    caution: `${guidance.caution} Fresh web snippets were used only as trend signals and not as official company questions.`,
  };
};

const isIntroQuestion = (question: GeneratedQuestion) =>
  /^(introduce yourself|tell me about yourself)\b/i.test(question.question.trim());

const uniqueByQuestion = (questions: GeneratedQuestion[]) => {
  const seen = new Set<string>();
  return questions.filter((item) => {
    const key = item.question.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const questionIdentity = (question: GeneratedQuestion | { question?: string; questionId?: string; bankQuestionId?: string } | string) => {
  if (typeof question !== 'string') {
    const stableId = question?.questionId || question?.bankQuestionId;
    if (stableId) return stableId;
  }
  const text = typeof question === 'string' ? question : question?.question;
  return crypto
    .createHash('sha1')
    .update(String(text || '').replace(/\s+/g, ' ').trim().toLowerCase())
    .digest('hex');
};

const shuffleQuestions = <T>(items: T[]) => {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
};

const rotatePass = (pass: number, variantCount: number) =>
  ((pass % variantCount) + variantCount) % variantCount;

/** Drop questions that match or near-match text the student was already asked. */
export const filterPreviouslyAskedQuestions = (
  questions: GeneratedQuestion[],
  previouslyAsked: string[],
  { minKeep = 3 }: { minKeep?: number } = {},
): GeneratedQuestion[] => {
  if (!previouslyAsked.length) return questions;
  const filtered = questions.filter(
    (question) =>
      isIntroQuestion(question)
      || !previouslyAsked.some((asked) => isNearDuplicateQuestion(asked, question.question)),
  );
  return filtered.length >= Math.min(minKeep, questions.length) ? filtered : questions;
};

const prioritizeQuestionHistory = (
  questions: GeneratedQuestion[],
  recentQuestionHistory: string[][],
  previouslyAskedTexts: string[] = [],
) => {
  const withoutRecent = filterPreviouslyAskedQuestions(
    questions,
    previouslyAskedTexts,
    { minKeep: Math.min(3, questions.length) },
  );
  const pool = withoutRecent.length ? withoutRecent : questions;

  if (!recentQuestionHistory.length) return shuffleQuestions(pool);

  const historyRank = new Map<string, number>();
  recentQuestionHistory.forEach((questionIds, interviewIndex) => {
    questionIds.forEach((id) => {
      if (!historyRank.has(id)) historyRank.set(id, recentQuestionHistory.length - interviewIndex);
    });
  });

  const recentIds = new Set(recentQuestionHistory[0] ?? []);
  const withoutLastInterview = pool.filter((question) => !recentIds.has(questionIdentity(question)));
  const rankedPool = withoutLastInterview.length >= Math.min(3, pool.length) ? withoutLastInterview : pool;

  const buckets = new Map<number, GeneratedQuestion[]>();
  rankedPool.forEach((question) => {
    const rank = historyRank.get(questionIdentity(question)) ?? 0;
    const bucket = buckets.get(rank) ?? [];
    bucket.push(question);
    buckets.set(rank, bucket);
  });

  return [...buckets.keys()]
    .sort((left, right) => left - right)
    .flatMap((rank) => shuffleQuestions(buckets.get(rank) ?? []));
};

const roleMotivationQuestion = (roadmap: InterviewRoadmap) => {
  const profile = roadmap.resumeProfile;
  const hasFullStack = profileHas(profile, /\bfull\s*stack|mern|frontend|backend|react|node|express|rest(?:ful)?\s+api/i);
  const hasAiMl = profileHas(profile, /\bai\/?ml|artificial intelligence|machine learning|ml|langchain|rag|embedding|nlp|generative ai/i);
  const hasData = profileHas(profile, /\bdata analyst|analytics|business intelligence|bi analyst|power\s*bi|tableau|pandas|numpy/i);
  const highlighted = profileSkills(profile).slice(0, 5).join(', ');

  if (hasFullStack && hasAiMl && /\bsde|software\s+development\s+engineer|software|developer/i.test(roadmap.roleDomain)) {
    return 'I noticed your resume includes full-stack development as well as AI/ML. Why did you decide to pursue a Software Development Engineering role, and how do those interests connect?';
  }

  if (hasData && /\bsde|software\s+development\s+engineer|software|developer/i.test(roadmap.roleDomain)) {
    return `Your resume has data or analytics signals${highlighted ? ` like ${highlighted}` : ''}. Why are you targeting ${roadmap.roleDomain}, and how would that background help you as a software engineer?`;
  }

  return `Your resume highlights ${highlighted || projectReference(profile)}. Why are you interested in this ${roadmap.roleDomain} role, and what evidence from your work makes you ready for it?`;
};

const projectArchitectureQuestion = (topic: string, roadmap: InterviewRoadmap) => {
  if (/pdf|document|chatbot|rag|knowledge/i.test(topic)) {
    return {
      question: `Explain the architecture of your ${topic}. How does the application process a document or PDF from upload to generating the final response?`,
      expectedSignals: ['input flow', 'preprocessing or chunking', 'retrieval or model step', 'response generation'],
    };
  }

  if (/chatbot|assistant|llm|generative|nlp/i.test(topic)) {
    return {
      question: `Explain the architecture of your ${topic}. How does a user message move through the application before the final AI response is returned?`,
      expectedSignals: ['message flow', 'context handling', 'model or retrieval step', 'response generation'],
    };
  }

  if (/platform|portal|system|app|website|full\s*stack|mern|backend|api/i.test(`${topic} ${profileTopicText(roadmap.resumeProfile)}`)) {
    return {
      question: `Explain the architecture of your ${topic}. Walk me through the user flow, frontend or client layer, APIs, data model, authentication or authorization, and one failure mode you would monitor in production.`,
      expectedSignals: ['user flow', 'client and API boundaries', 'data model', 'authentication or authorization', 'failure mode or monitoring'],
    };
  }

  return {
    question: `I see ${topic} in your projects. Can you explain the complete architecture from the user entry point through the main backend, data, or model flow?`,
    expectedSignals: ['end-to-end architecture', 'component boundaries', 'data or request flow'],
  };
};

const projectTechnologyQuestion = (topic: string, roadmap: InterviewRoadmap) => {
  const profileText = profileTopicText(roadmap.resumeProfile);
  if (/pdf|document|chatbot|rag|knowledge|llm|nlp/i.test(topic) && /\blangchain|embedding|vector|rag|llm|nlp/i.test(profileText)) {
    const aiTools = uniqueTopics([
      firstMatchingTopic(profileSkills(roadmap.resumeProfile), /\blangchain\b/i),
      firstMatchingTopic(profileSkills(roadmap.resumeProfile), /\bvector\b|\bembedding/i),
      firstMatchingTopic(profileSkills(roadmap.resumeProfile), /\bllm|rag|nlp\b/i),
    ].filter(Boolean) as string[]).join(' and ') || 'the AI/ML tools';
    return {
      question: `You used ${aiTools} in ${topic}. Why did you choose that approach, and how does it improve retrieval, context quality, or response accuracy?`,
      expectedSignals: ['tool choice', 'retrieval or context quality', 'accuracy trade-offs', 'limitations'],
    };
  }

  if (/platform|portal|system|app|website|full\s*stack|mern|backend|api/i.test(`${topic} ${profileText}`)) {
    return {
      question: `For ${topic}, walk me through the tech stack you chose, your exact contribution, and how the API, database, and security pieces fit together.`,
      expectedSignals: ['technology choices', 'personal contribution', 'API and data flow', 'security awareness'],
    };
  }

  return {
    question: `For ${topic}, walk me through the tech stack you chose, your exact contribution, and why those choices fit the problem.`,
    expectedSignals: ['technology choices', 'personal contribution', 'trade-off reasoning'],
  };
};

const roleRuntimeQuestion = (topic: string, roadmap: InterviewRoadmap) => {
  if (/\bnode(?:\.js)?\b|\bexpress(?:\.js)?\b|event loop/i.test(topic)) {
    return {
      question: 'Explain how Node.js handles multiple client requests even though it runs on a single thread. What is the role of the Event Loop?',
      expectedSignals: ['event loop', 'non-blocking I/O', 'callbacks or promises', 'thread pool awareness'],
    };
  }

  if (/\bjava\b|\bspring\b/i.test(topic)) {
    return {
      question: `Explain how a ${topic.replace(/\s+request handling.*$/i, '')} backend handles multiple client requests. Where do threads, request pools, and blocking operations matter?`,
      expectedSignals: ['request thread model', 'blocking operations', 'thread pool limits', 'scalability trade-offs'],
    };
  }

  if (/\bpython\b|\bdjango\b|\bflask\b|\bfastapi\b/i.test(topic)) {
    return {
      question: `Explain how a Python web service handles multiple client requests. What should you consider around workers, async I/O, blocking code, and database calls?`,
      expectedSignals: ['workers or async model', 'blocking code', 'database calls', 'scalability trade-offs'],
    };
  }

  return {
    question: `Explain how a backend service handles multiple client requests. What concurrency, I/O, database, and failure-handling concerns would you watch for in ${projectReference(roadmap.resumeProfile)}?`,
    expectedSignals: ['request lifecycle', 'concurrency or I/O model', 'database bottlenecks', 'failure handling'],
  };
};

const roleFrontendPerformanceQuestion = (topic: string) => {
  const framework = topic.replace(/\s+performance optimization.*$/i, '').trim() || 'frontend';
  return {
    question: `Suppose your ${framework} application becomes slow after adding several new features. How would you identify the bottleneck and improve its performance?`,
    expectedSignals: ['profiling', 'render optimization', 'state or memoization strategy', 'network or bundle checks'],
  };
};

const roleProductionDebugQuestion = (topic: string) => {
  const target = /\bapi|rest|graphql/i.test(topic) ? 'API' : 'service or API';
  return {
    question: `Imagine a ${target} you deployed suddenly starts returning HTTP 500 errors in production. How would you debug the issue and restore the service?`,
    expectedSignals: ['logs and reproduction', 'recent changes', 'database or dependency checks', 'rollback or hotfix'],
  };
};

const roleScalabilityQuestion = (topic: string, roadmap: InterviewRoadmap) => {
  const topicProject = topic.match(/\bfor\s+(.+)$/i)?.[1]?.trim();
  const project = topicProject || primaryProject(roadmap.resumeProfile);
  return {
    question: project
      ? `If your ${project} had to support one million users or much larger data volume, what architectural changes would you make to keep it scalable, secure, and highly available?`
      : `If one of your applications had to support one million users or much larger data volume, what architectural changes would you make to keep it scalable, secure, and highly available?`,
    expectedSignals: ['scaling strategy', 'database optimization', 'security controls', 'availability and monitoring'],
  };
};

const questionForRoadmapTopic = (
  section: InterviewRoadmapSection,
  topic: string,
  index: number,
  roadmap: InterviewRoadmap,
  variantOffset = 0,
): GeneratedQuestion => {
  const company = roadmap.targetCompany ? COMPANY_LABELS[normalizeCompany(roadmap.targetCompany) ?? ''] ?? roadmap.targetCompany : undefined;
  const technicalRole = isTechnicalInterviewRole(roadmap.roleDomain);
  const common = {
    topic,
    resumeReference: `${section.title}: ${topic}`,
  };
  const basePass = Math.floor(index / Math.max(1, section.topics.length || 1)) + variantOffset;

  switch (section.key) {
    case 'self_introduction':
      return INTRO_QUESTION;
    case 'resume_overview':
      return {
        question: `I noticed ${topic} in your profile. How does it connect to the ${roadmap.roleDomain} role you are targeting?`,
        expectedSignals: ['resume awareness', 'role alignment', 'concise explanation'],
        questionType: 'behavioural',
        difficulty: 'easy',
        followUpIntent: 'bridge-topic',
        ...common,
      };
    case 'coursework':
      return {
        question: `You listed ${topic} in your coursework. Which concept from it has been most useful in a project, internship, or role-related task, and why?`,
        expectedSignals: ['course concept', 'practical application', 'role relevance'],
        questionType: 'technical',
        difficulty: 'easy-medium',
        followUpIntent: 'deepen',
        ...common,
      };
    case 'programming_languages':
      return {
        question: `You've listed ${topic}. Which language features or concepts have you used most in real projects, and where did they matter?`,
        expectedSignals: ['hands-on usage', 'core language concepts', 'project example'],
        questionType: 'technical',
        difficulty: (index + variantOffset) % 2 === 0 ? 'easy-medium' : 'medium',
        followUpIntent: 'deepen',
        ...common,
      };
    case 'technical_skills':
      return {
        question: `You mentioned ${topic}. Explain one practical use case from your learning, internship, or project work, one common mistake, and how you would test or verify it.`,
        expectedSignals: ['practical use case', 'common pitfall', 'testing or verification'],
        questionType: 'technical',
        difficulty: (index + variantOffset) % 3 === 0 ? 'medium' : 'easy-medium',
        followUpIntent: 'deepen',
        ...common,
      };
    case 'projects': {
      const pass = rotatePass(basePass, 5);
      if (pass === 0) {
        const projectQuestion = projectArchitectureQuestion(topic, roadmap);
        return {
          question: projectQuestion.question,
          expectedSignals: projectQuestion.expectedSignals,
          questionType: 'technical',
          difficulty: 'medium',
          followUpIntent: 'deepen',
          ...common,
        };
      }
      if (pass === 1) {
        const projectQuestion = projectTechnologyQuestion(topic, roadmap);
        return {
          question: projectQuestion.question,
          expectedSignals: projectQuestion.expectedSignals,
          questionType: 'technical',
          difficulty: 'medium',
          followUpIntent: 'deepen',
          ...common,
        };
      }
      if (pass === 2) {
        return {
          question: `What was the hardest technical challenge in ${topic}? Walk me through what failed, how you diagnosed it, what you changed, any metric or trade-off, and how you verified the fix.`,
          expectedSignals: ['specific failure or bottleneck', 'diagnosis steps', 'fix or redesign', 'metric or trade-off', 'verification'],
          questionType: 'technical',
          difficulty: 'medium-hard',
          followUpIntent: 'challenge',
          ...common,
        };
      }
      if (pass === 3) {
        return {
          question: `If ${topic} had to support 10x more users or data, what bottleneck would you measure first, what would you optimize, and what trade-offs or failure modes would you accept?`,
          expectedSignals: ['measurable bottleneck', 'optimization plan', 'trade-offs', 'failure modes'],
          questionType: 'situational',
          difficulty: 'scenario',
          followUpIntent: 'challenge',
          ...common,
        };
      }
      return {
        question: `How did or would you deploy ${topic}, and what monitoring, security, or failure-handling checks would you add before production use?`,
        expectedSignals: ['deployment approach', 'production checks', 'reliability or security awareness'],
        questionType: 'situational',
        difficulty: 'scenario',
        followUpIntent: 'challenge',
        ...common,
      };
    }
    case 'internship': {
      const pass = rotatePass(basePass, 4);
      // Never ask "at Developer Tools…" — skill catalogs are not employers.
      if (isSkillOrToolCatalogLine(topic)) {
        return {
          question: `Describe one internship, project, or hands-on experience where you used tools like Git or deployment platforms. What was your responsibility and what problem were you solving?`,
          expectedSignals: ['real experience context', 'responsibility', 'problem solved'],
          questionType: 'behavioural',
          difficulty: 'easy-medium',
          followUpIntent: 'clarify',
          ...common,
        };
      }
      if (pass === 0) {
        if (/\bdata analyst|analytics|business intelligence|bi\b/i.test(topic) && profileHas(roadmap.resumeProfile, /\bsql\b|\bpython\b|pandas|numpy/i)) {
          const tools = uniqueTopics([
            firstMatchingTopic(profileSkills(roadmap.resumeProfile), /\bsql\b/i),
            firstMatchingTopic(profileSkills(roadmap.resumeProfile), /\bpython\b|pandas|numpy/i),
          ].filter(Boolean) as string[]).join(' and ') || 'your data tools';
          return {
            question: `During your internship at ${topic}, describe a real business problem you solved using ${tools}. What was your approach, and what impact did your solution have?`,
            expectedSignals: ['business problem', `${tools} usage`, 'analysis approach', 'impact'],
            questionType: 'behavioural',
            difficulty: 'easy-medium',
            followUpIntent: 'clarify',
            ...common,
          };
        }
        return {
          question: `In your internship or work experience at ${topic}, what were your core responsibilities and what business or user problem were you working on?`,
          expectedSignals: ['responsibilities', 'business or user problem', 'ownership'],
          questionType: 'behavioural',
          difficulty: 'easy-medium',
          followUpIntent: 'clarify',
          ...common,
        };
      }
      if (pass === 1) {
        return {
          question: `For ${topic}, which technologies or tools did you actually use, and how did they fit into the workflow?`,
          expectedSignals: ['tools used', 'workflow context', 'hands-on role'],
          questionType: 'technical',
          difficulty: 'easy-medium',
          followUpIntent: 'deepen',
          ...common,
        };
      }
      if (pass === 2) {
        return {
          question: `What was the biggest challenge during ${topic}, and what did you personally do to resolve or escalate it?`,
          expectedSignals: ['challenge', 'personal action', 'resolution or escalation'],
          questionType: 'behavioural',
          difficulty: 'behavioral',
          followUpIntent: 'clarify',
          ...common,
        };
      }
      return {
        question: `Looking back at ${topic}, what was the measurable impact or strongest learning you would carry into this ${roadmap.roleDomain} role?`,
        expectedSignals: ['impact or learning', 'role transfer', 'specific reflection'],
        questionType: 'behavioural',
        difficulty: 'easy-medium',
        followUpIntent: 'bridge-topic',
        ...common,
      };
    }
    case 'certifications': {
      const pass = rotatePass(basePass, 2);
      if (pass === 0) {
        if (/\bsql\b|hackerrank/i.test(topic)) {
          return {
            question: `Write or explain an SQL query to find the second highest salary in each department. How would you optimize it for a large database?`,
            expectedSignals: ['window function or subquery', 'partition by department', 'indexing or query plan', 'large-data optimization'],
            questionType: 'technical',
            difficulty: 'medium',
            followUpIntent: 'challenge',
            ...common,
          };
        }
        if (/\bpython\b|essentials/i.test(topic)) {
          return {
            question: `Write a short Python function (or clear pseudocode) that removes duplicates from a list while preserving order. What edge cases would you test?`,
            expectedSignals: ['correct approach', 'edge cases', 'clarity'],
            questionType: 'technical',
            difficulty: 'easy-medium',
            followUpIntent: 'challenge',
            ...common,
          };
        }
        return {
          question: `What practical skill from ${topic} would you use in this ${roadmap.roleDomain} role? Give one concrete example — not just the certificate name.`,
          expectedSignals: ['practical skill', 'concrete example', 'role relevance'],
          questionType: 'technical',
          difficulty: 'easy-medium',
          followUpIntent: 'deepen',
          ...common,
        };
      }
      return {
        question: `Describe a small real-world scenario where knowledge from ${topic} would prevent a mistake or improve a solution.`,
        expectedSignals: ['real-world scenario', 'mistake prevention', 'better solution'],
        questionType: 'situational',
        difficulty: 'scenario',
        followUpIntent: 'challenge',
        ...common,
      };
    }
    case 'role_specific':
      if (/software development career choice/i.test(topic)) {
        return {
          question: roleMotivationQuestion(roadmap),
          expectedSignals: ['career motivation', 'resume-backed reasoning', 'role clarity'],
          questionType: 'behavioural',
          difficulty: 'easy',
          followUpIntent: 'bridge-topic',
          ...common,
        };
      }
      if (/request handling|event loop|backend request|node|express|java|spring|python|django|flask|fastapi/i.test(topic)) {
        const runtimeQuestion = roleRuntimeQuestion(topic, roadmap);
        return {
          question: runtimeQuestion.question,
          expectedSignals: runtimeQuestion.expectedSignals,
          questionType: 'technical',
          difficulty: 'medium',
          followUpIntent: 'deepen',
          ...common,
        };
      }
      if (/performance.*(?:react|angular|vue|next|frontend)|(?:react|angular|vue|next|frontend).*performance/i.test(topic)) {
        const performanceQuestion = roleFrontendPerformanceQuestion(topic);
        return {
          question: performanceQuestion.question,
          expectedSignals: performanceQuestion.expectedSignals,
          questionType: 'situational',
          difficulty: 'scenario',
          followUpIntent: 'challenge',
          ...common,
        };
      }
      if (/\bprocess(?:es)?\b|\bthread/i.test(topic)) {
        return {
          question: `Explain the difference between a process and a thread. In what situations would you prefer multithreading over multiprocessing?`,
          expectedSignals: ['memory isolation', 'shared memory', 'context switching', 'use-case judgment'],
          questionType: 'technical',
          difficulty: 'medium',
          followUpIntent: 'deepen',
          ...common,
        };
      }
      if (/production api|api debugging|production service|debugging/i.test(topic)) {
        const debugQuestion = roleProductionDebugQuestion(topic);
        return {
          question: debugQuestion.question,
          expectedSignals: debugQuestion.expectedSignals,
          questionType: 'situational',
          difficulty: 'scenario',
          followUpIntent: 'challenge',
          ...common,
        };
      }
      if (/scalable secure architecture|scal/i.test(topic)) {
        const scalingQuestion = roleScalabilityQuestion(topic, roadmap);
        return {
          question: scalingQuestion.question,
          expectedSignals: scalingQuestion.expectedSignals,
          questionType: 'situational',
          difficulty: 'scenario',
          followUpIntent: 'challenge',
          ...common,
        };
      }
      return {
        question: technicalRole
          ? `For a ${roadmap.roleDomain} role, how would you handle ${topic} in a project? Mention the steps you would take, the resume skills you would use, and how you would verify the result.`
          : `For a ${roadmap.roleDomain} role, how would you plan and execute ${topic}, and how would you measure whether it worked?`,
        expectedSignals: technicalRole
          ? ['structured steps', 'resume skill connection', 'verification mindset']
          : ['structured plan', 'execution steps', 'success metrics'],
        questionType: 'situational',
        difficulty: 'scenario',
        followUpIntent: 'challenge',
        ...common,
      };
    case 'company_specific':
      if (company && /^(tcs|tata consultancy services)$/i.test(company)) {
        return {
          question: `TCS often values fundamentals, client delivery, adaptability, and clear communication. Which project or internship experience from your resume best demonstrates those qualities?`,
          expectedSignals: ['TCS awareness', 'resume-backed example', 'delivery mindset', 'communication'],
          questionType: 'behavioural',
          difficulty: 'behavioral',
          followUpIntent: 'clarify',
          ...common,
        };
      }
      const companyTopic = COMPANY_LABELS[normalizeCompany(topic) ?? ''] ?? topic;
      return {
        question: technicalRole
          ? company
            ? `At ${company}, interviewers often probe fundamentals like ${companyTopic}. Explain one concept from that area and how you applied it in a project from your resume.`
            : `Explain one concept related to ${companyTopic} and how you applied it in a project from your resume.`
          : company
          ? `For a ${roadmap.roleDomain} interview at ${company}, how would you use a concrete example involving ${companyTopic} to show role fit?`
          : `How would you use a concrete example involving ${companyTopic} to show fit for a ${roadmap.roleDomain} role?`,
        expectedSignals: technicalRole
          ? ['concept clarity', 'resume-backed example', 'practical application']
          : ['role alignment', 'specific example', 'clear reasoning'],
        questionType: 'behavioural',
        difficulty: 'behavioral',
        followUpIntent: 'clarify',
        ...common,
      };
    case 'coding_problem_solving': {
      if (!technicalRole) {
        return {
          question: `Let's discuss a practical ${roadmap.roleDomain} scenario. What would you do first, what constraints would you consider, and how would you track success?`,
          expectedSignals: ['problem framing', 'prioritization', 'success metrics'],
          questionType: 'situational',
          difficulty: 'scenario',
          followUpIntent: 'challenge',
          ...common,
        };
      }

      // Concrete DSA prompts — never "what would you build involving Git/React".
      const codingProblems = [
        {
          question:
            'Write a function in Python that checks if a given string is a palindrome, considering case sensitivity and non-alphanumeric characters. How would you approach this problem, and what edge cases would you consider?',
          expectedSignals: ['normalization steps', 'two-pointer or reverse approach', 'edge cases', 'time complexity'],
          languageHint: 'Python',
        },
        {
          question:
            'Given an array of integers, write a function to return the indices of the two numbers that add up to a target. Explain your approach and its time and space complexity.',
          expectedSignals: ['hash map or nested loop approach', 'correctness', 'time complexity', 'edge cases'],
          languageHint: 'algorithms',
        },
        {
          question:
            'Write a function to reverse a singly linked list (code or clear pseudocode). What edge cases matter, and what is the time/space complexity?',
          expectedSignals: ['pointer rewiring', 'empty or single-node cases', 'time complexity'],
          languageHint: 'data structures',
        },
        {
          question:
            'Given a string, find the first non-repeating character and return its index (or -1 if none). Explain your approach and complexity.',
          expectedSignals: ['frequency counting', 'single or two-pass scan', 'edge cases', 'complexity'],
          languageHint: 'strings',
        },
      ];
      const selected = codingProblems[index % codingProblems.length];
      return {
        question: selected.question,
        expectedSignals: selected.expectedSignals,
        questionType: 'technical',
        difficulty: 'problem-solving',
        followUpIntent: 'challenge',
        ...common,
        topic: `Coding / Problem Solving: ${selected.languageHint}`,
      };
    }
    case 'system_design':
      return {
        question: `Now let's discuss system design. Design around ${topic}; cover APIs, storage, scaling, failure handling, and trade-offs.`,
        expectedSignals: ['APIs and boundaries', 'storage choice', 'scaling and reliability trade-offs'],
        questionType: 'situational',
        difficulty: 'scenario',
        followUpIntent: 'challenge',
        ...common,
      };
    case 'behavioral':
      return {
        question: `Tell me about a time involving ${topic}. Use the situation, your role, actions, result, and what you learned.`,
        expectedSignals: ['STAR structure', 'personal ownership', 'result and reflection'],
        questionType: 'behavioural',
        difficulty: 'behavioral',
        followUpIntent: 'clarify',
        ...common,
      };
    case 'hr':
      return {
        question: company
          ? `Before we close, how would you answer an HR question about ${topic} for ${company}?`
          : `Before we close, how would you answer an HR question about ${topic}?`,
        expectedSignals: ['self-awareness', 'role motivation', 'professional clarity'],
        questionType: 'behavioural',
        difficulty: 'easy',
        followUpIntent: 'bridge-topic',
        ...common,
      };
    default:
      return {
        question: `Let's discuss ${topic}. What should I know about your experience here?`,
        expectedSignals: ['specific example', 'clear explanation', 'role relevance'],
        questionType: 'behavioural',
        difficulty: 'easy-medium',
        followUpIntent: 'bridge-topic',
        ...common,
      };
  }
};

const roadmapQuestions = (roadmap?: InterviewRoadmap, variantOffset = 0) => {
  if (!roadmap) return [];
  return roadmap.sections.flatMap((section) => {
    const rawTopics = section.topics.length ? section.topics : [section.title];
    const topics = rawTopics
      .map((topic) => sanitizeResumeEntityTopic(topic) ?? normalizeTopic(topic))
      .filter(Boolean);
    if (!topics.length) return [];
    const budget = Math.max(1, section.questionBudget);
    return stripDateAnchoredQuestions(
      Array.from({ length: budget }, (_, index) =>
        questionForRoadmapTopic(section, topics[index % topics.length], index, roadmap, variantOffset),
      ),
    );
  });
};

const skillCoveragePrompt = (skill: string, roadmap: InterviewRoadmap, technicalRole: boolean) => {
  const dataRole = /\bdata\s*analyst|analytics analyst|business intelligence|bi analyst\b/i.test(roadmap.roleDomain);
  if (dataRole) {
    if (/\bsql\b/i.test(skill)) {
      return `You mentioned SQL. Tell me about one query or analysis task you worked on, what tables or fields you used, and how you checked the result was correct.`;
    }
    if (/\bpower\s*bi|tableau|dashboard/i.test(skill)) {
      return `You mentioned ${skill}. Walk me through one dashboard or report you created, the metrics you showed, and how it helped someone make a decision.`;
    }
    if (/\bexcel|google sheets/i.test(skill)) {
      return `You mentioned ${skill}. Describe one analysis you did with it, the formulas or features you used, and how you validated the numbers.`;
    }
    if (/\bpython\b/i.test(skill)) {
      return `You mentioned Python. How have you used it for data cleaning, analysis, or automation, and what output did you produce?`;
    }
    return `You mentioned ${skill}. Give one data-analysis example where you used it, what insight you found, and how you verified the data.`;
  }

  if (technicalRole) {
    if (/\bpython\b/i.test(skill) && /\bsde|software\s+development\s+engineer|software|developer/i.test(roadmap.roleDomain)) {
      const highlightedSkills = uniqueTopics([
        ...roadmap.resumeProfile.skills.programmingLanguages,
        ...roadmap.resumeProfile.skills.frameworks.slice(0, 2),
        ...roadmap.resumeProfile.skills.databases.slice(0, 1),
      ]).slice(0, 6);
      return `You've listed ${highlightedSkills.join(', ') || skill}. Which technology are you most confident with, and what is the most challenging problem you've solved using it?`;
    }
    return `You mentioned ${skill}. Tell me where you used it in a project or internship, what you built with it, and how you checked that your work was correct.`;
  }

  return `You mentioned ${skill}. Explain one practical campaign, task, or business example where you used it and what outcome you tracked.`;
};

const skillDeepDivePrompt = (skill: string, roadmap: InterviewRoadmap, technicalRole: boolean) => {
  const dataRole = /\bdata\s*analyst|analytics analyst|business intelligence|bi analyst\b/i.test(roadmap.roleDomain);
  if (dataRole) {
    return `Staying with ${skill}, what mistake could make the analysis misleading, and how would you catch or prevent it?`;
  }

  if (technicalRole) {
    return `Staying with ${skill}, what mistake or limitation have you seen or learned about, and how would you prevent it in a project?`;
  }

  return `Staying with ${skill}, what is one common mistake, limitation, or campaign risk you would watch for, and how would you prevent it?`;
};

const skillCoverageQuestions = (roadmap?: InterviewRoadmap, variantOffset = 0): GeneratedQuestion[] => {
  if (!roadmap) return [];
  const technicalRole = isTechnicalInterviewRole(roadmap.roleDomain);
  const skills = allTechnicalSkillTopics(roadmap.resumeProfile).slice(0, 40);
  const rotatedSkills =
    variantOffset > 0 && skills.length > 1
      ? [...skills.slice(variantOffset % skills.length), ...skills.slice(0, variantOffset % skills.length)]
      : skills;
  const depth = skillQuestionDepth(roadmap.duration, roadmap.difficulty === 'Hard' ? 'Advanced' : roadmap.difficulty === 'Easy' ? 'Beginner' : 'Intermediate');

  const coverageQuestions = rotatedSkills.map((skill) => ({
    question: skillCoveragePrompt(skill, roadmap, technicalRole),
    expectedSignals: technicalRole
      ? [`${skill} practical usage`, `${roadmap.roleDomain} relevance`, 'specific example', 'verification']
      : [`${skill} practical usage`, `${roadmap.roleDomain} relevance`, 'specific example', 'measured outcome'],
    questionType: technicalRole ? 'technical' as const : 'situational' as const,
    resumeReference: `Skill coverage: ${skill}`,
    difficulty: 'easy-medium' as const,
    topic: skill,
    followUpIntent: 'deepen' as const,
  }));

  const deepDiveQuestions = depth >= 2
    ? rotatedSkills.map((skill) => ({
        question: skillDeepDivePrompt(skill, roadmap, technicalRole),
        expectedSignals: technicalRole
          ? [`${skill} pitfalls`, `${roadmap.roleDomain} judgement`, 'prevention strategy', 'validation']
          : [`${skill} pitfalls`, `${roadmap.roleDomain} judgement`, 'prevention strategy', 'measurement or review'],
        questionType: technicalRole ? 'technical' as const : 'situational' as const,
        resumeReference: `Skill deep dive: ${skill}`,
        difficulty: 'medium' as const,
        topic: skill,
        followUpIntent: 'challenge' as const,
      }))
    : [];

  const productionQuestions = depth >= 3
    ? rotatedSkills.map((skill) => ({
        question: technicalRole
          ? `Let's go one level deeper on ${skill}. Design a production-ready ${roadmap.roleDomain} use case and explain performance, scalability, security, and trade-offs.`
          : `Let's go one level deeper on ${skill}. Design a ${roadmap.roleDomain} execution plan and explain audience, channels, budget or effort, metrics, and trade-offs.`,
        expectedSignals: technicalRole
          ? [`${skill} architecture`, `${roadmap.roleDomain} system thinking`, 'trade-off reasoning', 'production readiness']
          : [`${skill} strategy`, `${roadmap.roleDomain} execution thinking`, 'trade-off reasoning', 'measurement plan'],
        questionType: 'situational' as const,
        resumeReference: `Skill production scenario: ${skill}`,
        difficulty: 'scenario' as const,
        topic: skill,
        followUpIntent: 'challenge' as const,
      }))
    : [];

  return [...coverageQuestions, ...deepDiveQuestions, ...productionQuestions];
};

const roleFocusQuestions = (roadmap?: InterviewRoadmap): GeneratedQuestion[] => {
  if (!roadmap) return [];
  const technicalRole = isTechnicalInterviewRole(roadmap.roleDomain);
  const roleTopics = uniqueTopics([
    ...roleSpecificTopics(roadmap.roleDomain, roadmap.resumeProfile),
    ...problemSolvingTopicsForRole(roadmap.roleDomain, roadmap.resumeProfile),
  ]).filter((topic) => !/software development career choice/i.test(topic)).slice(0, 12);

  return roleTopics.flatMap((topic, index) => {
    const runtimeQuestion = /request handling|event loop|backend request|node|express|java|spring|python|django|flask|fastapi/i.test(topic)
      ? roleRuntimeQuestion(topic, roadmap)
      : undefined;
    const performanceQuestion = /performance.*(?:react|angular|vue|next|frontend)|(?:react|angular|vue|next|frontend).*performance/i.test(topic)
      ? roleFrontendPerformanceQuestion(topic)
      : undefined;
    const debugQuestion = /production api|api debugging|production service|debugging/i.test(topic)
      ? roleProductionDebugQuestion(topic)
      : undefined;
    const scalingQuestion = /scalable secure architecture|scal/i.test(topic)
      ? roleScalabilityQuestion(topic, roadmap)
      : undefined;
    const focusedQuestion =
      runtimeQuestion?.question ??
      performanceQuestion?.question ??
      debugQuestion?.question ??
      scalingQuestion?.question ??
      (/\bprocess(?:es)?\b|\bthread/i.test(topic)
        ? 'Explain the difference between a process and a thread. In what situations would you prefer multithreading over multiprocessing?'
        : undefined);
    const focusedSignals =
      runtimeQuestion?.expectedSignals ??
      performanceQuestion?.expectedSignals ??
      debugQuestion?.expectedSignals ??
      scalingQuestion?.expectedSignals;
    const base: GeneratedQuestion = {
      question: focusedQuestion ?? (technicalRole
        ? `For a ${roadmap.roleDomain} interview, explain how you would apply ${topic} in one of your projects or internship tasks, and how you would check that it worked.`
        : `For a ${roadmap.roleDomain} interview, walk me through how you would handle ${topic} in a real business situation and how you would measure success.`),
      expectedSignals: focusedQuestion
        ? focusedSignals ?? ['technical concept', 'practical diagnosis or trade-off', 'project or role relevance']
        : technicalRole
        ? ['role relevance', 'project connection', 'verification']
        : ['role relevance', 'practical execution', 'success metrics'],
      questionType: focusedQuestion && /slow|HTTP 500|one million/i.test(focusedQuestion) ? 'situational' : technicalRole ? 'technical' : 'situational',
      resumeReference: `Role focus: ${topic}`,
      difficulty: focusedQuestion && /slow|HTTP 500|one million/i.test(focusedQuestion) ? 'scenario' : index < 2 ? 'easy-medium' : 'medium',
      topic,
      followUpIntent: 'deepen',
    };

    const followUp: GeneratedQuestion = {
      question: technicalRole
        ? `Staying with ${topic}, what mistake or failure could happen while using it, and how would you identify or prevent that?`
        : `Staying with ${topic}, what could go wrong during execution, and how would you adjust your plan based on performance data?`,
      expectedSignals: technicalRole
        ? ['failure mode', 'investigation approach', 'prevention']
        : ['risk awareness', 'data-driven adjustment', 'practical judgement'],
      questionType: 'situational',
      resumeReference: `Role follow-up: ${topic}`,
      difficulty: 'scenario',
      topic,
      followUpIntent: 'challenge',
    };

    if (focusedQuestion) return [base];
    return index < 4 ? [base, followUp] : [base];
  });
};

const sanitizeQuestionForDateAnchoring = (question: GeneratedQuestion): GeneratedQuestion | null => {
  const sanitizedText = sanitizeDateAnchoredQuestionText({
    question: question.question,
    topic: question.topic,
    resumeReference: question.resumeReference,
  });
  if (!sanitizedText) return null;

  const sanitizedTopic = question.topic ? sanitizeResumeEntityTopic(question.topic) : undefined;
  return {
    ...question,
    question: sanitizedText,
    ...(sanitizedTopic ? { topic: sanitizedTopic } : {}),
  };
};

const stripDateAnchoredQuestions = (questions: GeneratedQuestion[]) =>
  questions
    .map(sanitizeQuestionForDateAnchoring)
    .filter((question): question is GeneratedQuestion => Boolean(question));

const withQuestionMetadata = (questions: GeneratedQuestion[]) =>
  questions.map((question, index) => ({
    ...question,
    difficulty:
      question.difficulty ??
      (index === 0
        ? 'easy'
        : index < 2
        ? 'easy-medium'
        : index < 4
        ? 'medium'
        : question.questionType === 'situational'
        ? 'scenario'
        : question.questionType === 'behavioural'
        ? 'behavioral'
        : 'medium-hard'),
    topic: question.topic ?? question.resumeReference ?? 'general',
    followUpIntent:
      question.followUpIntent ??
      (question.questionType === 'situational'
        ? 'challenge'
        : question.questionType === 'behavioural'
        ? 'clarify'
        : 'deepen'),
  }));

const stagedDifficulty = (
  question: GeneratedQuestion,
  index: number,
  total: number,
  roadmap?: InterviewRoadmap,
): NonNullable<GeneratedQuestion['difficulty']> => {
  if (index === 0) return 'easy';
  const ratio = index / Math.max(1, total - 1);
  const current = question.difficulty ?? 'medium';

  if (roadmap?.difficulty === 'Easy') {
    if (ratio < 0.45) return current === 'behavioral' ? 'behavioral' : 'easy-medium';
    if (ratio < 0.8) return current === 'scenario' ? 'scenario' : 'medium';
    return question.questionType === 'situational' ? 'scenario' : current === 'behavioral' ? 'behavioral' : 'medium';
  }

  if (ratio < 0.25) {
    return current === 'behavioral' ? 'behavioral' : current === 'easy' ? 'easy' : 'easy-medium';
  }
  if (ratio < 0.6) {
    return current === 'behavioral' ? 'behavioral' : current === 'scenario' ? 'medium-hard' : 'medium';
  }
  if (ratio < 0.82) {
    return current === 'behavioral' ? 'behavioral' : question.questionType === 'situational' ? 'scenario' : 'medium-hard';
  }
  return current === 'behavioral' ? 'behavioral' : question.questionType === 'situational' ? 'scenario' : 'problem-solving';
};

const applyDifficultyProgression = (questions: GeneratedQuestion[], roadmap?: InterviewRoadmap) =>
  questions.map((question, index) => ({
    ...question,
    difficulty: stagedDifficulty(question, index, questions.length, roadmap),
  }));

const sectionTitleFromReference = (question: GeneratedQuestion) =>
  normalizeTopic((question.resumeReference ?? '').split(':')[0] ?? '');

const takeFirstBySection = (questions: GeneratedQuestion[], sectionTitles: string[]) => {
  const wanted = new Set(sectionTitles);
  const seen = new Set<string>();
  return questions.filter((question) => {
    const title = sectionTitleFromReference(question);
    if (!wanted.has(title) || seen.has(title)) return false;
    seen.add(title);
    return true;
  });
};

const takeBySection = (questions: GeneratedQuestion[], sectionTitles: string[]) => {
  const wanted = new Set(sectionTitles);
  return questions.filter((question) => wanted.has(sectionTitleFromReference(question)));
};

const interleaveQuestionGroups = (...groups: GeneratedQuestion[][]) => {
  const output: GeneratedQuestion[] = [];
  const maxLength = Math.max(0, ...groups.map((group) => group.length));
  for (let index = 0; index < maxLength; index += 1) {
    groups.forEach((group) => {
      if (group[index]) output.push(group[index]);
    });
  }
  return output;
};

const topicOverlaps = (left?: string, right?: string) => {
  const a = normalizeTopic(left ?? '').toLowerCase();
  const b = normalizeTopic(right ?? '').toLowerCase();
  if (!a || !b) return false;

  const compact = (value: string) => value.replace(/[^a-z0-9]+/g, '');
  const ca = compact(a);
  const cb = compact(b);
  return a === b || a.includes(b) || b.includes(a) || ca.includes(cb) || cb.includes(ca);
};

const removeRepeatedSkillCoverage = (questions: GeneratedQuestion[]) => {
  let nonSkillContext = '';
  return questions.filter((question) => {
    const topic = question.topic ?? '';
    const isSkillCoverage = /^Skill coverage:/i.test(question.resumeReference ?? '');
    const compactTopic = topic.replace(/[^a-z0-9]+/gi, '').toLowerCase();
    const alreadyCovered =
      isSkillCoverage &&
      compactTopic.length >= 3 &&
      nonSkillContext.replace(/[^a-z0-9]+/gi, '').toLowerCase().includes(compactTopic);

    if (!isSkillCoverage) {
      nonSkillContext += ` ${question.question} ${question.topic ?? ''} ${question.resumeReference ?? ''}`;
    }

    return !alreadyCovered;
  });
};

const isMetaCompanyQuestion = (question: GeneratedQuestion) =>
  /company-style expectations|interview expectations|demonstrate .*(expectations|readiness)|let'?s move to some .+ expectations/i.test(
    question.question || '',
  );

/**
 * Ideal interview loop:
 * intro → projects/resume → coding/role core → company pack → HR/behavioral
 */
export const buildInterviewQuestionSet = ({
  generatedQuestions,
  targetCompany,
  duration,
  interviewRoadmap,
  prioritizeGenerated = false,
  researchedCompanyQuestions = [],
  roleConceptQuestions = [],
  randomize = false,
  recentQuestionHistory = [],
  previouslyAskedQuestions = [],
  questionVariantOffset = 0,
}: {
  generatedQuestions: GeneratedQuestion[];
  targetCompany?: string;
  duration: number;
  interviewRoadmap?: InterviewRoadmap;
  prioritizeGenerated?: boolean;
  researchedCompanyQuestions?: GeneratedQuestion[];
  roleConceptQuestions?: GeneratedQuestion[];
  randomize?: boolean;
  recentQuestionHistory?: string[][];
  previouslyAskedQuestions?: string[];
  questionVariantOffset?: number;
}) => {
  const company = normalizeCompany(targetCompany);
  const companyPack = researchedCompanyQuestions.filter((question) => !isMetaCompanyQuestion(question));
  const companyFallback = company
    ? getCompanyBank(company).filter((question) => !isMetaCompanyQuestion(question)).slice(0, 4)
    : [];

  const targetCount = getInterviewQuestionCount(duration);
  const finalTargetCount = interviewRoadmap?.targetQuestionCount ?? targetCount;
  const mixQuestions = (questions: GeneratedQuestion[]) =>
    randomize
      ? prioritizeQuestionHistory(questions, recentQuestionHistory, previouslyAskedQuestions)
      : filterPreviouslyAskedQuestions(questions, previouslyAskedQuestions);
  const generatedWithoutIntro = mixQuestions(
    filterPreviouslyAskedQuestions(
      generatedQuestions
        .filter((question) => !isIntroQuestion(question))
        .filter((question) => !isMetaCompanyQuestion(question)),
      previouslyAskedQuestions,
    ),
  );
  const skillQuestions = mixQuestions(skillCoverageQuestions(interviewRoadmap, questionVariantOffset));
  const roleQuestions = mixQuestions(roleFocusQuestions(interviewRoadmap));
  const plannedQuestions = mixQuestions(roadmapQuestions(interviewRoadmap, questionVariantOffset)
    .filter((question) => !isIntroQuestion(question))
    .filter((question) => !isMetaCompanyQuestion(question)));

  const projectQuestions = takeBySection(plannedQuestions, ['Projects']);
  const internshipQuestions = takeBySection(plannedQuestions, ['Internship / Work Experience']).filter(
    (question) => !/Developer Tools?\s*&\s*Platforms|at Developer Tools/i.test(question.question),
  );
  const certificationQuestions = takeBySection(plannedQuestions, ['Certifications']);
  const codingQuestions = takeBySection(plannedQuestions, [
    'Coding / Problem Solving',
    'Role Scenario / Problem Solving',
  ]).slice(0, 2);
  const roleSpecificQuestions = takeBySection(plannedQuestions, [
    'Role-specific Questions',
    'System Design',
  ]).slice(0, 3);
  const behavioralHrQuestions = takeBySection(plannedQuestions, [
    'Behavioral Questions',
    'HR Questions',
  ]).slice(0, 3);
  const companyFromRoadmap = takeBySection(plannedQuestions, ['Company-specific Questions']).slice(0, 4);

  // Prefer curated/researched pack; else roadmap company prompts + static bank.
  const companyQuestions = (
    companyPack.length > 0
      ? mixQuestions(companyPack)
      : mixQuestions([...companyFromRoadmap, ...companyFallback])
  )
    .filter((question) => !isMetaCompanyQuestion(question))
    .slice(0, companyPack.length > 0 ? Math.min(Math.max(companyPack.length, 4), 6) : 4);

  const fresher = /fresher|student|junior/i.test(interviewRoadmap?.roleLevel ?? '');
  const resumeProjects = interviewRoadmap?.resumeProfile.projects || [];
  const projectDepth = Math.max(1, Math.min(3, resumeProjects.length || 1));

  // Diversify: cover distinct projects before re-drilling the first one (Blood Donation loop).
  const diversifiedProjectQuestions = (() => {
    if (resumeProjects.length <= 1) return projectQuestions.slice(0, projectDepth);
    const picked: GeneratedQuestion[] = [];
    const covered = new Set<string>();
    for (const question of projectQuestions) {
      const matched = resumeProjects.find((project) => {
        const token = project.toLowerCase().slice(0, Math.min(14, project.length));
        return question.question.toLowerCase().includes(token);
      });
      const key = (matched || question.resumeReference || question.question).toLowerCase();
      if (matched && covered.has(matched.toLowerCase()) && covered.size < resumeProjects.length) continue;
      if (matched) covered.add(matched.toLowerCase());
      else if (covered.has(key) && covered.size < resumeProjects.length) continue;
      else covered.add(key);
      picked.push(question);
      if (picked.length >= projectDepth) break;
    }
    for (const question of projectQuestions) {
      if (picked.length >= Math.min(projectDepth + 1, 3)) break;
      if (!picked.includes(question)) picked.push(question);
    }
    return picked.length ? picked : projectQuestions.slice(0, projectDepth);
  })();

  const resumeStage = [
    ...diversifiedProjectQuestions,
    ...internshipQuestions.slice(0, 1),
    ...skillQuestions.slice(0, 1),
    ...certificationQuestions.slice(0, 1),
  ];

  const isConcreteCodingPrompt = (question: GeneratedQuestion) =>
    /\b(write a function|given an array|given a string|palindrome|two numbers that add up|linked list|non-repeating|leetcode|time (and space )?complexity|algorithm)\b/i.test(
      question.question,
    )
    || (/problem-solving/i.test(question.difficulty || '')
      && /\b(array|string|tree|graph|complexity|indices|edge cases)\b/i.test(question.question));

  const codingStage = [
    ...codingQuestions.filter(isConcreteCodingPrompt),
    ...codingQuestions.filter((question) => !isConcreteCodingPrompt(question)),
    ...generatedWithoutIntro.filter(isConcreteCodingPrompt).slice(0, 2),
  ].slice(0, fresher ? 2 : 3);

  const prioritizeScenarioPrompts = (questions: GeneratedQuestion[]) =>
    [...questions].sort((left, right) => {
      const rank = (question: GeneratedQuestion) =>
        /slow|HTTP 500|process and a thread|Event Loop|one million|bottleneck/i.test(question.question)
          ? 0
          : 1;
      return rank(left) - rank(right);
    });

  // Leave room for company + HR on short interviews.
  const roleEach = finalTargetCount <= 12 ? (fresher ? 2 : 3) : fresher ? 4 : 5;
  const roleCoreStage = [
    ...prioritizeScenarioPrompts(roleSpecificQuestions).slice(0, roleEach),
    ...prioritizeScenarioPrompts(roleQuestions).slice(0, roleEach),
  ];
  const approvedRoleConceptStage = mixQuestions(
    roleConceptQuestions.filter((question) => !isMetaCompanyQuestion(question)),
  );

  // Staged order: intro → projects → coding/role → company → HR → skill fill
  const orderedQuestions = [
    INTRO_QUESTION,
    ...resumeStage,
    ...codingStage,
    ...roleCoreStage,
    ...approvedRoleConceptStage,
    ...(prioritizeGenerated ? generatedWithoutIntro.slice(0, 2) : []),
    ...companyQuestions,
    ...behavioralHrQuestions,
    ...skillQuestions.slice(1),
    ...(prioritizeGenerated ? [] : generatedWithoutIntro),
  ];

  const eligibleQuestions = removeRepeatedSkillCoverage(uniqueByQuestion(orderedQuestions));
  let selected = filterPreviouslyAskedQuestions(
    eligibleQuestions.slice(0, finalTargetCount),
    previouslyAskedQuestions,
    { minKeep: Math.min(5, finalTargetCount) },
  ).slice(0, finalTargetCount);

  if (selected.length < finalTargetCount) {
    const fillerPool = filterPreviouslyAskedQuestions(eligibleQuestions, previouslyAskedQuestions);
    for (const candidate of fillerPool) {
      if (selected.length >= finalTargetCount) break;
      if (selected.some((item) => isNearDuplicateQuestion(item.question, candidate.question))) continue;
      selected.push(candidate);
    }
    selected = selected.slice(0, finalTargetCount);
  }

  if (selected.length < finalTargetCount) {
    selected = uniqueByQuestion([...selected, ...eligibleQuestions]).slice(0, finalTargetCount);
  }

  // E08: 30+ minute SDE-style runs must include at least one concrete coding question.
  const needsCodingGuarantee =
    duration >= 30
    && /sde|backend|frontend|full.?stack|software/i.test(
      `${interviewRoadmap?.roleDomain ?? ''} ${interviewRoadmap?.resumeProfile?.targetJobRole ?? ''}`,
    )
    && !selected.some(isConcreteCodingPrompt);
  if (needsCodingGuarantee) {
    const codingInject =
      codingStage.find(isConcreteCodingPrompt)
      || plannedQuestions.find(isConcreteCodingPrompt)
      || ({
        question:
          'Given an array of integers, write a function to return the indices of the two numbers that add up to a target. Explain your approach and its time complexity.',
        difficulty: 'medium',
        questionType: 'technical',
        topic: 'Coding / Problem Solving',
        expectedSignals: ['correct approach', 'edge cases', 'time complexity'],
        resumeReference: 'coding round',
      } as GeneratedQuestion);
    const insertAt = Math.min(3, selected.length);
    selected = uniqueByQuestion([
      ...selected.slice(0, insertAt),
      codingInject,
      ...selected.slice(insertAt),
    ]).slice(0, finalTargetCount);
  }

  return withQuestionMetadata(
    applyDifficultyProgression(stripDateAnchoredQuestions(selected), interviewRoadmap),
  );
};

const topicMatches = (candidate: string | undefined, topic: string) => {
  if (!candidate) return false;
  const left = normalizeTopic(candidate).toLowerCase();
  const right = normalizeTopic(topic).toLowerCase();
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
};

const sectionForTopic = (roadmap: InterviewRoadmap | undefined, topic: string | undefined) =>
  roadmap?.sections.find((section) => section.topics.some((sectionTopic) => topicMatches(topic, sectionTopic)));

export const deriveInterviewRuntimeState = ({
  roadmap,
  transcript,
}: {
  roadmap?: InterviewRoadmap;
  transcript: Array<{ question: string; topic?: string; resumeReference?: string }>;
}): InterviewRuntimeState => {
  const questionsAsked = transcript.length;
  const coveredConcepts = uniqueTopics(
    transcript.map((item) => item.topic ?? item.resumeReference ?? '').filter(Boolean),
  );
  const askedQuestions = transcript.map((item) => item.question);
  const lastTopic = transcript[transcript.length - 1]?.topic ?? transcript[transcript.length - 1]?.resumeReference;
  const currentSection = sectionForTopic(roadmap, lastTopic)?.key;
  const projectTopics = roadmap?.resumeProfile.projects ?? [];
  const certificationTopics = roadmap?.resumeProfile.certifications ?? [];
  const skillTopics = uniqueTopics([
    ...(roadmap?.resumeProfile.skills.programmingLanguages ?? []),
    ...(roadmap?.resumeProfile.skills.technicalSkills ?? []),
    ...(roadmap?.resumeProfile.skills.frameworks ?? []),
    ...(roadmap?.resumeProfile.skills.libraries ?? []),
    ...(roadmap?.resumeProfile.skills.databases ?? []),
    ...(roadmap?.resumeProfile.skills.cloudTechnologies ?? []),
  ]);
  const countTopic = (topic: string) =>
    transcript.filter((item) => topicMatches(item.topic ?? item.resumeReference, topic)).length;
  const consecutiveSameTopic = [...transcript]
    .reverse()
    .findIndex((item) => !topicMatches(item.topic ?? item.resumeReference, lastTopic ?? ''));

  return {
    current_section: currentSection,
    current_project: projectTopics.find((project) => topicMatches(lastTopic, project)),
    projects_completed: projectTopics.filter((project) => countTopic(project) >= (roadmap?.projectQuestionLimit ?? 3)),
    skills_completed: skillTopics.filter((skill) => countTopic(skill) > 0),
    internship_completed: Boolean(
      roadmap?.resumeProfile.internships.some((internship) => countTopic(internship) > 0) ||
        roadmap?.resumeProfile.workExperience.some((experience) => countTopic(experience) > 0),
    ),
    certifications_completed: certificationTopics.filter((certification) => countTopic(certification) > 0),
    company_questions_completed: transcript.some((item) => sectionForTopic(roadmap, item.topic ?? item.resumeReference)?.key === 'company_specific'),
    role_questions_completed: transcript.some((item) => sectionForTopic(roadmap, item.topic ?? item.resumeReference)?.key === 'role_specific'),
    behavioral_completed: transcript.some((item) => sectionForTopic(roadmap, item.topic ?? item.resumeReference)?.key === 'behavioral'),
    hr_completed: transcript.some((item) => sectionForTopic(roadmap, item.topic ?? item.resumeReference)?.key === 'hr'),
    coding_completed: transcript.some((item) => sectionForTopic(roadmap, item.topic ?? item.resumeReference)?.key === 'coding_problem_solving'),
    remaining_time: Math.max(0, Math.round((roadmap?.duration ?? 0) * (1 - questionsAsked / Math.max(1, roadmap?.targetQuestionCount ?? questionsAsked)))),
    questions_asked: questionsAsked,
    followups_current_topic: consecutiveSameTopic < 0 ? questionsAsked : consecutiveSameTopic,
    covered_concepts: coveredConcepts,
    asked_questions: askedQuestions,
  };
};
