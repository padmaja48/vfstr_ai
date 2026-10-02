import OpenAI, { toFile } from 'openai';
import { env } from '../config/env';
import {
  buildCompanyQuestionBankCacheKey,
  buildJobDescriptionCacheKey,
  buildResumeAnalysisCacheKey,
  getAiContextCache,
  normalizeContentHash,
  setAiContextCache,
} from './aiContextCache.service';
import {
  getConfiguredTextModel,
  getConfiguredTranscriptionModel,
  hashUserIdForTelemetry,
  recordAiUsage,
  type AiRequestType,
} from './aiUsageTelemetry.service';
import {
  assertAiCallsEnabled,
  createAiRequestId,
  isAiCallsEnabled,
  logAiCallFailure,
  logAiCallStart,
  logAiCallSuccess,
} from './aiCallGateway.service';
import { buildCompactInterviewState, formatCompactInterviewStateBlock } from './compactInterviewState';
import { getCompanyQuestions, slugifyCompanyName } from './companyQuestionBank';
import {
  buildAdaptiveTurnUserPrompt,
  buildInitialQuestionsUserPrompt,
  buildInterviewSystemPrompt,
  mapExperienceLevel,
  mapInterviewPromptType,
  type CompanyQuestionEntry,
  type ConversationTurn,
} from './promptBuilder';
import {
  aggregateSessionStrengths,
  alignEvaluationFeedbackToScore,
  applyScoringBandGuards,
  buildClarificationIdealAnswer,
  buildDifficultyProgressionSummary,
  buildReportGenerationPrompt,
  classifyAnswerTurn,
  computeCompanyReadinessScore,
  detectLikelySpeechArtifacts,
  extractSubmittedCode,
  formatBannedFeedbackPhrasesForPrompt,
  inferQuestionTypeFromContent,
  isMetaInterviewQuestion,
  isNearDuplicateQuestion,
  isPlaceholderOrBlankCode,
  isSubstantiveReportAnswer,
  looksLikeCodingSubmission,
  refineInterviewReport,
  sanitizeGroundedFeedbackText,
  sharedProjectName,
  type ReportTranscriptItem,
} from './interviewReport.utils';
import { sanitizeDateAnchoredQuestionText } from './resumeQuestionAnchoring.utils';

const openai = env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: env.OPENAI_API_KEY, baseURL: env.OPENAI_BASE_URL })
  : null;
const groq = env.GROQ_API_KEY
  ? new OpenAI({ apiKey: env.GROQ_API_KEY, baseURL: env.GROQ_BASE_URL })
  : null;

export type InterviewMode = 'sde' | 'frontend' | 'backend' | 'data_analyst' | 'ai_ml' | 'qa' | 'hr_behavioral';

type InterviewModeGuidance = {
  label: string;
  questionTemplate: string;
  questionAngles: string[];
};

type CompanyBankMode = 'verified' | 'web_research' | 'role_based' | 'generic' | 'none';

type InterviewContext = {
  interviewId?: string;
  roleLevel: string;
  roleDomain: string;
  interviewStyle: string;
  duration: number;
  resumeText?: string;
  jobDescription?: string;
  personaId?: string;
  personaPersonality?: string;
  interviewType?: string;
  interviewMode?: InterviewMode;
  complexity?: string;
  targetCompany?: string;
  resumeSkills?: string[];
  resumeExperienceLevel?: string;
  resumeSuggestedQuestions?: string[];
  resumeSummary?: string;
  resumeProfile?: ResumeInterviewProfile;
  companyQuestionBank?: CompanyQuestionEntry[] | null;
  companyBankMode?: CompanyBankMode;
  previouslyAskedQuestions?: string[];
};

type TranscriptionContext = {
  interviewId?: string;
  roleDomain?: string;
  currentQuestion?: string;
  jobDescription?: string;
  resumeSkills?: string[];
  resumeText?: string;
  resumeProjects?: string[];
  resumeSummary?: string;
  resumeEducation?: string[];
  targetCompany?: string;
};

const INTERVIEW_MODE_GUIDANCE: Record<InterviewMode, InterviewModeGuidance> = {
  sde: {
    label: 'Software Development Engineer',
    questionTemplate: 'Use a balanced SDE loop: fundamentals, coding reasoning, OOP/DBMS/OS, API design, debugging, project architecture, scalability, and ownership.',
    questionAngles: ['data structures and algorithms', 'OOP and design principles', 'DBMS and SQL', 'operating systems basics', 'API design', 'debugging', 'scalability trade-offs'],
  },
  frontend: {
    label: 'Frontend Developer',
    questionTemplate: 'Use a frontend loop: UI architecture, React or framework state, component design, browser behavior, accessibility, performance, API integration, testing, and responsive UX.',
    questionAngles: ['React/component architecture', 'state management', 'browser rendering', 'accessibility', 'frontend performance', 'API integration', 'UI testing'],
  },
  backend: {
    label: 'Backend Developer',
    questionTemplate: 'Use a backend loop: API design, authentication, databases, concurrency, caching, reliability, observability, production debugging, and scaling.',
    questionAngles: ['REST/API design', 'database schema and queries', 'authentication and authorization', 'concurrency', 'caching', 'observability', 'production incidents'],
  },
  data_analyst: {
    label: 'Data Analyst',
    questionTemplate: 'Use a data analyst loop: SQL, data cleaning, metrics, dashboards, statistics, business interpretation, data quality, and stakeholder communication.',
    questionAngles: ['SQL queries', 'data cleaning', 'dashboard design', 'business metrics', 'statistics basics', 'data quality checks', 'insight communication'],
  },
  ai_ml: {
    label: 'AI/ML Engineer',
    questionTemplate: 'Use an AI/ML loop: data preprocessing, feature engineering, model selection, evaluation metrics, embeddings/RAG when relevant, deployment, monitoring, and responsible AI.',
    questionAngles: ['data preprocessing', 'model selection', 'evaluation metrics', 'feature engineering', 'embeddings and retrieval', 'model deployment', 'monitoring and bias'],
  },
  qa: {
    label: 'QA Engineer',
    questionTemplate: 'Use a QA loop: test planning, test case design, defect reporting, API testing, automation, regression strategy, edge cases, and release risk.',
    questionAngles: ['test case design', 'bug reporting', 'API testing', 'automation strategy', 'regression testing', 'edge cases', 'release readiness'],
  },
  hr_behavioral: {
    label: 'HR / Behavioral',
    questionTemplate: 'Use an HR loop: introduction, motivation, strengths, conflict, teamwork, learning agility, communication, career goals, company fit, and STAR examples.',
    questionAngles: ['self introduction', 'motivation', 'teamwork', 'conflict handling', 'strengths and weaknesses', 'learning agility', 'career goals'],
  },
};

const isInterviewMode = (mode?: string): mode is InterviewMode =>
  Boolean(mode && Object.prototype.hasOwnProperty.call(INTERVIEW_MODE_GUIDANCE, mode));

export const getInterviewModeGuidance = (mode?: string) =>
  isInterviewMode(mode) ? INTERVIEW_MODE_GUIDANCE[mode] : INTERVIEW_MODE_GUIDANCE.sde;

export type SkillGraphNode = {
  skill: string;
  source: 'job_description' | 'resume' | 'role';
  category: 'required' | 'preferred' | 'responsibility' | 'tool' | 'soft_skill' | 'domain';
  weight: number;
};

export type SkillGraphEdge = {
  from: string;
  to: string;
  relation: 'requires' | 'commonly_used_with' | 'validates' | 'supports';
};

export type JobDescriptionProfile = {
  requiredSkills: string[];
  preferredSkills: string[];
  responsibilities: string[];
  toolsTechnologies: string[];
  experienceLevel: string;
  softSkills: string[];
  domainKnowledge: string[];
  keywords: string[];
  seniorityLevel: string;
  skillGraph: {
    nodes: SkillGraphNode[];
    edges: SkillGraphEdge[];
  };
};

export type GeneratedQuestion = {
  question: string;
  questionId?: string;
  conceptId?: string;
  bankQuestionId?: string;
  expectedSignals: string[];
  questionType?: 'behavioural' | 'technical' | 'situational';
  resumeReference?: string;
  difficulty?: 'easy' | 'easy-medium' | 'medium' | 'medium-hard' | 'scenario' | 'problem-solving' | 'behavioral';
  topic?: string;
  followUpIntent?: 'deepen' | 'clarify' | 'bridge-topic' | 'challenge' | 'recover-confidence';
};

export type AnswerEvaluation = {
  score: number;
  feedback: string;
  idealAnswer?: string;
  samplePerfectAnswer?: string;
  conceptsCovered?: string[];
  missingConcepts?: string[];
  incorrectStatements?: string[];
  wrongTerminology?: string[];
  technicalMistakes?: string[];
  dynamicFeedback?: {
    strengths: string[];
    missingConcepts: string[];
    technicalMistakes: string[];
    communication: string;
    confidence: string;
    areasToImprove: string[];
    nextLearningSuggestions: string[];
    practicalUnderstanding: string;
    interviewReadiness: string;
  };
  communicationScore: number;
  technicalScore: number;
  behavioralScore: number;
  confidenceScore?: number;
  completenessScore?: number;
  depthScore?: number;
  terminologyScore?: number;
  grammarScore?: number;
  vocabularyScore?: number;
  domainScore?: number;
  nextAction?: 'ask_deeper' | 'clarify' | 'move_topic' | 'challenge' | 'reduce_difficulty';
  suggestedDifficulty?: GeneratedQuestion['difficulty'];
  detectedSignals?: string[];
  missingSignals?: string[];
};

export type AdaptiveFollowUpDecision = {
  action: NonNullable<AnswerEvaluation['nextAction']>;
  focus: string;
  reason: string;
  targetDifficulty: NonNullable<GeneratedQuestion['difficulty']>;
  followUpIntent: NonNullable<GeneratedQuestion['followUpIntent']>;
};

export type QuestionAnalysisItem = {
  question: string;
  answer: string;
  score: number;
  feedback: string;
  whatWorked: string;
  whatToImprove: string;
  questionType: string;
  resumeReference: string;
  idealAnswer?: string;
  samplePerfectAnswer?: string;
  conceptsCovered?: string[];
  missingConcepts?: string[];
  incorrectStatements?: string[];
  wrongTerminology?: string[];
  technicalMistakes?: string[];
  dynamicFeedback?: ReportTranscriptItem['dynamicFeedback'];
};

export type InterviewReport = {
  communicationScore: number;
  technicalScore: number;
  behavioralScore: number;
  confidenceScore?: number;
  grammarScore?: number;
  vocabularyScore?: number;
  domainExpertiseScore?: number;
  overallScore: number;
  strengths: string[];
  improvements: string[];
  recommendations: string[];
  transcriptSummary: string;
  questionAnalysis?: QuestionAnalysisItem[];
  skillWiseStrengths?: Array<{ skill: string; evidence: string; score: number }>;
  areasForImprovement?: string[];
  missedConcepts?: string[];
  recommendedLearningResources?: string[];
  difficultyProgression?: string[];
  questionTimeline?: Array<{ question: string; topic: string; difficulty: string; score: number }>;
  followUpQuality?: string;
  hiringRecommendation?: 'Strong Hire' | 'Hire' | 'Borderline' | 'No Hire';
  hiringRecommendationReason?: string;
  speakerName?: string;
  accountOwnerName?: string;
  companyReadinessScore?: number;
  totalPlannedQuestions?: number;
  questionsAttempted?: number;
  questionsAnswered?: number;
  endedEarly?: boolean;
  endReason?: 'terminated' | 'manual_early' | 'completed';
  terminationReason?: string;
  scoreConfidenceNote?: string;
  sessionNote?: string;
};

export type ReportGenerationContext = {
  interviewId?: string;
  speakerName?: string;
  accountOwnerName?: string;
  targetCompany?: string;
  interviewMode?: InterviewMode;
  resumeProjects?: string[];
  resumeSkills?: string[];
  liveScores?: Partial<Record<'grammar' | 'vocabulary' | 'confidence' | 'completeness' | 'depth' | 'terminology' | 'domain', number>>;
  totalPlannedQuestions?: number;
  sessionMeta?: import('./interviewReport.utils').ReportSessionMeta;
};

export type AdaptiveTurnResponse = {
  candidateMessageIntent: 'answer' | 'question_to_interviewer';
  interviewerReply?: string | null;
  question: GeneratedQuestion;
};

export type AdaptiveQuestionContext = InterviewContext & {
  previousQuestions: GeneratedQuestion[];
  transcript: Array<{
    question: string;
    answer?: string;
    score?: number;
    feedback?: string;
    questionType?: string;
    resumeReference?: string;
    difficulty?: string;
    topic?: string;
  }>;
  lastQuestion: GeneratedQuestion;
  lastAnswer: string;
  lastEvaluation: AnswerEvaluation;
  followUpDecision?: AdaptiveFollowUpDecision;
  targetQuestionCount: number;
  currentQuestionIndex: number;
  jdProfile?: JobDescriptionProfile;
  companyGuidance?: CompanyInterviewGuidance;
  interviewRoadmap?: InterviewRoadmap;
  interviewState?: InterviewRuntimeState;
};

export type CompanyInterviewGuidance = {
  company?: string;
  style: string;
  preferredTopics: string[];
  behavioralStyle: string;
  codingStyle: string;
  systemDesignExpectations: string;
  technicalDepth: string;
  caution: string;
  researchSource?: 'static' | 'web' | 'static+web';
  researchedAt?: string;
  researchQueries?: string[];
  researchInsights?: string[];
};

export type ResumeInterviewProfile = {
  candidateInformation: {
    name?: string;
    education?: string[];
    degree?: string;
    branch?: string;
    cgpa?: string;
    college?: string;
  };
  skills: {
    programmingLanguages: string[];
    frameworks: string[];
    libraries: string[];
    databases: string[];
    cloudTechnologies: string[];
    operatingSystems: string[];
    developerTools: string[];
    versionControl: string[];
    technicalSkills: string[];
    softSkills: string[];
  };
  projects: string[];
  internships: string[];
  workExperience: string[];
  certifications: string[];
  coursework: string[];
  achievements: string[];
  hackathons: string[];
  researchPapers: string[];
  publications: string[];
  leadership: string[];
  positionsOfResponsibility: string[];
  strengths: string[];
  areasOfInterest: string[];
  interests: string[];
  targetJobRole?: string;
  expectedCompany?: string;
};

export type InterviewRoadmapSectionKey =
  | 'self_introduction'
  | 'resume_overview'
  | 'coursework'
  | 'programming_languages'
  | 'technical_skills'
  | 'projects'
  | 'internship'
  | 'certifications'
  | 'role_specific'
  | 'company_specific'
  | 'coding_problem_solving'
  | 'system_design'
  | 'behavioral'
  | 'hr'
  | 'candidate_questions'
  | 'closing';

export type InterviewRoadmapSection = {
  key: InterviewRoadmapSectionKey;
  title: string;
  topics: string[];
  questionBudget: number;
};

export type InterviewRoadmap = {
  duration: number;
  targetQuestionCount: number;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  roleDomain: string;
  roleLevel: string;
  targetCompany?: string;
  resumeProfile: ResumeInterviewProfile;
  sections: InterviewRoadmapSection[];
  projectQuestionLimit: number;
  followUpLimit: number;
};

export type InterviewRuntimeState = {
  current_section?: InterviewRoadmapSectionKey;
  current_project?: string;
  projects_completed: string[];
  skills_completed: string[];
  internship_completed: boolean;
  certifications_completed: string[];
  company_questions_completed: boolean;
  role_questions_completed: boolean;
  behavioral_completed: boolean;
  hr_completed: boolean;
  coding_completed: boolean;
  remaining_time: number;
  questions_asked: number;
  followups_current_topic: number;
  covered_concepts: string[];
  asked_questions: string[];
};

export type ResumeAnalysis = {
  summary: string;
  skills: string[];
  experienceLevel: string;
  yearsOfExperience: number;
  score: number;
  strengths: string[];
  gaps: string[];
  suggestedQuestions: string[];
};

const TECHNOLOGY_PATTERNS: Array<[string, RegExp]> = [
  ['JavaScript', /\b(?:javascript|js)\b/i],
  ['TypeScript', /\b(?:typescript|ts)\b/i],
  ['React', /\breact(?:\.js|js)?\b/i],
  ['Angular', /\bangular\b/i],
  ['Vue.js', /\bvue(?:\.js|js)?\b/i],
  ['Node.js', /\bnode(?:\.js|js)?\b/i],
  ['Express.js', /\bexpress(?:\.js|js)?\b/i],
  ['Next.js', /\bnext(?:\.js|js)?\b/i],
  ['Python', /\bpython\b/i],
  ['Django', /\bdjango\b/i],
  ['Flask', /\bflask\b/i],
  ['FastAPI', /\bfastapi\b/i],
  ['Java', /\bjava\b/i],
  ['Spring Boot', /\bspring\s*boot\b/i],
  ['C#', /\bc#\b/i],
  ['.NET', /\b\.net\b/i],
  ['C++', /\bc\+\+\b/i],
  ['C', /(?:^|[,:;\s(|/])C(?:$|[,:;\s)|/])/],
  ['Go', /\bgolang\b/i],
  ['PHP', /\bphp\b/i],
  ['Laravel', /\blaravel\b/i],
  ['Ruby on Rails', /\bruby\s+on\s+rails\b|\brails\b/i],
  ['HTML', /\bhtml5?\b/i],
  ['CSS', /\bcss3?\b/i],
  ['SQL', /\bsql\b/i],
  ['MySQL', /\bmysql\b/i],
  ['PostgreSQL', /\bpostgres(?:ql)?\b/i],
  ['MongoDB', /\bmongodb\b/i],
  ['Redis', /\bredis\b/i],
  ['Elasticsearch', /\belasticsearch\b/i],
  ['GraphQL', /\bgraphql\b/i],
  ['REST APIs', /\brest(?:ful)?\s+api?s?\b/i],
  ['AWS', /\baws\b|\bamazon web services\b/i],
  ['Azure', /\bazure\b/i],
  ['Google Cloud', /\bgcp\b|\bgoogle cloud\b/i],
  ['Docker', /\bdocker\b/i],
  ['Kubernetes', /\bkubernetes\b|\bk8s\b/i],
  ['Jenkins', /\bjenkins\b/i],
  ['Git', /\bgit\b/i],
  ['GitHub', /\bgithub\b/i],
  ['VS Code', /\bvs\s*code\b|\bvisual studio code\b/i],
  ['Jupyter', /\bjupyter(?:\s*notebook)?\b/i],
  ['Google Colab', /\b(?:google\s*)?colab\b/i],
  ['Vercel', /\bvercel\b/i],
  ['CI/CD', /\bci\/cd\b|\bcontinuous integration\b|\bcontinuous deployment\b/i],
  ['Terraform', /\bterraform\b/i],
  ['Kafka', /\bkafka\b/i],
  ['RabbitMQ', /\brabbitmq\b/i],
  ['Microservices', /\bmicroservices?\b/i],
  ['System Design', /\bsystem design\b/i],
  ['OOP', /\boops?\b|\bobject[- ]oriented(?:\s+programming)?\b/i],
  ['Data Structures', /\bdata structures?(?:\s*(?:and|&)\s*algorithms?)?\b|\bdsa\b/i],
  ['Machine Learning', /\bmachine learning\b|\bai\s*\/\s*ml\b|\bml\b/i],
  ['TensorFlow', /\btensorflow\b/i],
  ['PyTorch', /\bpytorch\b/i],
  ['Scikit-learn', /\bscikit(?:-|\s)?learn\b|\bsklearn\b/i],
  ['LangChain', /\blangchain\b/i],
  ['NLP', /\bnlp\b|\bnatural language processing\b/i],
  ['Streamlit', /\bstreamlit\b/i],
  ['Pandas', /\bpandas\b/i],
  ['NumPy', /\bnumpy\b/i],
  ['Power BI', /\bpower\s*bi\b/i],
  ['Tableau', /\btableau\b/i],
  ['Selenium', /\bselenium\b/i],
  ['Cypress', /\bcypress\b/i],
  ['Jest', /\bjest\b/i],
  ['Playwright', /\bplaywright\b/i],
  ['Agile', /\bagile\b/i],
  ['Scrum', /\bscrum\b/i],
];

const SOFT_SKILL_PATTERNS: Array<[string, RegExp]> = [
  ['Communication', /\bcommunication|presentation|stakeholder|client-facing\b/i],
  ['Leadership', /\bleadership|mentoring|team lead|ownership\b/i],
  ['Collaboration', /\bcollaboration|cross-functional|teamwork\b/i],
  ['Problem Solving', /\bproblem[-\s]?solving|debugging|troubleshooting\b/i],
  ['Adaptability', /\badaptability|fast[-\s]?paced|learn quickly|ambiguity\b/i],
  ['Attention to Detail', /\battention to detail|accuracy|quality\b/i],
];

const DOMAIN_PATTERNS: Array<[string, RegExp]> = [
  ['FinTech', /\bfintech|payments?|banking|trading|financial|invoice|ledger\b/i],
  ['Healthcare', /\bhealthcare|clinical|patient|medical|life sciences\b/i],
  ['E-commerce', /\be-?commerce|checkout|cart|catalog|marketplace|retail\b/i],
  ['AI/ML', /\bai|machine learning|ml|llm|rag|embeddings?|computer vision|nlp\b/i],
  ['SaaS', /\bsaas|multi-tenant|enterprise software|subscription\b/i],
  ['Cybersecurity', /\bsecurity|iam|authentication|authorization|vulnerability|threat\b/i],
  ['Data Engineering', /\bdata pipeline|etl|warehouse|analytics|bi\b/i],
];

const RESPONSIBILITY_PATTERN =
  /\b(?:design(?:ing|s|ed)?|develop(?:ing|s|ed)?|build(?:ing|s|s)?|implement(?:ing|s|ed)?|maintain(?:ing|s|ed)?|own(?:ing|s|ed)?|lead(?:ing|s)?|deploy(?:ing|s|ed)?|optimi[sz](?:e|ing|es|ed)|debug(?:ging|s|ged)?|integrat(?:e|ing|es|ed)|collaborat(?:e|ing|es|ed)|manag(?:e|ing|es|ed)|test(?:ing|s|ed)?|monitor(?:ing|s|ed)?)\b[^.\n;]*/gi;

const canonicalize = (value: string) => value.replace(/\s+/g, ' ').trim();

const unique = (values: string[]) =>
  Array.from(new Set(values.map(canonicalize).filter(Boolean)));

export const extractJobDescriptionTechnologies = (jobDescription?: string) => {
  const text = jobDescription?.trim();
  if (!text) return [];

  return TECHNOLOGY_PATTERNS
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => name);
};

const isSoftSkillOnlyFallback = (skills?: string[]) => {
  const normalized = (skills ?? []).map((skill) => skill.trim().toLowerCase()).filter(Boolean);
  return (
    normalized.length > 0
    && normalized.length <= 2
    && normalized.every((skill) => skill === 'communication' || skill === 'problem solving')
  );
};

/** Deterministic skill extraction used when AI analysis is unavailable or incomplete. */
export const extractResumeSkillsHeuristic = (resumeText?: string) => {
  const text = resumeText?.trim();
  if (!text) return [];

  const tech = extractJobDescriptionTechnologies(text);
  const soft = extractPatternMatches(text, SOFT_SKILL_PATTERNS);
  return unique([...tech, ...soft]).slice(0, 40);
};

const extractPatternMatches = (text: string, patterns: Array<[string, RegExp]>) =>
  patterns.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);

const extractResponsibilities = (text: string) =>
  unique((text.match(RESPONSIBILITY_PATTERN) ?? []).map((item) => item.replace(/^\s*[-*]\s*/, '').slice(0, 160))).slice(0, 12);

const extractExperienceLevel = (text: string, roleLevel?: string) => {
  const years = text.match(/(\d+)\+?\s*(?:years|yrs)/i)?.[1];
  if (/principal|staff|architect/i.test(text)) return years ? `Principal/Staff, ${years}+ years` : 'Principal/Staff';
  if (/lead|manager|head of/i.test(text)) return years ? `Lead, ${years}+ years` : 'Lead';
  if (/senior|sr\./i.test(text)) return years ? `Senior, ${years}+ years` : 'Senior';
  if (/intern|graduate|entry[-\s]?level|fresher/i.test(text)) return years ? `Entry level, ${years}+ years` : 'Entry level';
  if (years) return `${years}+ years`;
  return roleLevel || 'Not specified';
};

const inferSeniority = (text: string, roleLevel?: string) => {
  if (/principal|staff|architect/i.test(text)) return 'Principal';
  if (/lead|manager|head of/i.test(text)) return 'Lead';
  if (/senior|sr\./i.test(text)) return 'Senior';
  if (/mid|software engineer ii|sde ii/i.test(text)) return 'Mid';
  if (/junior|entry[-\s]?level|graduate|fresher|intern/i.test(text)) return 'Fresher';
  return roleLevel || 'Mid';
};

const extractKeywords = (text: string) => {
  const words = text
    .replace(/[^a-zA-Z0-9+#./\s-]/g, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !/^(and|the|with|for|from|this|that|you|are|will|have|our|your|role|work|team)$/i.test(word));

  const frequency = new Map<string, number>();
  words.forEach((word) => frequency.set(word.toLowerCase(), (frequency.get(word.toLowerCase()) ?? 0) + 1));
  return Array.from(frequency.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([word]) => word);
};

export const buildJobDescriptionProfile = (
  jobDescription?: string,
  options: { roleLevel?: string; resumeSkills?: string[]; roleDomain?: string } = {},
): JobDescriptionProfile => {
  const text = jobDescription?.trim() ?? '';
  const toolsTechnologies = unique(extractJobDescriptionTechnologies(text));
  const resumeOverlap = unique((options.resumeSkills ?? []).filter((skill) => new RegExp(`\\b${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)));
  const softSkills = unique(extractPatternMatches(text, SOFT_SKILL_PATTERNS));
  const domainKnowledge = unique(extractPatternMatches(`${text}\n${options.roleDomain ?? ''}`, DOMAIN_PATTERNS));
  const responsibilities = extractResponsibilities(text);
  const preferredSkills = unique(
    toolsTechnologies.filter((skill) => {
      const skillIndex = text.toLowerCase().indexOf(skill.toLowerCase());
      const preceding = skillIndex >= 0 ? text.slice(Math.max(0, skillIndex - 90), skillIndex).toLowerCase() : '';
      return /preferred|nice to have|good to have|plus|bonus|familiar/.test(preceding);
    }),
  );
  const requiredSkills = unique([...toolsTechnologies.filter((skill) => !preferredSkills.includes(skill)), ...resumeOverlap]);
  const keywords = unique([...toolsTechnologies, ...softSkills, ...domainKnowledge, ...extractKeywords(text)]).slice(0, 40);

  const nodes: SkillGraphNode[] = [
    ...requiredSkills.map((skill) => ({ skill, source: 'job_description' as const, category: 'required' as const, weight: 1 })),
    ...preferredSkills.map((skill) => ({ skill, source: 'job_description' as const, category: 'preferred' as const, weight: 0.7 })),
    ...softSkills.map((skill) => ({ skill, source: 'job_description' as const, category: 'soft_skill' as const, weight: 0.6 })),
    ...domainKnowledge.map((skill) => ({ skill, source: 'job_description' as const, category: 'domain' as const, weight: 0.8 })),
  ];

  const edges: SkillGraphEdge[] = [];
  for (let i = 0; i < toolsTechnologies.length; i += 1) {
    for (let j = i + 1; j < Math.min(toolsTechnologies.length, i + 4); j += 1) {
      edges.push({ from: toolsTechnologies[i], to: toolsTechnologies[j], relation: 'commonly_used_with' });
    }
  }
  responsibilities.slice(0, 5).forEach((responsibility) => {
    toolsTechnologies.slice(0, 4).forEach((skill) => {
      edges.push({ from: skill, to: responsibility, relation: 'supports' });
    });
  });

  return {
    requiredSkills,
    preferredSkills,
    responsibilities,
    toolsTechnologies,
    experienceLevel: extractExperienceLevel(text, options.roleLevel),
    softSkills,
    domainKnowledge,
    keywords,
    seniorityLevel: inferSeniority(text, options.roleLevel),
    skillGraph: {
      nodes: unique(nodes.map((node) => node.skill)).map((skill) => nodes.find((node) => node.skill === skill) as SkillGraphNode),
      edges,
    },
  };
};

export const getCachedJobDescriptionProfile = async (
  jobDescription: string | undefined,
  options: { roleLevel?: string; resumeSkills?: string[]; roleDomain?: string } = {},
): Promise<JobDescriptionProfile> => {
  const text = jobDescription?.trim() ?? '';
  const profile = buildJobDescriptionProfile(jobDescription, options);
  if (!text) return profile;

  const contentHash = normalizeContentHash(text);
  const cacheKey = buildJobDescriptionCacheKey(contentHash);
  try {
    const cached = await getAiContextCache<JobDescriptionProfile>(cacheKey);
    if (cached) return cached;
    await setAiContextCache({
      cacheKey,
      kind: 'job_description_profile',
      contentHash,
      payload: profile as unknown as Record<string, unknown>,
    });
  } catch {
    // Cache is best-effort; heuristic profile is always available.
  }
  return profile;
};

const TECHNICAL_TERM_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\brest\s*api?s?\b/gi, 'REST API'],
  [/\bfast\s*api\b/gi, 'FastAPI'],
  [/\bnum\s*pi\b|\bnumpy\b/gi, 'NumPy'],
  [/\bpandas\b/gi, 'Pandas'],
  [/\bpi\s*torch\b|\bpytorch\b/gi, 'PyTorch'],
  [/\btensor\s*flow\b|\btensorflow\b/gi, 'TensorFlow'],
  [/\bpostgre\s*sql\b|\bpostgres\b|\bpostgresql\b/gi, 'PostgreSQL'],
  [/\bmongo\s*db\b|\bmongodb\b/gi, 'MongoDB'],
  [/\bnode\s*js\b/gi, 'Node.js'],
  [/\bnext\s*js\b/gi, 'Next.js'],
  [/\bvue\s*js\b/gi, 'Vue.js'],
  [/\bgraph\s*ql\b/gi, 'GraphQL'],
  [/\bo\s*auth\b/gi, 'OAuth'],
  [/\bj\s*w\s*t\b/gi, 'JWT'],
  [/\bci\s*\/?\s*cd\b/gi, 'CI/CD'],
  [/\bk\s*8\s*s\b/gi, 'K8s'],
  [/\bkubernetes\b/gi, 'Kubernetes'],
  [/\blang\s*chain\b/gi, 'LangChain'],
  [/\bopen\s*ai\b/gi, 'OpenAI'],
  [/\bl\s*l\s*m?s?\b/gi, 'LLM'],
  [/\br\s*a\s*g\b/gi, 'RAG'],
  [/\bf\s*a\s*i\s*s\s*s\b/gi, 'FAISS'],
  [/\bgit\s*hub\b/gi, 'GitHub'],
  // Degree / qualification phrasing only (not a national college dictionary)
  [/\bbee\s*tech\b/gi, 'B.Tech'],
  [/\bb\s*tech\b/gi, 'B.Tech'],
  [/\bm\s*tech\b/gi, 'M.Tech'],
];

const SAFE_CONTEXT_TERM_MIN_LENGTH = 5;

const EDUCATION_ANCHOR =
  /\b(?:university|college|institute|institution|school|academy|polytechnic)\b/i;

/** Pull college/university names from THIS candidate's resume — scales without a national list. */
export const extractEducationEntities = (resumeText?: string): string[] => {
  if (!resumeText?.trim()) return [];
  const lines = resumeText
    .split(/\r?\n|[,;|]/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const entities: string[] = [];
  for (const line of lines) {
    if (!EDUCATION_ANCHOR.test(line)) continue;
    if (line.length < 6 || line.length > 120) continue;
    // Drop long bullet paragraphs; keep institution-like phrases
    if ((line.match(/\b/g) || []).length > 28) continue;
    const cleaned = line
      .replace(/^(education|academic|qualification|college|university)\s*[:\-–]?\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length >= 6) entities.push(cleaned);
  }

  return unique(entities).slice(0, 12);
};

const significantTokens = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !['the', 'and', 'for', 'from', 'with', 'university', 'college', 'institute', 'of'].includes(token));

/**
 * When the transcript mentions a university/college, map the garbled phrase
 * to the closest institution name found on the candidate's resume.
 */
export const alignTranscriptWithResumeEducation = (
  transcript: string,
  educationEntities: string[],
): string => {
  if (!transcript?.trim() || !educationEntities.length) return transcript;

  const anchorMatch = transcript.match(
    /\b(?:[\w'.-]+\s+){0,5}(?:university|college|institute|institution|school|academy|polytechnic)\b(?:\s+[\w'.-]+){0,3}/gi,
  );
  if (!anchorMatch?.length) return transcript;

  let updated = transcript;
  for (const phrase of anchorMatch) {
    const phraseTokens = new Set(significantTokens(phrase));
    if (!phraseTokens.size && !EDUCATION_ANCHOR.test(phrase)) continue;

    let best: { name: string; score: number } | null = null;
    for (const entity of educationEntities) {
      const entityTokens = significantTokens(entity);
      if (!entityTokens.length) continue;
      const overlap = entityTokens.filter((token) => {
        if (phraseTokens.has(token)) return true;
        // Allow fuzzy token match (vigyan ~ vignan, nancy distant from vignan so won't false-match alone)
        return [...phraseTokens].some((pt) => {
          const distance = levenshtein(pt, token);
          const maxDistance = token.length >= 6 ? 2 : 1;
          return distance <= maxDistance;
        });
      }).length;
      const coverage = overlap / entityTokens.length;
      // Prefer entities with shared distinctive tokens; also prefer sole resume school near "university"
      const score = coverage + (educationEntities.length === 1 ? 0.35 : 0);
      if (!best || score > best.score) best = { name: entity, score };
    }

    if (best && best.score >= 0.35) {
      updated = updated.replace(phrase, best.name);
    }
  }

  return updated.replace(/\bfrom\s+with\s+/gi, 'from ').replace(/\s+/g, ' ').trim();
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const levenshtein = (a: string, b: string) => {
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

const replaceSafeContextTerm = (text: string, term: string) => {
  if (term.length < SAFE_CONTEXT_TERM_MIN_LENGTH) return text;

  const pattern = new RegExp(`\\b${escapeRegExp(term).replace(/\s+/g, '\\s+')}\\b`, 'gi');
  return text.replace(pattern, (match) => {
    if (match.toLowerCase() === term.toLowerCase()) return term;
    const distance = levenshtein(match.toLowerCase(), term.toLowerCase());
    const maxDistance = term.length >= 8 ? 2 : 1;
    return distance <= maxDistance ? term : match;
  });
};

export const normalizeTechnicalTranscript = (text: string, context?: TranscriptionContext) => {
  let normalized = text.replace(/\s+/g, ' ').trim();
  TECHNICAL_TERM_REPLACEMENTS.forEach(([pattern, replacement]) => {
    normalized = normalized.replace(pattern, replacement);
  });

  const educationEntities = unique([
    ...(context?.resumeEducation ?? []),
    ...extractEducationEntities(context?.resumeText),
  ]);
  normalized = alignTranscriptWithResumeEducation(normalized, educationEntities);

  const contextTerms = unique([
    ...(context?.resumeSkills ?? []),
    ...(context?.resumeProjects ?? []),
    ...educationEntities,
    ...extractJobDescriptionTechnologies(context?.jobDescription),
  ]).sort((a, b) => b.length - a.length);

  contextTerms.forEach((term) => {
    normalized = replaceSafeContextTerm(normalized, term);
  });

  return normalized;
};

const WHISPER_PROMPT_MAX_CHARS = 800;
const MIN_INTERVIEW_AUDIO_BYTES = 1200;

const extractQuestionVocabulary = (question?: string) => {
  if (!question?.trim()) return [] as string[];
  return extractJobDescriptionTechnologies(question);
};

/**
 * Groq/OpenAI Whisper uses `prompt` as style + vocabulary priming — NOT instructions.
 * Long "do not hallucinate" text can bleed into the transcript or skew output.
 * We prime with a short, natural candidate-answer sentence containing expected terms.
 */
export const buildGroqWhisperPrompt = (context?: TranscriptionContext): string => {
  const educationEntities = unique([
    ...(context?.resumeEducation ?? []),
    ...extractEducationEntities(context?.resumeText),
  ]).slice(0, 4);

  const terms = unique(
    [
      ...educationEntities,
      ...(context?.resumeSkills ?? []),
      ...(context?.resumeProjects ?? []),
      ...extractJobDescriptionTechnologies(context?.jobDescription),
      ...extractQuestionVocabulary(context?.currentQuestion),
      context?.roleDomain,
      context?.targetCompany,
    ].filter((term): term is string => Boolean(term?.trim())),
  )
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && term.length <= 48)
    .slice(0, 18);

  if (terms.length >= 3) {
    const [first, second, third, ...rest] = terms;
    const tail = rest.slice(0, 6).join(', ');
    const educationBit = educationEntities[0]
      ? `I studied at ${educationEntities[0]}. `
      : '';
    const sample = tail
      ? `${educationBit}In my project I used ${first}, ${second}, and ${third}, along with ${tail}. I explained the architecture, trade-offs, and testing approach.`
      : `${educationBit}In my project I used ${first}, ${second}, and ${third}. I explained the design, implementation, and results.`;
    return sample.slice(0, WHISPER_PROMPT_MAX_CHARS);
  }

  if (educationEntities[0]) {
    return `I completed my B.Tech at ${educationEntities[0]}. In my internship I worked on REST APIs, a SQL database, and backend services.`.slice(
      0,
      WHISPER_PROMPT_MAX_CHARS,
    );
  }

  return 'In my internship I worked on REST APIs, a SQL database, and backend services. I handled debugging, testing, and deployment.'.slice(
    0,
    WHISPER_PROMPT_MAX_CHARS,
  );
};

const buildTranscriptionPrompt = (context?: TranscriptionContext) => {
  if (env.AI_PROVIDER === 'groq') {
    return buildGroqWhisperPrompt(context);
  }

  const terms = Array.from(
    new Set([
      ...(context?.resumeSkills ?? []),
      ...(context?.resumeProjects ?? []),
      ...extractJobDescriptionTechnologies(context?.jobDescription),
      ...extractQuestionVocabulary(context?.currentQuestion),
    ]
      .map((term) => term.trim())
      .filter(Boolean)),
  ).slice(0, 30);

  return terms.length
    ? `Technical interview answer mentioning ${terms.join(', ')}.`
    : 'Technical interview answer about software engineering projects and experience.';
};

const extractJson = <T>(text: string): T => {
  const cleaned = text.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
  return JSON.parse(cleaned) as T;
};

type GenerateJsonOptions = {
  systemPrompt?: string;
  temperature?: number;
  requestType?: AiRequestType;
  interviewId?: string;
  userIdHash?: string;
};

const readUsage = (usage: unknown) => {
  const record = (usage ?? {}) as Record<string, unknown>;
  const promptTokens = Number(record.input_tokens ?? record.prompt_tokens ?? 0) || 0;
  const completionTokens = Number(record.output_tokens ?? record.completion_tokens ?? 0) || 0;
  const cachedInputTokens = Number(
    (record.input_tokens_details as Record<string, unknown> | undefined)?.cached_tokens
    ?? (record.prompt_tokens_details as Record<string, unknown> | undefined)?.cached_tokens
    ?? 0,
  ) || 0;
  return { inputTokens: promptTokens, outputTokens: completionTokens, cachedInputTokens };
};

const generateJson = async <T>(
  prompt: string,
  fallback: T,
  options?: GenerateJsonOptions,
): Promise<T> => {
  const systemContent = options?.systemPrompt ?? 'Return strict JSON only. Do not include markdown.';
  const temperature = options?.temperature;
  const requestType = options?.requestType ?? 'concept_generation';
  const provider = env.AI_PROVIDER;
  const model = getConfiguredTextModel();

  if (!isAiCallsEnabled()) {
    console.warn(`AI calls disabled; using fallback for ${requestType}.`);
    return fallback;
  }

  const requestId = createAiRequestId();
  const traceCtx = {
    requestId,
    operation: requestType,
    requestType,
    sourceFile: 'ai.service.ts',
    provider,
    model,
    interviewId: options?.interviewId,
    userIdHash: options?.userIdHash,
    isBackground: false,
  };
  logAiCallStart(traceCtx);
  const startedAt = Date.now();

  try {
    assertAiCallsEnabled(requestType);
    if (env.AI_PROVIDER === 'openai' && openai) {
      const client = openai as unknown as {
        responses: {
          create(input: {
            model: string;
            input: string;
            temperature?: number;
            text: { format: { type: 'json_object' } };
          }): Promise<{ output_text: string; usage?: unknown }>;
        };
      };

      const response = await client.responses.create({
        model: env.OPENAI_MODEL,
        input: `${systemContent}\n\n${prompt}`,
        ...(typeof temperature === 'number' ? { temperature } : {}),
        text: { format: { type: 'json_object' } },
      });

      const usage = readUsage(response.usage);
      recordAiUsage({
        interviewId: options?.interviewId,
        userIdHash: options?.userIdHash,
        requestType,
        provider,
        model,
        ...usage,
        success: true,
      });
      logAiCallSuccess(traceCtx, { ...usage, durationMs: Date.now() - startedAt });

      return extractJson<T>(response.output_text);
    }

    if (env.AI_PROVIDER === 'groq' && groq) {
      const response = await groq.chat.completions.create({
        model: env.GROQ_MODEL,
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        ...(typeof temperature === 'number' ? { temperature } : {}),
      });

      const usage = readUsage(response.usage);
      recordAiUsage({
        interviewId: options?.interviewId,
        userIdHash: options?.userIdHash,
        requestType,
        provider,
        model,
        ...usage,
        success: true,
      });
      logAiCallSuccess(traceCtx, { ...usage, durationMs: Date.now() - startedAt });

      return extractJson<T>(response.choices[0]?.message?.content ?? '{}');
    }
  } catch (error) {
    const errorCode = error instanceof Error ? error.name : 'AI_JSON_ERROR';
    recordAiUsage({
      interviewId: options?.interviewId,
      userIdHash: options?.userIdHash,
      requestType,
      provider,
      model,
      success: false,
      errorCode,
    });
    logAiCallFailure(traceCtx, errorCode, { durationMs: Date.now() - startedAt });
    console.warn('AI JSON generation failed; using deterministic fallback.', error);
  }

  return fallback;
};

const estimateAudioDurationMinutes = (byteLength: number) =>
  Number(Math.max(0.05, byteLength / 32_000 / 60).toFixed(3));

export const transcribeAudio = async (file: Express.Multer.File, context?: TranscriptionContext) => {
  const client = env.AI_PROVIDER === 'groq' ? groq : openai;
  const model = getConfiguredTranscriptionModel();
  const provider = env.AI_PROVIDER;

  if (!isAiCallsEnabled()) {
    return {
      text: `Transcription unavailable: AI calls are disabled (AI_CALLS_ENABLED=false).`,
      model,
      provider,
    };
  }

  if (!client) {
    return {
      text: `Transcription unavailable locally for ${file.originalname}. Configure ${provider.toUpperCase()}_API_KEY to enable speech recognition.`,
      model,
      provider,
    };
  }

  if (file.buffer.length < MIN_INTERVIEW_AUDIO_BYTES) {
    return {
      text: '',
      rawText: '',
      model,
      provider,
      promptApplied: false,
      warning: 'Audio clip was too short to transcribe reliably.',
    };
  }

  const uploadedFile = await toFile(file.buffer, file.originalname, { type: file.mimetype });
  const prompt = buildTranscriptionPrompt(context);
  const requestId = createAiRequestId();
  const traceCtx = {
    requestId,
    operation: 'fallback_transcription',
    requestType: 'fallback_transcription' as const,
    sourceFile: 'ai.service.ts',
    provider,
    model,
    interviewId: context?.interviewId,
    isBackground: false,
  };
  logAiCallStart(traceCtx);
  const startedAt = Date.now();
  try {
    assertAiCallsEnabled('fallback_transcription');
    const response = await client.audio.transcriptions.create({
      file: uploadedFile,
      model,
      language: 'en',
      prompt,
      temperature: 0,
      response_format: 'json',
    } as any);

    const rawText = typeof response.text === 'string' ? response.text.trim() : '';
    recordAiUsage({
      interviewId: context?.interviewId,
      requestType: 'fallback_transcription',
      provider,
      model,
      audioDurationMinutes: estimateAudioDurationMinutes(file.buffer.length),
      success: true,
    });
    logAiCallSuccess(traceCtx, { durationMs: Date.now() - startedAt });

    return {
      text: normalizeTechnicalTranscript(rawText, context),
      rawText,
      model,
      provider,
      promptApplied: Boolean(prompt),
    };
  } catch (error) {
    const errorCode = error instanceof Error ? error.name : 'TRANSCRIBE_ERROR';
    recordAiUsage({
      interviewId: context?.interviewId,
      requestType: 'fallback_transcription',
      provider,
      model,
      audioDurationMinutes: estimateAudioDurationMinutes(file.buffer.length),
      success: false,
      errorCode,
    });
    logAiCallFailure(traceCtx, errorCode, { durationMs: Date.now() - startedAt });
    throw error;
  }
};

/** Mock interview answer STT — Groq Whisper when AI_PROVIDER=groq. Sarvam STT is separate (image-description route). */
export const transcribeInterviewAnswer = transcribeAudio;

const firstTranscript = (value: unknown): string | undefined => {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(firstTranscript).find(Boolean);
  if (typeof value !== 'object') return undefined;

  const record = value as Record<string, unknown>;
  return (
    firstTranscript(record.transcript) ||
    firstTranscript(record.text) ||
    firstTranscript(record.transcription) ||
    firstTranscript(record.result) ||
    firstTranscript(record.data)
  );
};

export const transcribeAudioWithSarvam = async (file: Express.Multer.File) => {
  if (!env.SARVAM_API_KEY) {
    throw new Error('SARVAM_API_KEY is not configured.');
  }

  const formData = new FormData();
  const arrayBuffer = file.buffer.buffer.slice(
    file.buffer.byteOffset,
    file.buffer.byteOffset + file.buffer.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([arrayBuffer], { type: file.mimetype || 'audio/webm' });
  formData.append('file', blob, file.originalname || 'speech.webm');
  formData.append('language_code', 'en-IN');

  const response = await fetch(env.SARVAM_STT_ENDPOINT, {
    method: 'POST',
    headers: {
      'api-subscription-key': env.SARVAM_API_KEY,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Sarvam STT ${response.status}: ${errorText}`);
  }

  const payload = await response.json().catch(() => null);
  const text = firstTranscript(payload)?.trim() ?? '';
  return {
    text: normalizeTechnicalTranscript(text),
    rawText: text,
    model: 'sarvam:speech-to-text',
    raw: payload,
  };
};

const PERSONA_PERSONALITIES: Record<string, string> = {
  'us-american': 'You are Ryan Carter, a Senior Tech Lead. You are direct, value concrete examples, and use STAR method prompts. You expect candidates to be specific and results-driven.',
  'us-indian': 'You are Priya Sharma, an Engineering Manager. You are analytical, probe technical depth, and ask thorough follow-up questions. You value structured thinking.',
  'us-australian': 'You are Ananya Rao, a Product Director. You are conversational, test product thinking and communication clarity, and keep the interview relaxed but sharp. You value adaptability and big-picture thinking.',
  'ru-russian': 'You are Rahul Menon, a Principal Engineer. You are precise and methodical. You focus on algorithmic thinking, system design, and rigorous problem-solving. You expect well-structured, logically sound answers and will probe deeply into technical reasoning.',
};

const difficultyForPosition = (index: number, total: number): NonNullable<GeneratedQuestion['difficulty']> => {
  const ratio = total <= 1 ? 0 : index / (total - 1);
  if (ratio < 0.16) return 'easy';
  if (ratio < 0.32) return 'easy-medium';
  if (ratio < 0.5) return 'medium';
  if (ratio < 0.66) return 'medium-hard';
  if (ratio < 0.82) return 'scenario';
  if (ratio < 0.94) return 'problem-solving';
  return 'behavioral';
};

const plannedQuestionCountForDuration = (duration: number) => {
  if (duration <= 15) return 10;
  if (duration <= 20) return 13;
  if (duration <= 30) return 18;
  if (duration <= 45) return 26;
  return 34;
};

const fallbackInitialQuestions = (
  context: InterviewContext,
  questionCount: number,
  jdProfile: JobDescriptionProfile,
): GeneratedQuestion[] => {
  const modeGuidance = getInterviewModeGuidance(context.interviewMode);
  const topics = unique([
    ...modeGuidance.questionAngles,
    ...jdProfile.requiredSkills,
    ...jdProfile.toolsTechnologies,
    ...(context.resumeSkills ?? []),
    context.roleDomain,
  ]).filter(Boolean);
  const primaryTopic = topics[0] ?? context.roleDomain;
  const secondaryTopic = topics[1] ?? primaryTopic;
  const projectAnchor = context.resumeSummary ? 'a project from your resume' : 'one relevant project';
  const base: GeneratedQuestion[] = [
    {
      question: `To get started, walk me through your background and the experience most relevant to ${context.roleDomain}.`,
      expectedSignals: ['concise summary', 'role-relevant experience', 'clear motivation'],
      questionType: 'behavioural',
      resumeReference: 'candidate overview',
      difficulty: 'easy',
      topic: context.roleDomain,
      followUpIntent: 'bridge-topic',
    },
    {
      question: `For a ${modeGuidance.label} interview, the role emphasizes ${primaryTopic}. Can you explain how you have used it in ${projectAnchor}?`,
      expectedSignals: ['specific project context', 'hands-on usage', 'mode-relevant technical terminology'],
      questionType: 'technical',
      resumeReference: `JD skill: ${primaryTopic}`,
      difficulty: 'easy-medium',
      topic: primaryTopic,
      followUpIntent: 'deepen',
    },
    {
      question: `How would you compare ${primaryTopic} with ${secondaryTopic} when making a ${modeGuidance.label} design decision?`,
      expectedSignals: ['trade-off reasoning', 'practical constraints', 'production awareness'],
      questionType: 'technical',
      resumeReference: `JD skill graph: ${primaryTopic} and ${secondaryTopic}`,
      difficulty: 'medium',
      topic: primaryTopic,
      followUpIntent: 'challenge',
    },
    {
      question: `Imagine work involving ${primaryTopic} starts failing in a real ${modeGuidance.label} scenario. How would you investigate and communicate the issue?`,
      expectedSignals: ['debugging steps', 'observability', 'stakeholder communication'],
      questionType: 'situational',
      resumeReference: `JD responsibility: ${jdProfile.responsibilities[0] ?? 'production ownership'}`,
      difficulty: 'scenario',
      topic: primaryTopic,
      followUpIntent: 'challenge',
    },
    {
      question: 'Tell me about a time you received difficult feedback or faced a conflict on a technical decision. What did you do, and what was the result?',
      expectedSignals: ['STAR structure', 'self-awareness', 'measurable outcome'],
      questionType: 'behavioural',
      resumeReference: 'behavioral assessment',
      difficulty: 'behavioral',
      topic: 'Communication',
      followUpIntent: 'clarify',
    },
  ];

  return Array.from({ length: questionCount }, (_, index) => ({
    ...(base[index % base.length]),
    difficulty: difficultyForPosition(index, questionCount),
  }));
};

const buildPromptBuilderInput = (
  context: InterviewContext,
  jdProfile?: JobDescriptionProfile,
  companyQuestionBank?: CompanyQuestionEntry[] | null,
  companyBankMode: CompanyBankMode = 'none',
) => {
  const modeGuidance = getInterviewModeGuidance(context.interviewMode);
  const candidateResume =
    context.resumeProfile ??
    ({
      summary: context.resumeSummary,
      skills: context.resumeSkills,
      rawText: context.resumeText,
    } as const);

  return {
    candidateResume,
    jobDescription: context.jobDescription,
    jdProfile,
    company: context.targetCompany,
    role: context.roleDomain,
    experienceLevel: mapExperienceLevel(context.roleLevel),
    companyQuestionBank: companyQuestionBank ?? null,
    companyBankMode,
    interviewType: mapInterviewPromptType(context.interviewType ?? context.interviewStyle),
    personaId: context.personaId,
    personaPersonality: context.personaPersonality,
    interviewModeLabel: modeGuidance.label,
    interviewModeTemplate: modeGuidance.questionTemplate,
    complexity: context.complexity,
    roleLevel: context.roleLevel,
    previouslyAskedQuestions: context.previouslyAskedQuestions,
  };
};

const resolveCompanyQuestionBank = async (context: InterviewContext) => {
  if (context.companyQuestionBank?.length) {
    return {
      questions: context.companyQuestionBank,
      mode: (context.companyBankMode ?? 'role_based') as CompanyBankMode,
    };
  }

  if (context.companyBankMode === 'role_based' || context.companyBankMode === 'none') {
    return {
      questions: null as CompanyQuestionEntry[] | null,
      mode: context.companyBankMode ?? (context.targetCompany ? ('role_based' as const) : ('none' as const)),
    };
  }

  const experienceLevel = mapExperienceLevel(context.roleLevel);
  const companySlug = slugifyCompanyName(context.targetCompany || 'generic');
  const lookupSeed = `${companySlug}|${context.roleDomain}|${experienceLevel}|8`;
  const contentHash = normalizeContentHash(lookupSeed);
  const bankVersion = contentHash.slice(0, 16);
  const cacheKey = buildCompanyQuestionBankCacheKey({
    companySlug,
    role: context.roleDomain,
    bankVersion,
  });

  try {
    const cached = await getAiContextCache<{ questions: CompanyQuestionEntry[]; mode: CompanyBankMode }>(cacheKey);
    if (cached?.questions?.length) return cached;
  } catch {
    // Continue without cache.
  }

  const bankResult = await getCompanyQuestions(
    context.targetCompany,
    context.roleDomain,
    experienceLevel,
    8,
  );

  if (!bankResult) {
    return {
      questions: null as CompanyQuestionEntry[] | null,
      mode: context.targetCompany ? ('role_based' as const) : ('none' as const),
    };
  }

  const mode: CompanyBankMode =
    bankResult.mode === 'verified'
      ? 'verified'
      : bankResult.mode === 'generic'
      ? 'role_based'
      : bankResult.mode;

  const resolved = { questions: bankResult.questions, mode };
  if (resolved.questions?.length) {
    try {
      await setAiContextCache({
        cacheKey,
        kind: 'company_question_bank',
        contentHash,
        payload: resolved,
        companySlug,
        role: context.roleDomain,
        bankVersion,
      });
    } catch {
      // Cache is best-effort.
    }
  }

  return resolved;
};

export const generateInterviewQuestions = async (context: InterviewContext) => {
  const questionCount = plannedQuestionCountForDuration(context.duration);
  const sessionSeed = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const jdProfile = await getCachedJobDescriptionProfile(context.jobDescription, {
    roleLevel: context.roleLevel,
    roleDomain: context.roleDomain,
    resumeSkills: context.resumeSkills,
  });
  const { questions: companyQuestionBank, mode: companyBankMode } = await resolveCompanyQuestionBank(context);
  const systemPrompt = buildInterviewSystemPrompt(
    buildPromptBuilderInput(context, jdProfile, companyQuestionBank, companyBankMode),
  );
  const userPrompt = buildInitialQuestionsUserPrompt(
    questionCount,
    sessionSeed,
    context.previouslyAskedQuestions ?? [],
  );

  const result = await generateJson<{ questions: GeneratedQuestion[] }>(
    userPrompt,
    { questions: fallbackInitialQuestions(context, questionCount, jdProfile) },
    {
      systemPrompt,
      temperature: 0.7,
      requestType: 'interview_questions_initial',
      interviewId: context.interviewId,
    },
  );

  return {
    questions: result.questions
      .map((question) => {
        const sanitized = sanitizeDateAnchoredQuestionText({
          question: question.question,
          topic: question.topic,
          resumeReference: question.resumeReference,
        });
        return sanitized ? { ...question, question: sanitized } : null;
      })
      .filter((question): question is GeneratedQuestion => Boolean(question)),
  };
};

type AnswerEvaluationContext = {
  interviewId?: string;
  expectedSignals?: string[];
  roleDomain?: string;
  roleLevel?: string;
  targetCompany?: string;
  difficulty?: string;
  questionType?: string;
  topic?: string;
  resumeProjects?: string[];
  resumeSkills?: string[];
  resumeText?: string;
};

const isCareerMotivationQuestion = (question: string) =>
  /\b(why did you decide|why are you interested|pursue a .{0,40}role|how do those interests connect|why .+ role)\b/i.test(
    question,
  );

const isRuntimeConcurrencyQuestion = (question: string) =>
  /\b(event loop|single thread|handles multiple client requests|process and a thread|multithreading)\b/i.test(
    question,
  );

const projectFromContext = (question: string, context?: AnswerEvaluationContext) => {
  const projects = context?.resumeProjects ?? [];
  const fromQuestion = projects.find((project) =>
    question.toLowerCase().includes(String(project).toLowerCase().slice(0, Math.min(16, project.length))),
  );
  // Coding / career / Node questions must not force an unrelated project name.
  if (!fromQuestion && (isCodingStyleQuestion(question) || isCareerMotivationQuestion(question) || isRuntimeConcurrencyQuestion(question))) {
    return undefined;
  }
  return fromQuestion || projects[0] || context?.topic || 'your project';
};

const allowedStackLine = (context?: AnswerEvaluationContext) => {
  const skills = (context?.resumeSkills ?? []).slice(0, 8);
  return skills.length
    ? `Only mention technologies from this stack when relevant: ${skills.join(', ')}.`
    : 'Only mention technologies the candidate actually claimed; do not invent libraries.';
};

const buildIdealAnswerFallback = (question: string, context?: AnswerEvaluationContext) => {
  const project = projectFromContext(question, context);
  const signals = (context?.expectedSignals?.length
    ? context.expectedSignals
    : ['clear approach', 'concrete steps', 'how you validated it']
  ).map((signal) => humanizeInterviewFocus(signal)).filter(Boolean);
  const signalList = signals.slice(0, 4).join(', ');

  if (isCodingStyleQuestion(question)) {
    return canonicalize(
      `A strong answer explains the approach step-by-step, covers ${signalList || 'edge cases and complexity'}, `
      + `and includes a short code sketch or clear pseudocode. `
      + `${allowedStackLine(context)} `
      + `Do not force a resume project name unless the question asks about a project. Do not invent libraries.`,
    );
  }

  if (isRuntimeConcurrencyQuestion(question)) {
    return canonicalize(
      `A strong answer explains the single-threaded event loop, non-blocking I/O, the callback/promise queues, `
      + `and when blocking work uses a thread pool. Walk through one request lifecycle and name ${signalList || 'concurrency trade-offs'}. `
      + `Do not invent frameworks or force an unrelated project story.`,
    );
  }

  if (isCareerMotivationQuestion(question)) {
    return canonicalize(
      `A strong answer connects your real resume themes (for example full-stack and AI/ML) to why this role fits, `
      + `with one concrete project as evidence of building and shipping software. `
      + `${allowedStackLine(context)} Do not invent employers, tools, or project outcomes.`,
    );
  }

  return canonicalize(
    `A strong answer would${project ? ` name "${project}" exactly and` : ''} walk through ${signalList}. `
    + `Explain the problem, what you built step-by-step, one trade-off or metric, and how you checked it worked. `
    + `${allowedStackLine(context)} `
    + `Do not invent tools, caching layers, auth schemes, or libraries that were not in the resume or answer.`,
  );
};

/** Candidate-facing rewrite: different from the ideal model answer. */
const buildSuggestedImprovedAnswerFallback = (
  question: string,
  answer: string,
  context?: AnswerEvaluationContext,
  missingConcepts: string[] = [],
) => {
  const project = projectFromContext(question, context);
  const gaps = (missingConcepts.length
    ? missingConcepts
    : context?.expectedSignals?.length
      ? context.expectedSignals
      : ['clearer structure', 'one concrete validation step']
  )
    .map((item) => canonicalize(item))
    .filter((item) => item && !/no answer|no clear gap|voltage|named entity|part-of-speech/i.test(item))
    .slice(0, 3);

  const speechHints = detectLikelySpeechArtifacts(answer, `${question} ${context?.topic ?? ''}`);
  const trimmed = canonicalize(answer)
    .replace(/^\(+skipped?\)+$/i, '')
    .replace(/^\(+no answer\)+$/i, '')
    .replace(/^Submitted code[\s\S]*/i, '')
    .trim();
  const hasUsableAnswer = trimmed.length >= 24 && !/^\(?(skipped?|n\/a|nothing|none)\)?$/i.test(trimmed);
  const speechNote = speechHints.length
    ? ` Possible transcription issue: treat "${speechHints[0].heard}" as likely meaning ${speechHints[0].likelyMeant}.`
    : '';

  if (isCodingStyleQuestion(question)) {
    if (hasUsableAnswer) {
      return canonicalize(
        `Improved coding answer: keep your intent (${trimmed.slice(0, 140)}${trimmed.length > 140 ? '…' : ''}), `
        + `but state the algorithm clearly, list edge cases, and give time/space complexity. `
        + `Add ${gaps.join(', ') || 'a short correct code sketch'}.${speechNote}`,
      );
    }
    return canonicalize(
      `Practice this coding question aloud: state the approach, walk through one example, list edge cases, `
      + `and quote time/space complexity. Focus on ${gaps.join(', ') || 'correctness and clarity'}. `
      + `Do not substitute an unrelated project story.`,
    );
  }

  if (isRuntimeConcurrencyQuestion(question) || isCareerMotivationQuestion(question)) {
    if (hasUsableAnswer) {
      return canonicalize(
        `Improved rewrite of your answer: keep your points (${trimmed.slice(0, 140)}${trimmed.length > 140 ? '…' : ''}), `
        + `but organize them as direct answer → evidence → trade-off. Add ${gaps.join(', ') || 'one concrete example'}.${speechNote}`,
      );
    }
    return canonicalize(
      `Practice a 60-second answer to this exact question. Cover ${gaps.join(', ') || 'the core concept with one example'}. `
      + `Do not invent tools or force an unrelated project name.`,
    );
  }

  if (hasUsableAnswer) {
    return canonicalize(
      `Improved rewrite of what you said${project ? ` about ${project}` : ''}: keep your real story `
      + `(${trimmed.slice(0, 160)}${trimmed.length > 160 ? '…' : ''}), `
      + `but speak it in order — problem → steps → validation. `
      + `Add ${gaps.join(', ') || 'one metric or demo check'}. `
      + `Do not invent JWT, caching, or libraries you did not use.${speechNote}`,
    );
  }

  return canonicalize(
    `Practice aloud${project ? ` for "${project}"` : ''}: in ~60 seconds cover what problem it solved, 3 implementation steps using your real stack, `
    + `and how you validated it. Focus on ${gaps.join(', ') || 'clarity and evidence'}. `
    + `Do not invent technologies you have not used.`,
  );
};

const tokenizeConcepts = (value: string) =>
  Array.from(
    new Set(
      value
        .toLowerCase()
        .replace(/[^a-z0-9+#.\s-]/g, ' ')
        .split(/\s+/)
        .map((word) => word.trim())
        .filter((word) => word.length > 3 && !/^(that|this|with|from|they|have|were|when|what|would|should|could|about|because|using|used|into|their|there|then|than|also)$/i.test(word)),
    ),
  );

/** Fuzzy match: "chunking" matches "chunked", "embedding pipeline" matches "embedded". */
const signalMatchesAnswer = (signal: string, answerTokens: Set<string>, answerLower: string) => {
  const directTokens = tokenizeConcepts(signal);
  if (directTokens.some((token) => answerTokens.has(token))) return true;

  const significant = signal
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/g, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 4);

  return significant.some((word) => {
    if (answerLower.includes(word)) return true;
    const stem = word.slice(0, Math.max(4, word.length - 2));
    return stem.length >= 4 && answerLower.includes(stem);
  });
};

const EVALUATION_SCORE_FIELDS = [
  'communicationScore',
  'technicalScore',
  'behavioralScore',
  'confidenceScore',
  'completenessScore',
  'depthScore',
  'terminologyScore',
  'grammarScore',
  'vocabularyScore',
  'domainScore',
] as const;

const collectNumericScores = (evaluation: Partial<AnswerEvaluation>) =>
  [evaluation.score, ...EVALUATION_SCORE_FIELDS.map((field) => evaluation[field])]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

const looksLikeTenPointScale = (values: number[]) =>
  values.length > 0 && values.every((value) => value >= 0 && value <= 10);

const weightedOverallFromSubScores = (evaluation: Partial<AnswerEvaluation>) => {
  const weights: Array<[number | undefined, number]> = [
    [evaluation.technicalScore, 0.28],
    [evaluation.completenessScore, 0.22],
    [evaluation.communicationScore, 0.18],
    [evaluation.depthScore, 0.14],
    [evaluation.terminologyScore, 0.08],
    [evaluation.confidenceScore, 0.05],
    [evaluation.domainScore, 0.05],
  ];
  let total = 0;
  let weightSum = 0;
  weights.forEach(([value, weight]) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    total += value * weight;
    weightSum += weight;
  });
  return weightSum > 0 ? Math.round(total / weightSum) : undefined;
};

const normalizeEvaluationScores = (
  evaluation: AnswerEvaluation,
  options: { isCoding?: boolean } = {},
): AnswerEvaluation => {
  const next = { ...evaluation };
  const rawValues = collectNumericScores(next);

  if (looksLikeTenPointScale(rawValues)) {
    next.score = clampScore100((next.score ?? 0) * 10, 0);
    EVALUATION_SCORE_FIELDS.forEach((field) => {
      const value = next[field];
      if (typeof value === 'number') next[field] = clampScore100(value * 10, 0);
    });
  } else {
    next.score = clampScore100(next.score, 0);
    EVALUATION_SCORE_FIELDS.forEach((field) => {
      const value = next[field];
      if (typeof value === 'number') next[field] = clampScore100(value, 0);
    });
  }

  const recomputed = weightedOverallFromSubScores(next);
  if (
    !options.isCoding
    && typeof recomputed === 'number'
    && (next.score ?? 0) <= 35
    && recomputed >= 55
    && recomputed - (next.score ?? 0) >= 25
  ) {
    next.score = recomputed;
  }

  if (options.isCoding && typeof next.score === 'number') {
    const cap = next.score;
    EVALUATION_SCORE_FIELDS.forEach((field) => {
      const value = next[field];
      if (typeof value === 'number' && value > cap + 10) {
        next[field] = cap;
      }
    });
    next.technicalScore = clampScore100(next.technicalScore ?? cap, cap);
  }

  return next;
};

const BANNED_GENERIC_FEEDBACK_PHRASES = [
  'good communication skills',
  'could be more confident',
  'needs more detail',
  'needs more depth',
  'good attempt',
  'well done',
  'nice answer',
  'nice job',
  'the answer attempted the question directly',
  'gave enough detail for evaluation',
  'some relevant content was provided',
  'the answer is understandable',
  'could be better',
  'shows effort',
  'good structure',
  'clear communication',
  'needs improvement',
  'an approach was described alongside the code',
  'little explanation accompanied the code',
  'insufficient evidence of a correct solution',
  'some algorithmic structure is present',
  'no clear algorithm was implemented',
];

const answerExcerpt = (answer: string, max = 90) => {
  const sentence = String(answer || '')
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .find((part) => part.length > 20);
  const base = sentence || String(answer || '').trim();
  if (!base) return 'your response';
  return base.length > max ? `${base.slice(0, max - 1).trim()}…` : base;
};

const feedbackGroundsInAnswer = (feedbackText: string, answer: string, code = '') => {
  const text = String(feedbackText || '');
  if (!text) return false;
  if (/`[^`]{3,}`|"[^"]{4,}"|'[^']{4,}'/i.test(text)) return true;

  const haystack = `${answer}\n${code}`.toLowerCase();
  const words = haystack.split(/\s+/).filter((word) => word.length > 3);
  for (let index = 0; index <= words.length - 3; index += 1) {
    const phrase = words.slice(index, index + 3).join(' ');
    if (text.toLowerCase().includes(phrase)) return true;
  }
  return false;
};

const isGenericFeedbackLine = (line: string, answer: string, code = '') => {
  const normalized = String(line || '').trim().toLowerCase();
  if (!normalized) return true;
  if (feedbackGroundsInAnswer(line, answer, code)) return false;
  return BANNED_GENERIC_FEEDBACK_PHRASES.some(
    (phrase) => normalized === phrase || normalized.startsWith(`${phrase}.`) || normalized.includes(phrase),
  );
};

const buildAnswerGroundedFeedbackInstructions = (options: { isCoding?: boolean } = {}) => {
  const banned = BANNED_GENERIC_FEEDBACK_PHRASES.slice(0, 12).map((phrase) => `"${phrase}"`).join(', ');
  const reportBanned = formatBannedFeedbackPhrasesForPrompt();
  const codeRules = options.isCoding
    ? `
CODING FEEDBACK (mandatory):
- Quote or name ACTUAL code: function names, loops, conditionals, return values, data structures — include line-level detail when possible (e.g. "the \`return [0, 1]\` on line 2 ignores \`nums\`").
- Example strength: "Using \`seen = {}\` for O(1) lookup shows you understood the hash-map approach this two-sum question expects."
- Example improvement: "Returning \`[0, 1]\` hard-coded ignores \`nums\` and \`target\` — iterate once and store complements in a dict instead."
- NEVER say "could be more efficient" without naming the exact construct to change.
- Voice: honest mock-interview coach talking to "you" — not a formal panel report. BANNED stock phrases: ${reportBanned}.`
    : '';

  return `
FEEDBACK SPECIFICITY RULES (mandatory — boilerplate that could fit any answer is invalid):
- You MUST use the FULL question and FULL candidate answer provided above. Do not invent content they did not say.
- "feedback" (2-4 sentences): quote or paraphrase a specific part of their answer; say what was correct/missing for THIS question; tie to the score.
- dynamicFeedback.strengths: EXACTLY 2-3 items, each 1-2 sentences. Each MUST quote 3-10 words from their answer (in "quotes") OR name a specific technology/step they mentioned, AND explain why it helped for this question.
- dynamicFeedback.areasToImprove: EXACTLY 2-3 items. Each MUST name a gap for THIS question and give a concrete next-time fix (e.g. "When you said 'it went well', add a metric like 'reduced load time by 40%'").
- dynamicFeedback.communication: 1-2 sentences on structure/clarity of THIS answer (opening, flow, signposting) — cite how they organized "${options.isCoding ? 'their explanation' : 'their response'}".
- dynamicFeedback.confidence: 1-2 sentences on hedging vs decisive wording IN THIS answer (quote tentative phrases if present).
- dynamicFeedback.practicalUnderstanding / interviewReadiness: tie to evidence in THIS answer, not generic readiness labels.
- dynamicFeedback.nextLearningSuggestions: 2-3 specific practice actions for gaps in THIS answer.
- Align narrative with scores: technicalScore (accuracy/relevance), completenessScore (all parts answered), communicationScore (clarity), confidenceScore (hedging), depthScore (beyond definitions), terminologyScore (precise terms used/missed).
- The student must understand WHY they received their score from the feedback alone.
- BANNED unless followed immediately by a quote/example from THIS answer: ${banned}.
- Tone: write like an honest mock-interview coach talking to the candidate — use "you", vary sentence openings, no corporate HR report language. BANNED stock phrases: ${reportBanned}.
${codeRules}`;
};

type FallbackFeedbackInput = {
  question: string;
  answer: string;
  signalCoverage: string[];
  missingSignals: string[];
  score: number;
  completeness: number;
  communication: number;
  depth: number;
  terminology: number;
  isCoding?: boolean;
  code?: string;
  spoken?: string;
  looksConstantReturn?: boolean;
  hasAlgorithmShape?: boolean;
};

const buildFallbackDynamicFeedback = (input: FallbackFeedbackInput): NonNullable<AnswerEvaluation['dynamicFeedback']> => {
  const {
    question,
    answer,
    signalCoverage,
    missingSignals,
    score,
    completeness,
    communication,
    depth,
    terminology,
    isCoding = false,
    code = '',
    spoken = '',
    looksConstantReturn = false,
    hasAlgorithmShape = false,
  } = input;

  if (isCoding) {
    const codeSnippet = (code || answer).split('\n').find((line) => line.trim().length > 4)?.trim() || code.slice(0, 80);
    const strengths: string[] = [];
    if (hasAlgorithmShape && codeSnippet) {
      strengths.push(
        `Your code includes iterative/lookup structure (\`${codeSnippet.slice(0, 70)}\`) — that shows algorithmic intent for "${question.slice(0, 80)}".`,
      );
    }
    if (spoken.trim().length > 40) {
      strengths.push(
        `You explained your approach when you said "${answerExcerpt(spoken, 75)}" — pairing code with rationale helps interviewers follow your thinking.`,
      );
    }
    if (strengths.length < 2 && codeSnippet) {
      strengths.push(
        `You submitted a concrete implementation attempt (\`${codeSnippet.slice(0, 60)}\`) rather than leaving the editor blank — build on this with correctness and edge-case checks.`,
      );
    }

    const areasToImprove: string[] = [];
    if (looksConstantReturn) {
      areasToImprove.push(
        `Returning a hard-coded value (e.g. \`${code.match(/return\s+[^;]+/i)?.[0] || 'return [0, 1]'}\`) does not use the inputs — iterate over the data and compute the result the question asks for.`,
      );
    }
    missingSignals.slice(0, 2).forEach((gap) => {
      areasToImprove.push(
        `This problem expects "${gap}" — add it explicitly in code or your spoken walkthrough (currently missing from \`${codeSnippet.slice(0, 50)}\`).`,
      );
    });
    if (areasToImprove.length < 2) {
      areasToImprove.push(
        'Walk through one example input by hand in comments, then add a guard for empty input or no-solution cases before submitting.',
      );
    }

    return {
      strengths: strengths.slice(0, 3),
      missingConcepts: missingSignals,
      technicalMistakes: looksConstantReturn ? ['Hard-coded return ignores inputs.'] : [],
      communication: spoken.trim().length > 40
        ? `Communication (${communication}/100): your spoken note "${answerExcerpt(spoken, 65)}" clarifies intent — also state time/space complexity aloud.`
        : `Communication (${communication}/100): add a 20-second verbal walkthrough of \`${codeSnippet.slice(0, 45)}\` (approach, complexity, edge cases).`,
      confidence: `Technical confidence (${score}/100): ${looksConstantReturn ? 'the hard-coded return suggests uncertainty — implement the full logic step by step.' : 'explain why your loop/map choice fits this problem before moving on.'}`,
      areasToImprove: areasToImprove.slice(0, 3),
      nextLearningSuggestions: [
        `Re-solve "${question.slice(0, 90)}" on paper, then code it with tests for one normal and one edge case.`,
        missingSignals[0]
          ? `Drill "${missingSignals[0]}" with a timed 15-minute practice problem.`
          : 'Practice stating O(n) time and O(1)/O(n) space out loud after each submission.',
      ].slice(0, 3),
      practicalUnderstanding: hasAlgorithmShape
        ? `You used real control flow in \`${codeSnippet.slice(0, 55)}\` — next, verify it against the prompt's examples.`
        : `Move from placeholder code to a loop/recursion that reads the input variables named in the question.`,
      interviewReadiness: score >= 50
        ? 'Partial coding attempt — fix correctness and complexity explanation before a live whiteboard round.'
        : 'Not interview-ready on this problem yet — rehearse implement → test → analyze complexity.',
    };
  }

  const excerpt = answerExcerpt(answer);
  const strengths: string[] = [];
  if (signalCoverage[0]) {
    strengths.push(
      `You addressed "${signalCoverage[0]}" when you said "${excerpt}" — that directly supports what this question asked about ${signalCoverage[0]}.`,
    );
  }
  const metricMatch = answer.match(/\b\d+(\.\d+)?\s*(%|ms|s|users?|requests?|x|times)[^.!?]*/i);
  if (metricMatch) {
    strengths.push(
      `Quoting "${metricMatch[0].trim()}" gives measurable impact — interviewers can trust outcomes, not just activities.`,
    );
  }
  if (/\b(built|implemented|designed|led|measured|deployed)\b/i.test(answer) && strengths.length < 2) {
    strengths.push(
      `Your action-focused wording in "${excerpt}" shows ownership — keep naming YOUR role and the validation step you ran.`,
    );
  }
  if (strengths.length < 2 && score >= 50) {
    strengths.push(
      `You connected to the question ("${question.slice(0, 85)}${question.length > 85 ? '…' : ''}") via "${excerpt.slice(0, 70)}" — add one more explicit trade-off or metric to reach strong band.`,
    );
  }

  const areasToImprove = missingSignals.slice(0, 2).map(
    (gap) => `The question expected "${gap}" but your answer centered on "${excerpt.slice(0, 55)}" without covering it — next time add one sentence on ${gap} with a project example.`,
  );
  if (areasToImprove.length < 2 && score < 75) {
    areasToImprove.push(
      `Where you said "${excerpt.slice(0, 60)}", replace vague outcomes with a number (latency %, users, error rate) to match depth expectations for this ${question.includes('?') ? 'question' : 'topic'}.`,
    );
  }
  if (areasToImprove.length < 2) {
    areasToImprove.push(
      `Open with a one-line thesis answering "${question.slice(0, 70)}", then support with "${excerpt.slice(0, 40)}" plus one trade-off you considered.`,
    );
  }

  const hedging = answer.match(/\b(maybe|i think|not sure|probably)[^.!?]*/i)?.[0];

  return {
    strengths: strengths.slice(0, 3),
    missingConcepts: missingSignals,
    technicalMistakes: [],
    communication: communication < 55
      ? `Communication (${communication}/100): "${excerpt}" needs a clearer arc — state the direct answer first, then 2 supporting points with signposts ("First…, then…").`
      : `Communication (${communication}/100): you organized around "${excerpt.slice(0, 65)}" — keep that structure and tighten transitions between ideas.`,
    confidence: hedging
      ? `Confidence (${Math.max(0, score - 15)}/100): hedging with "${hedging.trim()}" weakens impact — state assumptions, then answer decisively.`
      : `Confidence: you presented "${excerpt.slice(0, 60)}" without excessive hedging — maintain that tone under follow-ups.`,
    areasToImprove: areasToImprove.slice(0, 3),
    nextLearningSuggestions: missingSignals.slice(0, 2).map(
      (gap) => `Practice a 60-second answer to "${question.slice(0, 90)}" that explicitly covers: ${gap}.`,
    ).concat(
      score < 70 ? [`Re-record yourself explaining "${excerpt.slice(0, 50)}" with one metric and one trade-off.`] : [],
    ).slice(0, 3),
    practicalUnderstanding: /\b(project|built|implemented|deployed|tested|used)\b/i.test(answer)
      ? `Practical depth (${depth}/100): "${excerpt}" references real work — add how you validated it (test, metric, demo).`
      : `Practical depth (${depth}/100): move from "${excerpt.slice(0, 55)}" to how you implemented and verified it in a real project.`,
    interviewReadiness: score >= 70
      ? `Ready for a follow-up on ${signalCoverage[0] || 'this topic'} — "${excerpt.slice(0, 45)}" gives the interviewer something concrete to probe.`
      : `Not yet interview-ready here (completeness ${completeness}/100, terminology ${terminology}/100) — rehearse ${missingSignals.slice(0, 2).join(' and ') || 'the expected signals'}.`,
  };
};

const refineEvaluationFeedback = (
  evaluation: AnswerEvaluation,
  question: string,
  answer: string,
  options: {
    isCoding?: boolean;
    code?: string;
    fallbackInput?: FallbackFeedbackInput;
    scoreAlignedFeedback?: string;
    scoreAlignedStrengths?: string[];
  } = {},
): AnswerEvaluation => {
  const next: AnswerEvaluation = {
    ...evaluation,
    dynamicFeedback: evaluation.dynamicFeedback
      ? { ...evaluation.dynamicFeedback }
      : undefined,
  };
  const code = options.code || '';
  const fallback = options.fallbackInput
    ? buildFallbackDynamicFeedback(options.fallbackInput)
    : buildFallbackDynamicFeedback({
      question,
      answer,
      signalCoverage: evaluation.conceptsCovered || evaluation.detectedSignals || [],
      missingSignals: evaluation.missingConcepts || evaluation.missingSignals || [],
      score: evaluation.score ?? 0,
      completeness: evaluation.completenessScore ?? 0,
      communication: evaluation.communicationScore ?? 0,
      depth: evaluation.depthScore ?? 0,
      terminology: evaluation.terminologyScore ?? 0,
      isCoding: options.isCoding,
      code,
    });

  const pickLines = (
    current: string[] | undefined,
    fallbackLines: string[],
    min = 2,
  ) => {
    const minLines = options.isCoding && (evaluation.score ?? 0) < 40 ? Math.min(min, 1) : min;
    const grounded = (current || []).filter((line) => !isGenericFeedbackLine(line, answer, code));
    const merged = [...grounded];
    fallbackLines.forEach((line) => {
      if (merged.length >= 3) return;
      if (!merged.some((existing) => existing.toLowerCase() === line.toLowerCase())) merged.push(line);
    });
    return merged.slice(0, 3).length >= minLines ? merged.slice(0, 3) : fallbackLines.slice(0, minLines > 0 ? 3 : 0);
  };

  next.dynamicFeedback = {
    ...fallback,
    ...next.dynamicFeedback,
    strengths: pickLines(next.dynamicFeedback?.strengths, fallback.strengths),
    areasToImprove: pickLines(next.dynamicFeedback?.areasToImprove, fallback.areasToImprove),
    nextLearningSuggestions: pickLines(next.dynamicFeedback?.nextLearningSuggestions, fallback.nextLearningSuggestions, 1),
    missingConcepts: next.dynamicFeedback?.missingConcepts?.length
      ? next.dynamicFeedback.missingConcepts
      : fallback.missingConcepts,
    technicalMistakes: next.dynamicFeedback?.technicalMistakes?.length
      ? next.dynamicFeedback.technicalMistakes
      : fallback.technicalMistakes,
    communication: isGenericFeedbackLine(next.dynamicFeedback?.communication || '', answer, code)
      ? fallback.communication
      : (next.dynamicFeedback?.communication || fallback.communication),
    confidence: isGenericFeedbackLine(next.dynamicFeedback?.confidence || '', answer, code)
      ? fallback.confidence
      : (next.dynamicFeedback?.confidence || fallback.confidence),
    practicalUnderstanding: isGenericFeedbackLine(next.dynamicFeedback?.practicalUnderstanding || '', answer, code)
      ? fallback.practicalUnderstanding
      : (next.dynamicFeedback?.practicalUnderstanding || fallback.practicalUnderstanding),
    interviewReadiness: isGenericFeedbackLine(next.dynamicFeedback?.interviewReadiness || '', answer, code)
      ? fallback.interviewReadiness
      : (next.dynamicFeedback?.interviewReadiness || fallback.interviewReadiness),
  };

  if (!feedbackGroundsInAnswer(next.feedback || '', answer, code)) {
    const excerpt = answerExcerpt(answer, 70);
    const scoreNote = typeof next.score === 'number' ? ` (score ${next.score}/100)` : '';
    next.feedback = [
      next.feedback,
      `On "${excerpt}", you ${next.score >= 70 ? 'covered key parts of' : 'partially addressed'} "${question.slice(0, 100)}".`,
      `Focus next on: ${(next.dynamicFeedback?.areasToImprove?.[0] || fallback.areasToImprove[0])}`,
    ].filter(Boolean).join(' ').trim();
  }

  return alignEvaluationFeedbackToScore(next, {
    isCoding: options.isCoding,
    code,
    answer,
    scoreAlignedFeedback: options.scoreAlignedFeedback,
    scoreAlignedStrengths: options.scoreAlignedStrengths ?? fallback.strengths,
  });
};

const fallbackComparisonEvaluation = (
  question: string,
  answer: string,
  context?: AnswerEvaluationContext,
): AnswerEvaluation => {
  const turnType = classifyAnswerTurn(answer);
  const idealAnswerBase = buildIdealAnswerFallback(question, context);
  const idealAnswer =
    turnType === 'clarification_request'
      ? buildClarificationIdealAnswer(question, idealAnswerBase)
      : idealAnswerBase;
  const expectedSignals = context?.expectedSignals ?? [];
  const answerTokens = new Set(tokenizeConcepts(answer));
  const answerLower = answer.toLowerCase();
  const signalCoverage = expectedSignals.filter((signal) =>
    signalMatchesAnswer(signal, answerTokens, answerLower),
  );
  const missingSignals = expectedSignals.filter((signal) => !signalCoverage.includes(signal));
  const wordCount = answer.trim().split(/\s+/).filter(Boolean).length;
  const signalCompleteness = expectedSignals.length
    ? Math.round((signalCoverage.length / expectedSignals.length) * 100)
    : 0;
  const lengthCompleteness = Math.min(100, Math.round(wordCount * 2.2));
  const structureBonus =
    /\b(because|result|implemented|built|designed|measured|for example|trade[-\s]?off|validated)\b/i.test(answer)
      ? 12
      : 0;
  const hasMetric = /\b\d+(\.\d+)?\s*(%|ms|s|users?|requests?|x|times)\b/i.test(answer);
  const metricBonus = hasMetric ? 8 : 0;
  const completeness = expectedSignals.length
    ? Math.min(100, Math.round(Math.max(signalCompleteness, lengthCompleteness * 0.72) + structureBonus + metricBonus))
    : Math.min(100, wordCount * 3);
  const depth = Math.min(
    100,
    Math.round(wordCount * 2 + (/\b(example|trade[-\s]?off|because|tested|deployed|optimized|measured|edge case)\b/i.test(answer) ? 20 : 0)),
  );
  const communication = Math.min(100, Math.round(wordCount * 2.2));
  const terminology = Math.min(
    100,
    Math.round((answerTokens.size / Math.max(1, tokenizeConcepts(idealAnswer).length)) * 100),
  );
  const score = Math.round((completeness * 0.35) + (depth * 0.25) + (communication * 0.2) + (terminology * 0.2));
  const missingConcepts = missingSignals.length ? missingSignals : ['No clear gap was identified from the expected signals, but more specificity would improve the answer.'];

  const whatWorked = signalCoverage.length
    ? `When you discussed ${signalCoverage.slice(0, 2).join(' and ')}, you addressed part of "${question.slice(0, 90)}".`
    : `Your response "${answerExcerpt(answer, 70)}" attempted the question but did not clearly hit the expected signals.`;
  const whatWasMissing = `Still missing for this question: ${missingConcepts.slice(0, 2).join(', ')}.`;
  const improvementDirection = `Next time, after "${answerExcerpt(answer, 50)}", add ${missingConcepts[0]} with a metric or validation step.`;

  const dynamicFeedback = buildFallbackDynamicFeedback({
    question,
    answer,
    signalCoverage,
    missingSignals,
    score,
    completeness,
    communication,
    depth,
    terminology,
  });

  return {
    score,
    feedback: `${whatWorked} ${whatWasMissing} ${improvementDirection}`.trim(),
    idealAnswer,
    samplePerfectAnswer: buildSuggestedImprovedAnswerFallback(question, answer, context, missingConcepts),
    conceptsCovered: signalCoverage,
    missingConcepts,
    incorrectStatements: [],
    wrongTerminology: [],
    technicalMistakes: [],
    dynamicFeedback,
    communicationScore: communication,
    technicalScore: context?.questionType === 'behavioural' ? Math.round(score * 0.5) : score,
    behavioralScore: context?.questionType === 'technical' ? Math.round(score * 0.4) : score,
    confidenceScore: /\b(maybe|i think|not sure|probably)\b/i.test(answer) ? Math.max(30, score - 20) : score,
    completenessScore: completeness,
    depthScore: depth,
    terminologyScore: terminology,
    grammarScore: communication,
    vocabularyScore: terminology,
    domainScore: score,
    nextAction: score < 40 ? 'reduce_difficulty' : score < 60 ? 'clarify' : score >= 85 ? 'challenge' : score >= 70 ? 'ask_deeper' : 'move_topic',
    suggestedDifficulty: score < 40 ? 'easy' : context?.difficulty as GeneratedQuestion['difficulty'] ?? 'medium',
    detectedSignals: signalCoverage,
    missingSignals,
  };
};

const isCodingStyleQuestion = (question: string, questionType?: string, answer?: string) =>
  looksLikeCodingSubmission(question, answer || '', questionType);

/** Discussion answers must not be judged on accidental coding-panel payloads (F07, F08, N03). */
const answerForScoring = (question: string, answer: string, questionType?: string) => {
  if (isCodingStyleQuestion(question, questionType, answer)) return answer;
  return answer
    .replace(/\n*Submitted code[\s\S]*$/i, '')
    .replace(/\n*Design whiteboard notes:[\s\S]*$/i, '')
    .trim();
};

const clampScore100 = (value: unknown, fallback: number) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
};

const codingPlaceholderEvaluation = (
  question: string,
  scoringAnswer: string,
  context?: AnswerEvaluationContext,
): AnswerEvaluation => {
  const idealAnswer = buildIdealAnswerFallback(question, context);
  const missingConcepts = context?.expectedSignals?.length
    ? context.expectedSignals
    : ['A working solution', 'Edge cases', 'Time/space complexity'];
  return {
    score: 0,
    feedback:
      "You didn't submit working code — the editor was blank, still on the starter template, or only had placeholder text (pass / TODO / empty function). That's a 0 until you implement the actual logic the question asks for.",
    idealAnswer,
    samplePerfectAnswer: buildSuggestedImprovedAnswerFallback(question, scoringAnswer, context, missingConcepts),
    conceptsCovered: [],
    missingConcepts,
    incorrectStatements: ['No functional implementation was submitted.'],
    wrongTerminology: [],
    technicalMistakes: ['Blank or placeholder code cannot solve the problem.'],
    dynamicFeedback: {
      strengths: [],
      missingConcepts,
      technicalMistakes: ['Blank or placeholder code was submitted.'],
      communication: "I couldn't evaluate your approach because no real solution was submitted.",
      confidence: 'No confidence read yet — write a working attempt first.',
      areasToImprove: ['Implement the function body, then walk through approach, edge cases, and complexity.'],
      nextLearningSuggestions: ['Code the solution, test one normal and one edge case, then submit again.'],
      practicalUnderstanding: "You haven't shown implementation yet.",
      interviewReadiness: "You're not ready for a live coding round on this problem until you submit a real attempt.",
    },
    communicationScore: 0,
    technicalScore: 0,
    behavioralScore: 0,
    confidenceScore: 0,
    completenessScore: 0,
    depthScore: 0,
    terminologyScore: 0,
    grammarScore: 0,
    vocabularyScore: 0,
    domainScore: 0,
    nextAction: 'move_topic',
    suggestedDifficulty: 'easy',
    detectedSignals: [],
    missingSignals: missingConcepts,
  };
};

const fallbackCodingEvaluation = (
  question: string,
  scoringAnswer: string,
  context?: AnswerEvaluationContext,
): AnswerEvaluation => {
  const { code, spoken } = extractSubmittedCode(scoringAnswer);
  const source = code || scoringAnswer;
  if (isPlaceholderOrBlankCode(source) && spoken.trim().length < 10) {
    return codingPlaceholderEvaluation(question, scoringAnswer, context);
  }

  const expectedSignals = context?.expectedSignals ?? [];
  const answerTokens = tokenizeConcepts(`${source}\n${spoken}`);
  const signalCoverage = expectedSignals.filter((signal) =>
    tokenizeConcepts(signal).some((token) => answerTokens.includes(token)),
  );
  const missingSignals = expectedSignals.filter((signal) => !signalCoverage.includes(signal));
  const looksConstantReturn = /\breturn\s+(?:0|1|-1|true|false|null|none|\[0\s*,\s*1\]|\[\])\s*;?/i.test(source)
    && !/\bfor\b|\bwhile\b|\bhash|map|dict|set\b|\btwo[- ]pointer|pointer\b/i.test(source);
  const hasAlgorithmShape = /\b(for|while|if|hash|map|dict|set|pointer|two[- ]pointer|window|sort|stack|queue|recursion|dp)\b/i.test(
    source,
  );
  let score = 15;
  if (hasAlgorithmShape) score += 20;
  if (signalCoverage.length) score += Math.round((signalCoverage.length / Math.max(1, expectedSignals.length)) * 25);
  if (spoken.length > 40) score += 10;
  if (looksConstantReturn) score = Math.min(score, 20);
  if (isPlaceholderOrBlankCode(source)) score = Math.min(score, spoken.length > 40 ? 15 : 0);
  score = Math.max(0, Math.min(55, score));

  const missingConcepts = missingSignals.length ? missingSignals : ['Correctness against the asked problem'];
  const idealAnswer = buildIdealAnswerFallback(question, context);
  const dynamicFeedback = buildFallbackDynamicFeedback({
    question,
    answer: scoringAnswer,
    signalCoverage,
    missingSignals,
    score,
    completeness: Math.round((signalCoverage.length / Math.max(1, expectedSignals.length || 1)) * 100),
    communication: Math.min(score + 5, 60),
    depth: hasAlgorithmShape ? score : Math.min(score, 20),
    terminology: score,
    isCoding: true,
    code: source,
    spoken,
    looksConstantReturn,
    hasAlgorithmShape,
  });

  return {
    score,
    feedback:
      `${looksConstantReturn
        ? `Your \`${source.match(/return\s+[^;]+/i)?.[0] || 'return …'}\` hard-codes an answer instead of using the inputs — that cannot pass hidden tests for "${question.slice(0, 80)}".`
        : `Your submission \`${source.split('\n').find((l) => l.trim())?.trim().slice(0, 60) || 'code'}\` is a partial attempt — verify correctness, edge cases, and state complexity.`} `
      + `Missing: ${missingConcepts.slice(0, 3).join(', ')}.`,
    idealAnswer,
    samplePerfectAnswer: buildSuggestedImprovedAnswerFallback(question, scoringAnswer, context, missingConcepts),
    conceptsCovered: signalCoverage,
    missingConcepts,
    incorrectStatements: looksConstantReturn ? ['The function returns a hard-coded value instead of computing the answer.'] : [],
    wrongTerminology: [],
    technicalMistakes: looksConstantReturn || isPlaceholderOrBlankCode(source)
      ? ['Submitted code is not a working solution.']
      : [],
    dynamicFeedback,
    communicationScore: Math.min(score + 5, 60),
    technicalScore: score,
    behavioralScore: Math.round(score * 0.3),
    confidenceScore: score,
    completenessScore: Math.round((signalCoverage.length / Math.max(1, expectedSignals.length || 1)) * 100),
    depthScore: hasAlgorithmShape ? score : Math.min(score, 20),
    terminologyScore: score,
    grammarScore: 50,
    vocabularyScore: score,
    domainScore: score,
    nextAction: score < 40 ? 'reduce_difficulty' : 'move_topic',
    suggestedDifficulty: 'easy',
    detectedSignals: signalCoverage,
    missingSignals,
  };
};

export const evaluateAnswer = (question: string, answer: string, context?: AnswerEvaluationContext) => {
  const isCoding = isCodingStyleQuestion(question, context?.questionType, answer);
  const scoringAnswer = answerForScoring(question, answer, context?.questionType);
  const codingPayload = extractSubmittedCode(scoringAnswer);
  const codeForEval = codingPayload.hasCodeBlock
    ? codingPayload.code
    : (isCoding ? scoringAnswer : '');

  if (process.env.FAI_DEBUG_CODING === '1' && (isCoding || codingPayload.hasCodeBlock)) {
    console.info('[coding-eval] captured submission', {
      questionPreview: String(question || '').slice(0, 80),
      language: codingPayload.language || context?.topic || 'unknown',
      codeChars: codeForEval.length,
      codePreview: codeForEval.slice(0, 240),
      spokenChars: codingPayload.spoken.length,
      placeholder: isPlaceholderOrBlankCode(codeForEval),
    });
  }

  // Detect empty / skipped answers immediately — no AI call needed
  const trimmed = scoringAnswer.trim();
  const isSkipped =
    !trimmed ||
    trimmed === '(no answer)' ||
    (trimmed.length < 10 && !codingPayload.hasCodeBlock) ||
    /^\(?(no answer|skipped?|n\/a|nothing|none)\)?$/i.test(trimmed);

  if (isCoding && (isSkipped || (isPlaceholderOrBlankCode(codeForEval) && codingPayload.spoken.trim().length < 24))) {
    return Promise.resolve(
      alignEvaluationFeedbackToScore(
        codingPlaceholderEvaluation(question, scoringAnswer, context),
        { isCoding: true, code: codeForEval, answer: scoringAnswer },
      ),
    );
  }

  if (isSkipped) {
    const idealAnswer = buildIdealAnswerFallback(question, context);
    const missingConcepts = context?.expectedSignals?.length ? context.expectedSignals : ['No answer was provided'];
    return Promise.resolve<AnswerEvaluation>({
      score: 0,
      feedback: 'No answer was provided. Correct coverage: none. Missing: all expected concepts for this question. Improve by giving a structured answer with a direct explanation, one practical example, and the key trade-offs; review the ideal answer below. Next question will recover with a clearer, easier prompt instead of drilling this topic.',
      idealAnswer,
      samplePerfectAnswer: buildSuggestedImprovedAnswerFallback(question, scoringAnswer, context, missingConcepts),
      conceptsCovered: [],
      missingConcepts,
      incorrectStatements: [],
      wrongTerminology: [],
      technicalMistakes: [],
      dynamicFeedback: {
        strengths: [],
        missingConcepts: context?.expectedSignals?.length ? context.expectedSignals : ['No answer was provided'],
        technicalMistakes: [],
        communication: 'No communication could be evaluated because no answer was provided.',
        confidence: 'No confidence could be evaluated because no answer was provided.',
        areasToImprove: ['Concept to improve: the full question topic. Answer with a direct explanation, one relevant example, and the expected signals.'],
        nextLearningSuggestions: ['Review the sample perfect answer and practice a 60-90 second response aloud.'],
        practicalUnderstanding: 'No practical understanding was demonstrated.',
        interviewReadiness: 'Not interview-ready for this question until a substantive answer is provided.',
      },
      communicationScore: 0,
      technicalScore: 0,
      behavioralScore: 0,
      confidenceScore: 0,
      completenessScore: 0,
      depthScore: 0,
      terminologyScore: 0,
      grammarScore: 0,
      vocabularyScore: 0,
      domainScore: 0,
      // Move on with an easier recovery ask — do not sticky-drill a skipped question.
      nextAction: 'move_topic',
      suggestedDifficulty: 'easy',
      detectedSignals: [],
      missingSignals: ['No answer was provided'],
    });
  }

  const speechHints = detectLikelySpeechArtifacts(scoringAnswer, `${question} ${context?.topic ?? ''}`);
  const projectName = projectFromContext(question, context);
  const stack = (context?.resumeSkills ?? []).slice(0, 10);
  const turnType = classifyAnswerTurn(scoringAnswer);
  const codingPrompt = isCoding
    ? `You are an experienced mock interview coach grading a live coding submission. Talk directly to the candidate ("you") — honest, specific, supportive where earned. Do NOT write a formal panel report.

QUESTION: ${question}
ROLE: ${context?.roleDomain ?? 'Not specified'} ${context?.roleLevel ?? ''}
DIFFICULTY: ${context?.difficulty ?? 'Not specified'}
TOPIC: ${context?.topic ?? 'Not specified'}
EXPECTED SIGNALS:
${JSON.stringify(context?.expectedSignals ?? [], null, 2)}

SPOKEN APPROACH (may be empty): ${codingPayload.spoken || '(none)'}
LANGUAGE: ${codingPayload.language || 'unspecified'}

EXACT SUBMITTED CODE (grade THIS — do not invent code, do not grade a reference solution):
\`\`\`
${codeForEval || '(empty)'}
\`\`\`

CODING RUBRIC (score is 0-100, NEVER 0-10. 10 means poor; 100 means excellent):
- 0-15: blank, starter template, comments-only, pass/TODO, or empty function
- 16-35: attempted but clearly incorrect (wrong return value, ignores the prompt, does not compile conceptually)
- 36-55: partial approach, missing edge cases or a core step
- 56-75: mostly correct with gaps (complexity not discussed, a missed edge case)
- 76-90: correct logic, edge cases, reasonable complexity
- 91-100: correct, clean, complete, with complexity and edge cases

HARD RULES:
- If the code is blank, placeholder, or unchanged starter, score MUST be 0
- If the code returns a hard-coded constant / wrong value and cannot solve the asked problem, score MUST be ≤ 25
- Spoken explanation cannot raise a broken/blank implementation above 25
- Feedback MUST quote or describe the actual submitted code (variable names, return values, loops, line-level logic) — never generic "good attempt" text
- Your feedback narrative MUST match the score band — do not praise broken code
- technicalScore should track correctness of the code; behavioralScore should stay low unless the spoken approach is unusually strong
- Do NOT give full marks for submitting any code. Correctness is required.
- BANNED stock phrases: ${formatBannedFeedbackPhrasesForPrompt()}
${buildAnswerGroundedFeedbackInstructions({ isCoding: true })}

Return ONLY a JSON object with the same schema as a normal evaluation, including score, feedback, idealAnswer, samplePerfectAnswer, conceptsCovered, missingConcepts, incorrectStatements, technicalMistakes, dynamicFeedback, all *Score fields, nextAction, suggestedDifficulty, detectedSignals, missingSignals.`
    : `You are a strict, professional interview evaluator and answer-comparison engine. Generate a fresh internal ideal answer, compare it to the candidate's answer, and evaluate the answer.

QUESTION: ${question}
ROLE: ${context?.roleDomain ?? 'Not specified'} ${context?.roleLevel ?? ''}
TARGET COMPANY: ${context?.targetCompany ?? 'Not specified'}
DIFFICULTY: ${context?.difficulty ?? 'Not specified'}
QUESTION TYPE: ${context?.questionType ?? 'Not specified'}
TOPIC: ${context?.topic ?? 'Not specified'}
RESUME PROJECT TO NAME EXACTLY: ${projectName}
RESUME SKILLS / STACK (do not invent outside this list unless the candidate said it): ${stack.join(', ') || 'use only what the answer claims'}
EXPECTED SIGNALS:
${JSON.stringify(context?.expectedSignals ?? [], null, 2)}

CANDIDATE ANSWER: ${scoringAnswer}
DETECTED ANSWER TURN TYPE: ${turnType}
LIKELY SPEECH-TO-TEXT ARTIFACTS (do NOT treat as real tech facts): ${speechHints.length ? JSON.stringify(speechHints) : 'none'}
${speechHints.length ? '- If ASR artifacts are present, prefer nextAction=clarify and ask "Did you mean X?" instead of treating the misheard word as a technical claim.' : ''}

IDEAL ANSWER REQUIREMENTS:
- First classify the turn: answered_well, answered_weakly, clarification_request, or deflected.
- If clarification_request: the ideal answer must model asking for clarification briefly AND then answering once clarified. Do not ignore the confusion.
- If deflected: the ideal answer should acknowledge the gap honestly and outline what a prepared answer would cover.
- Keep idealAnswer and samplePerfectAnswer as detailed, paragraph-length responses tailored to this specific question. Do not shorten them into brief snippets.
- idealAnswer and samplePerfectAnswer MUST be different texts with different purposes:
  * idealAnswer = gold-standard model answer for THIS exact question type (coding/SQL/Node/career/project). ${projectName ? `If this is a project question, use the EXACT name "${projectName}".` : 'Do NOT force a resume project name for coding, SQL, Node/event-loop, or career-motivation questions.'}
  * samplePerfectAnswer = improved rewrite of THIS candidate's answer (keep their intent/pipeline, fix clarity, add missing structure — do NOT replace their story with a different invented project)
- Never copy idealAnswer into samplePerfectAnswer.
- Never invent tools the resume/answer did not mention (no NER/POS/JWT/caching/testing frameworks unless present in resume or answer).
- If speech artifacts are listed, interpret the answer charitably (e.g. Riya → React, Gate → Git) , mention the transcription risk in feedback, and do NOT build ideal answers around the misheard word.
- Ignore unrelated submitted code snippets when judging a discussion question.
- Avoid generic filler such as "fast-paced environment", "aligns with my career goals", or "eager to apply my skills" unless the question is explicitly about motivation.
- Compare ideal answer vs candidate answer.
- Feedback must clearly state: what was correct, what was missing, which concept to improve, and what an ideal answer should include.
- nextAction: prefer move_topic after a weak/partial answer once clarified; do not recommend endless deepen on the same project.

SCORING RULES (fair interview curve on a 0–100 scale — NOT 0–10):
- Score 0–20  → No meaningful answer, completely off-topic, or just a few words
- Score 21–40 → Very vague, generic, no specific examples or evidence
- Score 41–60 → Partially addresses the question but lacks depth, specifics, or structure
- Score 61–80 → Good answer: relevant, structured, with examples and reasonable depth
- Score 81–100 → Excellent: specific, structured (STAR when appropriate), insightful, with measurable outcomes

CALIBRATION (important):
- A complete, relevant, reasonably well-communicated answer should typically land in the 65–85 range.
- Reserve 90+ for exceptional, comprehensive answers. Reserve 0–30 for blank, off-topic, or very poor answers.
- Do NOT treat "good" as merely average — interview-ready answers deserve scores in the 60s–80s.
- All score fields (score, communicationScore, technicalScore, etc.) MUST be on the same 0–100 scale. Never return 0–10 values.

IMPORTANT:
- If the answer is very short (under 2 sentences), the maximum score is 30
- If the answer contains no specific examples or evidence, cap at 50
- If the answer is a filler phrase, meaningless text, or off-topic, score it 0–15
- Do NOT inflate vague answers — but do NOT punish clear, complete, on-topic answers with scores in the 20s
- Base the score on actual comparison to the ideal answer: technical correctness, completeness, communication, confidence, logical flow, examples, missing concepts, and practical understanding
- The communicationScore reflects clarity and structure of expression
- The technicalScore reflects relevance of technical knowledge shown (0 if non-technical question)
- The behavioralScore reflects self-awareness, teamwork, and professional maturity shown
- confidenceScore reflects how certain and composed the candidate sounded based on wording, hedging, and answer control
- completenessScore reflects whether all parts of the question were answered
- depthScore reflects technical/behavioral depth beyond definitions
- terminologyScore reflects accurate use of role-specific technical language
- grammarScore and vocabularyScore reflect spoken English clarity without penalizing accent
- domainScore reflects job/domain expertise shown
- nextAction decides the next interviewer move:
  * ask_deeper = strong answer, continue same topic at higher depth
  * clarify = answer is partial or ambiguous, ask a clarifying follow-up
  * move_topic = adequate answer, coverage should move to a different JD topic
  * challenge = strong answer, ask scenario/problem-solving
  * reduce_difficulty = weak answer, ask an easier confidence-building continuation
${buildAnswerGroundedFeedbackInstructions({ isCoding: false })}

Return ONLY a JSON object:
{
  "score": number (0-100, strict),
  "feedback": string (2-4 sentences: quote/paraphrase THIS answer; what was correct/missing for THIS question; why the score fits),
  "idealAnswer": string (gold-standard model answer for this question),
  "samplePerfectAnswer": string (improved rewrite of the candidate's answer; must differ from idealAnswer),
  "conceptsCovered": string[],
  "missingConcepts": string[],
  "incorrectStatements": string[],
  "wrongTerminology": string[],
  "technicalMistakes": string[],
  "dynamicFeedback": {
    "strengths": string[] (2-3 items, each cites specific content from THIS answer),
    "missingConcepts": string[],
    "technicalMistakes": string[],
    "communication": string (1-2 sentences on clarity/structure of THIS answer, tied to communicationScore),
    "confidence": string (1-2 sentences on hedging/tone in THIS answer, tied to confidenceScore),
    "areasToImprove": string[] (2-3 concrete, actionable items for THIS answer),
    "nextLearningSuggestions": string[] (2-3 specific practice steps for gaps in THIS answer),
    "practicalUnderstanding": string (evidence from THIS answer, tied to depthScore),
    "interviewReadiness": string (specific to THIS answer's gaps/strengths)
  },
  "communicationScore": number (0-100),
  "technicalScore": number (0-100),
  "behavioralScore": number (0-100),
  "confidenceScore": number (0-100),
  "completenessScore": number (0-100),
  "depthScore": number (0-100),
  "terminologyScore": number (0-100),
  "grammarScore": number (0-100),
  "vocabularyScore": number (0-100),
  "domainScore": number (0-100),
  "nextAction": "ask_deeper" | "clarify" | "move_topic" | "challenge" | "reduce_difficulty",
  "suggestedDifficulty": "easy" | "easy-medium" | "medium" | "medium-hard" | "scenario" | "problem-solving" | "behavioral",
  "detectedSignals": string[],
  "missingSignals": string[]
}`;

  const codingFallback = fallbackCodingEvaluation(question, scoringAnswer, context);

  return generateJson<AnswerEvaluation>(
    codingPrompt,
    isCoding ? codingFallback : fallbackComparisonEvaluation(question, scoringAnswer, context),
    {
      temperature: 0,
      requestType: 'answer_evaluation',
      interviewId: context?.interviewId,
    },
  ).then((evaluation) => {
    const parsedScore = Number(evaluation?.score);
    if (isCoding && !Number.isFinite(parsedScore)) {
      Object.assign(evaluation, codingFallback);
    } else if (!Number.isFinite(parsedScore)) {
      Object.assign(evaluation, fallbackComparisonEvaluation(question, scoringAnswer, context));
    } else {
      Object.assign(evaluation, normalizeEvaluationScores({ ...evaluation }, { isCoding }));
      if (isCoding && isPlaceholderOrBlankCode(codeForEval) && evaluation.score > 15) {
        evaluation.score = 0;
        evaluation.feedback = codingPlaceholderEvaluation(question, scoringAnswer, context).feedback;
      }
      if (isCoding && /\breturn\s+(?:0|1|-1|true|false|null|none|\[0\s*,\s*1\]|\[\])\s*;?/i.test(codeForEval)
        && !/\bfor\b|\bwhile\b|\bhash|map|dict|set\b/i.test(codeForEval)
        && evaluation.score > 25) {
        evaluation.score = 25;
        evaluation.feedback = `${evaluation.feedback || ''} The submitted code returns a hard-coded value and cannot earn more than 25.`.trim();
      }
    }
    const missing = evaluation.missingConcepts?.length
      ? evaluation.missingConcepts
      : evaluation.missingSignals ?? [];
    if (!evaluation.idealAnswer?.trim()) {
      evaluation.idealAnswer = buildIdealAnswerFallback(question, context);
    }
    if (
      !evaluation.samplePerfectAnswer?.trim()
      || evaluation.samplePerfectAnswer.trim() === evaluation.idealAnswer.trim()
    ) {
      evaluation.samplePerfectAnswer = buildSuggestedImprovedAnswerFallback(
        question,
        scoringAnswer,
        context,
        missing,
      );
    }
    const grounding = {
      projects: context?.resumeProjects,
      skills: context?.resumeSkills,
      answer: scoringAnswer,
      question,
    };
    evaluation.idealAnswer = sanitizeGroundedFeedbackText(evaluation.idealAnswer || '', grounding);
    evaluation.samplePerfectAnswer = sanitizeGroundedFeedbackText(
      evaluation.samplePerfectAnswer || '',
      grounding,
    );
    if (
      evaluation.samplePerfectAnswer.trim()
      && evaluation.samplePerfectAnswer.trim() === evaluation.idealAnswer.trim()
    ) {
      evaluation.samplePerfectAnswer = sanitizeGroundedFeedbackText(
        buildSuggestedImprovedAnswerFallback(question, scoringAnswer, context, missing),
        grounding,
      );
    }

    Object.assign(
      evaluation,
      refineEvaluationFeedback(evaluation, question, scoringAnswer, {
        isCoding,
        code: codeForEval,
        scoreAlignedFeedback: isCoding ? codingFallback.feedback : undefined,
        scoreAlignedStrengths: isCoding ? codingFallback.dynamicFeedback?.strengths : undefined,
      }),
    );

    return applyScoringBandGuards(evaluation, scoringAnswer, speechHints, { isCoding, code: codeForEval });
  });
};

const DIFFICULTY_ORDER: NonNullable<GeneratedQuestion['difficulty']>[] = [
  'easy',
  'easy-medium',
  'medium',
  'medium-hard',
  'scenario',
  'problem-solving',
  'behavioral',
];

const clampDifficultyIndex = (index: number) => Math.max(0, Math.min(DIFFICULTY_ORDER.length - 1, index));

const nextDifficulty = (
  current: GeneratedQuestion['difficulty'],
  evaluation: AnswerEvaluation,
  position: number,
  total: number,
): NonNullable<GeneratedQuestion['difficulty']> => {
  const currentIndex = current ? DIFFICULTY_ORDER.indexOf(current) : DIFFICULTY_ORDER.indexOf(difficultyForPosition(position, total));
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;

  if (evaluation.nextAction === 'reduce_difficulty' || evaluation.score < 40) {
    return DIFFICULTY_ORDER[clampDifficultyIndex(safeIndex - 1)];
  }
  if (evaluation.nextAction === 'clarify' || evaluation.score < 60) {
    return DIFFICULTY_ORDER[clampDifficultyIndex(safeIndex)];
  }
  if (evaluation.nextAction === 'challenge' || evaluation.score >= 85) {
    return DIFFICULTY_ORDER[clampDifficultyIndex(safeIndex + 2)];
  }
  if (evaluation.nextAction === 'ask_deeper' || evaluation.score >= 70) {
    return DIFFICULTY_ORDER[clampDifficultyIndex(safeIndex + 1)];
  }
  return DIFFICULTY_ORDER[clampDifficultyIndex(Math.max(safeIndex, DIFFICULTY_ORDER.indexOf(difficultyForPosition(position, total))))];
};

const humanizeInterviewFocus = (raw?: string) => {
  const value = canonicalize(raw ?? '');
  const lower = value.toLowerCase();
  if (!value || /no clear gap|not available|none/i.test(lower)) {
    return 'a concrete project example and the trade-offs you considered';
  }
  if (/accurate concept explanation|core concept/i.test(lower)) {
    return 'how the concept worked in a real project, with one concrete example';
  }
  if (/practical example/i.test(lower)) {
    return 'a specific project example with what you built and the outcome';
  }
  if (/trade-?offs? or edge cases|trade-?offs?/i.test(lower)) {
    return 'the trade-offs and edge cases you handled';
  }
  if (/clear career summary|candidate overview/i.test(lower)) {
    return 'how your projects and skills connect to this role';
  }
  if (/interview expectations|company-style/i.test(lower)) {
    return 'a resume example that shows role fit';
  }
  return value;
};

const firstMeaningfulGap = (evaluation: AnswerEvaluation) =>
  humanizeInterviewFocus(
    [
      ...(evaluation.missingConcepts ?? []),
      ...(evaluation.missingSignals ?? []),
      ...(evaluation.dynamicFeedback?.missingConcepts ?? []),
      ...(evaluation.technicalMistakes ?? []),
    ]
      .map((item) => canonicalize(item))
      .find((item) => item && !/no clear gap|not available|none/i.test(item)),
  );

const isWeakInterviewTopic = (topic?: string) =>
  /^(candidate overview|b\.?\s*tech|degree|college|education|clear career summary|interview expectations)$/i.test(
    canonicalize(topic ?? ''),
  );

export const decideAdaptiveFollowUp = ({
  evaluation,
  lastQuestion,
  position,
  total,
  transcript = [],
  resumeProjects = [],
}: {
  evaluation: AnswerEvaluation;
  lastQuestion?: GeneratedQuestion;
  position: number;
  total: number;
  transcript?: AdaptiveQuestionContext['transcript'];
  resumeProjects?: string[];
}): AdaptiveFollowUpDecision => {
  const score = evaluation.score ?? 0;
  const focus = firstMeaningfulGap(evaluation);
  const targetDifficulty = nextDifficulty(lastQuestion?.difficulty, evaluation, position, total);
  const lastTopic = lastQuestion?.topic || lastQuestion?.resumeReference;
  const skippedOrEmpty =
    score === 0
    && /no answer was provided|skipped/i.test(`${evaluation.feedback || ''} ${(evaluation.missingSignals || []).join(' ')}`);

  // After a skip/empty answer: recover on a different, easier topic — never sticky-drill.
  if (skippedOrEmpty) {
    const lastWasCoding = isCodingStyleQuestion(lastQuestion?.question || '');
    return {
      action: 'move_topic',
      focus: lastWasCoding
        ? 'an easier fundamentals or second-project question (not another hard coding drill)'
        : 'a concrete coding problem or a different resume project at easier difficulty',
      reason: 'Skipped/empty answer: move to a cleaner recovery question instead of empty coaching on the same topic.',
      targetDifficulty: 'easy',
      followUpIntent: 'recover-confidence',
    };
  }

  const consecutiveOnTopic = (() => {
    let count = 0;
    for (let index = transcript.length - 1; index >= 0; index -= 1) {
      const item = transcript[index];
      const sameTopic = sameCoverageTopic(item.topic || item.resumeReference, lastTopic);
      const sameProject = Boolean(
        sharedProjectName(
          `${item.question} ${item.topic || ''}`,
          `${lastQuestion?.question || ''} ${lastTopic || ''}`,
          resumeProjects,
        ),
      );
      if (!sameTopic && !sameProject) break;
      count += 1;
    }
    return count;
  })();

  // After 1 main + 1 clarify on the same project/topic, always bridge away.
  if (consecutiveOnTopic >= 2) {
    return {
      action: 'move_topic',
      focus: 'a different project, coding problem, or company/HR topic',
      reason: 'Topic sticky limit reached: one clarify max, then move on.',
      targetDifficulty,
      followUpIntent: 'bridge-topic',
    };
  }

  // E20: after repeated clarification loops, force stage advancement.
  let clarifyStreak = 0;
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    if (classifyAnswerTurn(transcript[index]?.answer || '') !== 'clarification_request') break;
    clarifyStreak += 1;
  }
  if (clarifyStreak >= 2) {
    return {
      action: 'move_topic',
      focus: 'a coding problem or a second resume project',
      reason: 'Clarify-loop guard: advance to coding or next project after two clarification turns.',
      targetDifficulty,
      followUpIntent: 'bridge-topic',
    };
  }

  const incomplete =
    evaluation.nextAction === 'clarify' ||
    (evaluation.completenessScore ?? 100) < 65 ||
    Boolean((evaluation.missingConcepts?.length ?? 0) || (evaluation.missingSignals?.length ?? 0));

  if (evaluation.nextAction === 'reduce_difficulty' || score < 40) {
    // First weak hit: one easier probe. Second consecutive: move on.
    if (consecutiveOnTopic >= 1) {
      return {
        action: 'move_topic',
        focus: 'an easier question on a different project or fundamentals',
        reason: 'Weak answer after a probe: switch topic instead of drilling.',
        targetDifficulty: 'easy',
        followUpIntent: 'bridge-topic',
      };
    }
    return {
      action: 'reduce_difficulty',
      focus,
      reason: 'Weak answer: one easier clarifying question, then move on.',
      targetDifficulty,
      followUpIntent: 'recover-confidence',
    };
  }

  if (incomplete && score < 75 && consecutiveOnTopic < 1) {
    return {
      action: 'clarify',
      focus,
      reason: 'Incomplete answer: one clarifying probe, then move on.',
      targetDifficulty,
      followUpIntent: 'clarify',
    };
  }

  if ((evaluation.nextAction === 'challenge' || score >= 85) && consecutiveOnTopic < 1) {
    return {
      action: 'challenge',
      focus: lastQuestion?.topic || focus,
      reason: 'Strong answer: increase depth once, then cover new ground later.',
      targetDifficulty,
      followUpIntent: 'challenge',
    };
  }

  if ((evaluation.nextAction === 'ask_deeper' || score >= 70) && consecutiveOnTopic < 1) {
    return {
      action: 'ask_deeper',
      focus: lastQuestion?.topic || focus,
      reason: 'Strong answer: one deeper follow-up on the same topic.',
      targetDifficulty,
      followUpIntent: 'deepen',
    };
  }

  return {
    action: 'move_topic',
    focus: 'the next planned project, coding, company, or HR topic',
    reason: 'Adequate answer or sticky limit: continue coverage on a different topic.',
    targetDifficulty,
    followUpIntent: 'bridge-topic',
  };
};

const topicCoverage = (transcript: AdaptiveQuestionContext['transcript']) => {
  const coverage = new Map<string, { asked: number; averageScore: number }>();
  transcript.forEach((item) => {
    const topic = canonicalize(item.topic || item.resumeReference || 'general');
    const existing = coverage.get(topic) ?? { asked: 0, averageScore: 0 };
    const nextAsked = existing.asked + 1;
    coverage.set(topic, {
      asked: nextAsked,
      averageScore: Math.round(((existing.averageScore * existing.asked) + (item.score ?? 0)) / nextAsked),
    });
  });
  return coverage;
};

const sameCoverageTopic = (left?: string, right?: string) => {
  const a = canonicalize(left ?? '').toLowerCase();
  const b = canonicalize(right ?? '').toLowerCase();
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  // Token overlap for "PDF Knowledge Chatbot" vs "tokenization in PDF Knowledge Chatbot"
  const tokens = (value: string) => value.split(/[^a-z0-9]+/).filter((part) => part.length > 3);
  const leftTokens = new Set(tokens(a));
  const rightTokens = tokens(b);
  const overlap = rightTokens.filter((token) => leftTokens.has(token)).length;
  return overlap >= 2;
};

const sectionForTopic = (context: AdaptiveQuestionContext, topic?: string) =>
  context.interviewRoadmap?.sections.find((section) =>
    section.topics.some((sectionTopic) => sameCoverageTopic(topic, sectionTopic)),
  );

const projectForTopic = (context: AdaptiveQuestionContext, topic?: string) =>
  context.interviewRoadmap?.resumeProfile.projects.find((project) => sameCoverageTopic(topic, project));

const topicAskCount = (context: AdaptiveQuestionContext, topic?: string) =>
  context.transcript.filter((item) => sameCoverageTopic(item.topic || item.resumeReference, topic)).length;

const consecutiveTopicCount = (context: AdaptiveQuestionContext, topic?: string) => {
  let count = 0;
  for (let index = context.transcript.length - 1; index >= 0; index -= 1) {
    const item = context.transcript[index];
    if (!sameCoverageTopic(item.topic || item.resumeReference, topic)) break;
    count += 1;
  }
  return count;
};

const isTopicExhausted = (context: AdaptiveQuestionContext, topic?: string) => {
  const projects = context.resumeProfile?.projects ?? context.interviewRoadmap?.resumeProfile.projects ?? [];
  const project = projectForTopic(context, topic);
  if (project && topicAskCount(context, project) >= 2) return true;

  const lastProject = projects.find((name) =>
    sharedProjectName(
      `${context.lastQuestion.question} ${context.lastQuestion.topic || topic || ''}`,
      name,
      [name],
    ),
  );
  if (lastProject) {
    const asksOnProject = context.transcript.filter((item) =>
      sharedProjectName(`${item.question} ${item.topic || ''}`, lastProject, [lastProject]),
    ).length;
    if (asksOnProject >= 2) return true;
  }

  // Max two consecutive turns on the same topic (main + one clarify).
  return consecutiveTopicCount(context, topic) >= 2;
};

const roadmapTopicsInOrder = (context: AdaptiveQuestionContext) =>
  unique((context.interviewRoadmap?.sections ?? []).flatMap((section) => section.topics));

const chooseCoverageTopic = (context: AdaptiveQuestionContext) => {
  const modeGuidance = getInterviewModeGuidance(context.interviewMode);
  const projectTopics = context.resumeProfile?.projects ?? context.interviewRoadmap?.resumeProfile.projects ?? [];
  const jdTopics = unique([
    ...(context.jdProfile?.requiredSkills ?? []),
    ...(context.jdProfile?.toolsTechnologies ?? []),
    ...(context.jdProfile?.domainKnowledge ?? []),
    ...projectTopics,
    ...roadmapTopicsInOrder(context),
    ...modeGuidance.questionAngles,
    ...(context.resumeSkills ?? []),
    context.roleDomain,
  ]).filter((topic) => Boolean(topic) && !isWeakInterviewTopic(topic));
  const coverage = topicCoverage(context.transcript);
  const lastSection = sectionForTopic(context, context.lastQuestion.topic || context.lastQuestion.resumeReference);

  // E08 / E20: if coding stage not completed by mid-interview, force it next.
  const codingTopic = context.interviewRoadmap?.sections.find(
    (section) => section.key === 'coding_problem_solving',
  )?.topics?.[0];
  if (
    codingTopic
    && !context.interviewState?.coding_completed
    && context.currentQuestionIndex >= 2
    && !isTopicExhausted(context, codingTopic)
  ) {
    return codingTopic;
  }

  // Prefer an uncovered second project when sticky clarify loops end.
  const uncoveredProject = projectTopics.find(
    (project) => !coverage.has(canonicalize(project)) && !isTopicExhausted(context, project),
  );

  const nextRoadmapTopic = context.interviewRoadmap?.sections
    .filter((section) => section.key !== 'self_introduction' && section.key !== 'resume_overview')
    .filter((section) => section.key !== lastSection?.key || isTopicExhausted(context, context.lastQuestion.topic))
    .flatMap((section) => section.topics)
    .find((topic) => !isWeakInterviewTopic(topic) && !coverage.has(topic) && !isTopicExhausted(context, topic));

  return (
    nextRoadmapTopic ??
    uncoveredProject ??
    jdTopics.find((topic) => !coverage.has(topic)) ??
    jdTopics
      .filter((topic) => !isTopicExhausted(context, topic))
      .sort((a, b) => (coverage.get(a)?.asked ?? 0) - (coverage.get(b)?.asked ?? 0))[0] ??
    projectTopics[0] ??
    context.resumeSkills?.[0] ??
    context.roleDomain
  );
};

const buildNaturalFallbackQuestion = (
  context: AdaptiveQuestionContext,
  action: NonNullable<AnswerEvaluation['nextAction']>,
  topic: string,
  focus: string,
  difficulty: NonNullable<GeneratedQuestion['difficulty']>,
): GeneratedQuestion => {
  const modeGuidance = getInterviewModeGuidance(context.interviewMode);
  const projects = context.resumeProfile?.projects ?? context.interviewRoadmap?.resumeProfile.projects ?? [];
  const lastProject = projects.find((name) =>
    sharedProjectName(
      `${context.lastQuestion.question} ${context.lastQuestion.topic || ''}`,
      name,
      [name],
    ),
  );
  const alternateProject =
    projects.find((name) => name !== lastProject) ?? projects[0] ?? 'one of your projects';
  const projectName = action === 'move_topic' ? alternateProject : lastProject || projects[0] || 'one of your projects';
  const skill = context.resumeSkills?.[0] ?? topic;
  const safeTopic = isWeakInterviewTopic(topic) ? skill : topic;
  const safeFocus = humanizeInterviewFocus(focus);
  const speechHints = detectLikelySpeechArtifacts(
    context.lastAnswer || '',
    `${context.lastQuestion.question} ${context.lastQuestion.topic || ''}`,
  );
  const isHrMode = context.interviewMode === 'hr_behavioral';
  const questionType: GeneratedQuestion['questionType'] =
    isHrMode || difficulty === 'behavioral'
      ? 'behavioural'
      : difficulty === 'scenario' || difficulty === 'problem-solving'
      ? 'situational'
      : 'technical';

  let question =
    action === 'reduce_difficulty'
      ? `In ${projectName}, how did you use ${safeTopic}? Keep it simple — what problem did it solve and what was the result?`
      : action === 'clarify'
      ? speechHints.length
        ? `Just to confirm — when you said "${speechHints[0].heard}", did you mean ${speechHints[0].likelyMeant}? In one sentence, how did that step work in ${projectName}?`
        : `In that answer, can you clarify ${safeFocus} with one concrete example from ${projectName}?`
      : action === 'move_topic'
      ? difficulty === 'problem-solving' || /coding|algorithm|dsa/i.test(safeTopic)
        ? `Let's switch gears to a short coding-style question. Given an array of integers and a target, how would you find two numbers that add up to the target? Walk through approach, edge cases, and time complexity.`
        : `Thanks — let's move on. In ${projectName}, what was the hardest technical challenge and how did you solve it?`
      : action === 'challenge' || difficulty === 'scenario'
      ? `Imagine ${safeTopic} breaks in production for ${projectName}. How would you debug it, what would you check first, and what trade-offs would you consider?`
      : difficulty === 'problem-solving'
      ? `Let's do a practical coding-style question for a ${modeGuidance.label} role. Using ${safeTopic}, how would you approach the problem, what edge cases matter, and what's the time/space complexity?`
      : difficulty === 'behavioral' || isHrMode
      ? `Tell me about a time related to ${safeTopic} when something went wrong or you had to push back. What was the situation, what did you do, and what changed afterward?`
      : `In ${projectName}, how did you apply ${safeFocus}? What problem were you solving, what approach did you take, and how did you validate it worked?`;

  if (isMetaInterviewQuestion(question)) {
    question = `In ${alternateProject}, what was your role and what outcome did you deliver?`;
  }

  return {
    question,
    expectedSignals:
      questionType === 'behavioural'
        ? ['STAR structure', 'specific role and action', 'outcome and reflection']
        : ['clear approach', 'concrete project example', 'trade-offs or edge cases'],
    questionType,
    resumeReference: `Follow-up on: ${action === 'move_topic' ? projectName : safeTopic}`,
    difficulty,
    topic: action === 'move_topic' ? projectName : safeTopic,
    followUpIntent:
      action === 'reduce_difficulty'
        ? 'recover-confidence'
        : action === 'move_topic'
        ? 'bridge-topic'
        : action === 'ask_deeper'
        ? 'deepen'
        : 'clarify',
  };
};

const fallbackAdaptiveQuestion = (context: AdaptiveQuestionContext): GeneratedQuestion => {
  const sameTopic = context.lastQuestion.topic || context.lastQuestion.resumeReference || context.roleDomain;
  const exhausted = isTopicExhausted(context, sameTopic);
  const decision = context.followUpDecision ?? decideAdaptiveFollowUp({
    evaluation: context.lastEvaluation,
    lastQuestion: context.lastQuestion,
    position: context.currentQuestionIndex + 1,
    total: context.targetQuestionCount,
  });
  const action = exhausted ? 'move_topic' : decision.action;
  const difficulty = decision.targetDifficulty;
  const coverageTopic = chooseCoverageTopic(context);
  const topic =
    action === 'ask_deeper' || action === 'clarify' || action === 'challenge' || action === 'reduce_difficulty'
      ? sameTopic
      : coverageTopic;

  return buildNaturalFallbackQuestion(context, action, topic, decision.focus, difficulty);
};

const mergeInterviewerReply = (turn: AdaptiveTurnResponse) => {
  if (turn.candidateMessageIntent !== 'question_to_interviewer' || !turn.interviewerReply?.trim()) {
    return turn.question;
  }

  const reply = turn.interviewerReply.trim();
  const nextQuestion = turn.question.question.trim();
  const combined = nextQuestion ? `${reply} ${nextQuestion}` : reply;

  return {
    ...turn.question,
    question: combined,
  };
};

export const generateAdaptiveInterviewQuestion = async (
  context: AdaptiveQuestionContext,
): Promise<AdaptiveTurnResponse> => {
  // Prefer the adaptive decision's difficulty so role-level threading sticks per turn (A11, E16).
  const difficulty =
    context.followUpDecision?.targetDifficulty
    ?? nextDifficulty(
      context.lastQuestion.difficulty,
      context.lastEvaluation,
      context.currentQuestionIndex + 1,
      context.targetQuestionCount,
    );
  const fallbackQuestion = fallbackAdaptiveQuestion(context);
  const fallbackTurn: AdaptiveTurnResponse = {
    candidateMessageIntent: 'answer',
    interviewerReply: null,
    question: fallbackQuestion,
  };

  const jdProfile =
    context.jdProfile ??
    await getCachedJobDescriptionProfile(context.jobDescription, {
      roleLevel: context.roleLevel,
      roleDomain: context.roleDomain,
      resumeSkills: context.resumeSkills,
    });
  const { questions: companyQuestionBank, mode: companyBankMode } = await resolveCompanyQuestionBank(context);
  const systemPrompt = buildInterviewSystemPrompt(
    buildPromptBuilderInput(context, jdProfile, companyQuestionBank, companyBankMode),
  );

  const conversationHistory: ConversationTurn[] = context.transcript.map((item) => ({
    question: item.question,
    answer: item.answer,
    score: item.score,
    topic: item.topic,
    questionType: item.questionType,
  }));

  const previousQuestionTopics = context.previousQuestions
    .map((item) => item.topic ?? item.resumeReference ?? '')
    .filter(Boolean);
  const questionsRemaining = Math.max(0, context.targetQuestionCount - context.currentQuestionIndex - 1);
  const compactState = buildCompactInterviewState({
    interviewId: context.interviewId,
    questionIndex: context.currentQuestionIndex,
    targetQuestionCount: context.targetQuestionCount,
    conversationHistory,
    previousQuestionTopics,
    askedQuestionIds: [
      ...(context.interviewState?.asked_questions ?? []),
      ...context.previousQuestions.map((item) => item.questionId).filter((id): id is string => Boolean(id)),
    ],
    currentTopic: context.lastQuestion.topic ?? context.interviewState?.current_project,
    currentDifficulty: difficulty,
    strengths: context.lastEvaluation.dynamicFeedback?.strengths,
    weaknesses: context.lastEvaluation.dynamicFeedback?.areasToImprove,
    weakAreas: context.lastEvaluation.missingConcepts,
  });

  const userPrompt = buildAdaptiveTurnUserPrompt({
    compactState,
    candidateMessage: context.lastAnswer,
    lastEvaluation: {
      score: context.lastEvaluation.score,
      nextAction: context.lastEvaluation.nextAction,
      missingConcepts: context.lastEvaluation.missingConcepts,
      conceptsCovered: context.lastEvaluation.conceptsCovered,
      feedback: context.lastEvaluation.feedback,
    },
    followUpDecision: context.followUpDecision,
    previousQuestionTopics,
    targetDifficulty: difficulty,
    questionsRemaining,
  });

  return generateJson<AdaptiveTurnResponse>(userPrompt, fallbackTurn, {
    systemPrompt,
    requestType: 'adaptive_question',
    interviewId: context.interviewId,
  })
    .then((result) => {
      const candidate = {
        ...fallbackTurn,
        ...result,
        question: {
          ...fallbackQuestion,
          ...result.question,
          expectedSignals: result.question?.expectedSignals?.length
            ? result.question.expectedSignals
            : fallbackQuestion.expectedSignals,
        },
      };

      const projects = context.resumeProfile?.projects ?? context.interviewRoadmap?.resumeProfile.projects ?? [];
      const normalizedCandidate = canonicalize(candidate.question.question).toLowerCase().replace(/[?.!]+$/g, '');
      const repeatedQuestion = context.previousQuestions.some(
        (item) => canonicalize(item.question).toLowerCase().replace(/[?.!]+$/g, '') === normalizedCandidate,
      );
      const introAgain =
        context.previousQuestions.length > 0
        && /tell me about yourself|introduce yourself|walk me through your (background|education)/i.test(
          candidate.question.question || '',
        );
      const metaQuestion = isMetaInterviewQuestion(candidate.question.question);
      const exhaustedLast = isTopicExhausted(context, context.lastQuestion.topic || context.lastQuestion.resumeReference);
      const exhaustedCandidate = isTopicExhausted(context, candidate.question.topic);
      const sameProjectAsLast = Boolean(
        sharedProjectName(
          `${candidate.question.question} ${candidate.question.topic || ''}`,
          `${context.lastQuestion.question} ${context.lastQuestion.topic || ''}`,
          projects,
        ),
      );
      const stickyProject = exhaustedLast && sameProjectAsLast;
      const forceMove =
        repeatedQuestion
        || introAgain
        || metaQuestion
        || stickyProject
        || (exhaustedCandidate && sameCoverageTopic(candidate.question.topic, context.lastQuestion.topic))
        || context.followUpDecision?.action === 'move_topic' && sameProjectAsLast;

      if (forceMove) {
        const alternate = fallbackAdaptiveQuestion({
          ...context,
          followUpDecision: {
            ...(context.followUpDecision ?? decideAdaptiveFollowUp({
              evaluation: context.lastEvaluation,
              lastQuestion: context.lastQuestion,
              position: context.currentQuestionIndex + 1,
              total: context.targetQuestionCount,
              transcript: context.transcript,
              resumeProjects: projects,
            })),
            action: 'move_topic',
          },
        });
        const alternateRepeated = context.previousQuestions.some((item) =>
          isNearDuplicateQuestion(item.question, alternate.question),
        );
        const alternateMeta = isMetaInterviewQuestion(alternate.question);
        return alternateRepeated || alternateMeta
          ? { ...fallbackTurn, question: { ...fallbackQuestion, topic: alternate.topic, question: alternate.question } }
          : { ...fallbackTurn, question: alternate };
      }

      const mergedQuestion = mergeInterviewerReply(candidate);
      if (isMetaInterviewQuestion(mergedQuestion.question)) {
        return { ...fallbackTurn, question: fallbackQuestion };
      }

      return {
        ...candidate,
        question: {
          ...mergedQuestion,
          questionType: inferQuestionTypeFromContent(
            mergedQuestion.question,
            context.interviewMode,
            mergedQuestion.questionType,
          ),
        },
      };
    });
};

export type WritingEvaluation = {
  score: number;
  feedback: string;
  strengths: string[];
  improvements: string[];
  grammarScore: number;
  vocabularyScore: number;
  coherenceScore: number;
  taskAchievementScore: number;
};

export const evaluateWriting = (prompt: string, level: string, criteria: string, userText: string) =>
  generateJson<WritingEvaluation>(
    `You are an English language writing examiner. Evaluate the following student writing response.

CEFR Level: ${level}
Task prompt: ${prompt}
Evaluation criteria: ${criteria}
Student response: ${userText}

Return a JSON object with:
- score (0-100 overall)
- feedback (2-3 sentences of actionable feedback)
- strengths (array of 2 specific strengths)
- improvements (array of 2 specific improvements)
- grammarScore (0-100)
- vocabularyScore (0-100)
- coherenceScore (0-100)
- taskAchievementScore (0-100)

Be fair but honest. A short or off-topic response should score low. A well-structured, appropriate response should score high.`,
    {
      score: Math.min(80, Math.max(30, Math.round(userText.split(/\s+/).length * 1.5))),
      feedback: 'Your response shows effort. Focus on organising your ideas clearly and using vocabulary appropriate for your level.',
      strengths: ['Shows an attempt to address the prompt', 'Uses basic sentence structures'],
      improvements: ['Develop your ideas with more specific details', 'Check grammar and punctuation carefully'],
      grammarScore: 60,
      vocabularyScore: 60,
      coherenceScore: 55,
      taskAchievementScore: 60,
    },
    { requestType: 'writing_evaluation' },
  );

export const generateReport = (
  transcript: ReportTranscriptItem[],
  reportContext: ReportGenerationContext = {},
) => {
  // Meta/process prompts are not scored interview questions — exclude from averages.
  const scoredTranscript = transcript.filter((t) => !isMetaInterviewQuestion(t.question));
  const answeredCount = scoredTranscript.filter((t) => isSubstantiveReportAnswer(t.answer)).length;
  const totalCount = reportContext.totalPlannedQuestions ?? scoredTranscript.length;
  const participationRatio = totalCount > 0 ? answeredCount / totalCount : 0;
  const scoreableItems = scoredTranscript.filter(
    (t) => typeof t.score === 'number' && Number.isFinite(t.score),
  );

  // If nothing was attempted/scored, return a zero-score report immediately
  if (scoreableItems.length === 0) {
    const sessionFields = reportContext.sessionMeta ?? {};
    return Promise.resolve<InterviewReport>({
      communicationScore: 0,
      technicalScore: 0,
      behavioralScore: 0,
      confidenceScore: 0,
      grammarScore: 0,
      vocabularyScore: 0,
      domainExpertiseScore: 0,
      overallScore: 0,
      strengths: [],
      improvements: [
        "You didn't submit answers I could score — restart when you're ready.",
        'Take one question at a time instead of skipping ahead.',
        'For behavioral prompts, jot a quick STAR outline before you speak.',
      ],
      recommendations: [
        'Run the interview again and answer each question out loud.',
        'Prepare 2-3 project stories with metrics before your next attempt.',
        'Use the per-question feedback from this session as a checklist.',
      ],
      transcriptSummary:
        "You didn't answer any scored questions this time, so there's nothing to evaluate yet. When you're ready, try again and work through each prompt — even a partial answer gives us something useful to coach on.",
      skillWiseStrengths: [],
      areasForImprovement: ['Answer each question with a complete, role-relevant response.'],
      missedConcepts: transcript.map((t) => t.topic || t.resumeReference || t.question).filter(Boolean),
      recommendedLearningResources: [
        'Practice role fundamentals from the job description.',
        'Prepare project walkthroughs using the STAR method.',
        'Record short spoken answers and review clarity, structure, and terminology.',
      ],
      difficultyProgression: transcript.map((t) => t.difficulty ?? 'unknown'),
      questionTimeline: transcript.map((t) => ({
        question: t.question,
        topic: t.topic ?? t.resumeReference ?? 'general',
        difficulty: t.difficulty ?? 'unknown',
        score: 0,
      })),
      followUpQuality: 'No follow-up quality could be assessed because no answers were provided.',
      hiringRecommendation: 'No Hire',
      hiringRecommendationReason: 'The candidate did not provide enough evidence to evaluate readiness.',
      questionAnalysis: transcript.map(t => ({
        question: t.question,
        answer: t.answer ?? '(no answer)',
        score: 0,
        feedback: 'No answer was provided for this question.',
        whatWorked: 'Nothing — no answer was given.',
        whatToImprove: 'Provide a substantive answer addressing the question directly.',
        questionType: t.questionType ?? 'general',
        resumeReference: t.resumeReference ?? 'general',
        idealAnswer: t.idealAnswer,
        samplePerfectAnswer: t.samplePerfectAnswer,
        conceptsCovered: [],
        missingConcepts: t.missingConcepts ?? [t.topic ?? t.resumeReference ?? 'Expected answer content'],
        incorrectStatements: [],
        wrongTerminology: [],
        technicalMistakes: [],
        dynamicFeedback: t.dynamicFeedback,
      })),
      ...sessionFields,
    });
  }

  // For the per-question scores already computed by evaluateAnswer, use them as ground truth
  const precomputedAvg =
    scoreableItems.reduce((sum, t) => sum + (t.score ?? 0), 0) / Math.max(1, scoreableItems.length);
  const difficultyProgression = buildDifficultyProgressionSummary(transcript);
  const questionTimeline = transcript.map((t) => ({
    question: t.question,
    topic: t.topic ?? t.resumeReference ?? 'general',
    difficulty: t.difficulty ?? 'unknown',
    score: t.score ?? 0,
  }));
  const speakerLabel = reportContext.speakerName || reportContext.accountOwnerName || 'You';

  return generateJson<InterviewReport>(
    buildReportGenerationPrompt({
      transcript,
      speakerLabel,
      accountOwnerName: reportContext.accountOwnerName,
      answeredCount,
      totalCount,
      participationRatio,
      precomputedAvg,
      resumeProjects: reportContext.resumeProjects,
      resumeSkills: reportContext.resumeSkills,
    }),
    {
      communicationScore: Math.round(precomputedAvg * 0.9),
      technicalScore: Math.round(precomputedAvg * 0.9),
      behavioralScore: Math.round(precomputedAvg * 0.9),
      confidenceScore: Math.round(precomputedAvg * 0.85),
      grammarScore: Math.round(precomputedAvg * 0.9),
      vocabularyScore: Math.round(precomputedAvg * 0.9),
      domainExpertiseScore: Math.round(precomputedAvg * 0.9),
      overallScore: Math.round(precomputedAvg),
      strengths: answeredCount > 0 ? ['Some questions were attempted'] : [],
      improvements: ['Provide specific, structured answers to each question', 'Use the STAR method for behavioral questions'],
      recommendations: ['Practice answering interview questions aloud', 'Prepare concrete examples from past experience'],
      transcriptSummary: `The candidate answered ${answeredCount} of ${totalCount} questions with an average score of ${Math.round(precomputedAvg)}.`,
      skillWiseStrengths: transcript
        .filter((t) => (t.score ?? 0) >= 65)
        .slice(0, 5)
        .map((t) => ({
          skill: t.topic ?? t.resumeReference ?? 'general',
          evidence: t.feedback ?? 'Relevant answer content was provided.',
          score: t.score ?? 0,
        })),
      areasForImprovement: ['Add more concrete examples', 'Explain trade-offs and edge cases', 'Structure behavioral responses with STAR'],
      missedConcepts: transcript.filter((t) => (t.score ?? 0) < 60).map((t) => t.topic ?? t.resumeReference ?? t.question).slice(0, 8),
      recommendedLearningResources: ['Review the job description skill list', 'Practice project deep-dives aloud', 'Prepare concise STAR stories'],
      difficultyProgression,
      questionTimeline,
      followUpQuality: 'Follow-up quality is inferred from the adaptive question sequence and answer depth.',
      hiringRecommendation:
        precomputedAvg >= 85 ? 'Strong Hire' : precomputedAvg >= 70 ? 'Hire' : precomputedAvg >= 50 ? 'Borderline' : 'No Hire',
      hiringRecommendationReason: `Recommendation is based on the average evaluated score of ${Math.round(precomputedAvg)} and ${answeredCount}/${totalCount} answered questions.`,
      questionAnalysis: transcript.map(t => ({
        question: t.question,
        answer: t.answer ?? '(no answer)',
        score: t.score ?? 0,
        feedback: t.feedback ?? 'No answer was provided.',
        whatWorked: t.dynamicFeedback?.strengths?.[0] ?? (t.score && t.score > 40 ? 'Some relevant content was provided' : 'Nothing — no meaningful answer was given.'),
        whatToImprove: t.dynamicFeedback?.areasToImprove?.[0] ?? 'Provide a complete, structured answer with specific examples.',
        questionType: t.questionType ?? 'general',
        resumeReference: t.resumeReference ?? 'general',
        idealAnswer: t.idealAnswer,
        samplePerfectAnswer: t.samplePerfectAnswer,
        conceptsCovered: t.conceptsCovered ?? [],
        missingConcepts: t.missingConcepts ?? [],
        incorrectStatements: t.incorrectStatements ?? [],
        wrongTerminology: t.wrongTerminology ?? [],
        technicalMistakes: t.technicalMistakes ?? [],
        dynamicFeedback: t.dynamicFeedback,
      })),
    },
    {
      temperature: 0.35,
      requestType: 'interview_report',
      interviewId: reportContext.interviewId,
    },
  ).then((report) => {
    const analysis = report.questionAnalysis?.length ? report.questionAnalysis : [];
    const questionAnalysis = transcript.map((item, index) => {
      const merged = {
        ...(analysis[index] ?? {
          question: item.question,
          answer: item.answer ?? '(no answer)',
          score: item.score ?? 0,
          feedback: item.feedback ?? 'No answer was provided.',
          whatWorked: item.dynamicFeedback?.strengths?.[0] ?? 'No specific strength recorded.',
          whatToImprove: item.dynamicFeedback?.areasToImprove?.[0] ?? 'Provide a complete, structured answer with specific examples.',
          questionType: item.questionType ?? 'general',
          resumeReference: item.resumeReference ?? 'general',
        }),
        idealAnswer: item.idealAnswer ?? analysis[index]?.idealAnswer,
        samplePerfectAnswer: item.samplePerfectAnswer ?? analysis[index]?.samplePerfectAnswer,
        conceptsCovered: item.conceptsCovered ?? analysis[index]?.conceptsCovered ?? [],
        missingConcepts: item.missingConcepts ?? analysis[index]?.missingConcepts ?? [],
        incorrectStatements: item.incorrectStatements ?? analysis[index]?.incorrectStatements ?? [],
        wrongTerminology: item.wrongTerminology ?? analysis[index]?.wrongTerminology ?? [],
        technicalMistakes: item.technicalMistakes ?? analysis[index]?.technicalMistakes ?? [],
        dynamicFeedback: item.dynamicFeedback ?? analysis[index]?.dynamicFeedback,
      };

      if (isMetaInterviewQuestion(item.question)) {
        merged.score = 0;
        merged.feedback = 'This was a process prompt, not an interview question, so it was not scored.';
        merged.whatWorked = 'N/A — not an interview question.';
        merged.whatToImprove = 'Interviewers should continue with a real project, coding, company, or HR question.';
        merged.idealAnswer =
          'Ask a substantive interview question instead of "Are you ready to proceed?" prompts.';
        merged.samplePerfectAnswer = 'No candidate rewrite needed for a process prompt.';
      } else {
        merged.score = Number.isFinite(Number(item.score)) ? Number(item.score) : Number(merged.score) || 0;
        merged.answer = item.answer ?? merged.answer;
        merged.feedback = item.feedback || merged.feedback;
        const ideal = String(merged.idealAnswer || '').trim();
        let improved = String(merged.samplePerfectAnswer || '').trim();
        if (!improved || improved === ideal) {
          improved = buildSuggestedImprovedAnswerFallback(
            item.question,
            item.answer || '',
            {
              topic: item.topic,
              resumeProjects: reportContext.resumeProjects,
              resumeSkills: reportContext.resumeSkills,
              expectedSignals: item.missingConcepts,
            },
            item.missingConcepts || [],
          );
        }
        const grounding = {
          projects: reportContext.resumeProjects,
          skills: reportContext.resumeSkills,
          answer: item.answer || '',
          question: item.question,
        };
        merged.idealAnswer = sanitizeGroundedFeedbackText(
          ideal || buildIdealAnswerFallback(item.question, {
            topic: item.topic,
            resumeProjects: reportContext.resumeProjects,
            resumeSkills: reportContext.resumeSkills,
          }),
          grounding,
        );
        merged.samplePerfectAnswer = sanitizeGroundedFeedbackText(improved, grounding);
        if (
          merged.samplePerfectAnswer.trim()
          && merged.samplePerfectAnswer.trim() === merged.idealAnswer.trim()
        ) {
          merged.samplePerfectAnswer = sanitizeGroundedFeedbackText(
            buildSuggestedImprovedAnswerFallback(
              item.question,
              item.answer || '',
              {
                topic: item.topic,
                resumeProjects: reportContext.resumeProjects,
                resumeSkills: reportContext.resumeSkills,
                expectedSignals: item.missingConcepts,
              },
              item.missingConcepts || [],
            ),
            grounding,
          );
        }
      }

      return {
        ...merged,
        questionType: inferQuestionTypeFromContent(
          item.question,
          reportContext.interviewMode,
          merged.questionType,
        ),
      };
    });

    const strengths = aggregateSessionStrengths(
      transcript,
      questionAnalysis.map((item) => item.whatWorked),
    );
    const companyReadinessScore = computeCompanyReadinessScore(transcript, {
      targetCompany: reportContext.targetCompany,
      overallScore: Math.round(precomputedAvg),
    });
    if (
      process.env.NODE_ENV !== 'production' &&
      reportContext.targetCompany &&
      companyReadinessScore === Math.round(precomputedAvg)
    ) {
      console.warn(
        '[report] companyReadinessScore equals overallScore — verify company-specific evidence was captured.',
        { overallScore: Math.round(precomputedAvg), companyReadinessScore, targetCompany: reportContext.targetCompany },
      );
    }

    return refineInterviewReport(
      {
        ...report,
        difficultyProgression,
        questionTimeline,
        companyReadinessScore,
        speakerName: reportContext.speakerName,
        accountOwnerName: reportContext.accountOwnerName,
        questionAnalysis,
        strengths: report.strengths?.length
          ? [...new Set([...report.strengths, ...strengths])].slice(0, 4)
          : strengths,
        ...(reportContext.sessionMeta ?? {}),
      },
      {
        transcript: scoredTranscript,
        answeredCount,
        totalCount,
        participationRatio,
        speakerName: reportContext.speakerName,
        liveScores: reportContext.liveScores,
        endedEarly: reportContext.sessionMeta?.endedEarly,
        sessionNote: reportContext.sessionMeta?.sessionNote,
      },
    );
  });
};

export const analyzeResume = async (
  resumeText: string,
  options?: { userId?: string; interviewId?: string },
): Promise<ResumeAnalysis> => {
  const heuristicSkills = extractResumeSkillsHeuristic(resumeText);
  const contentHash = normalizeContentHash(resumeText);
  const cacheKey = options?.userId ? buildResumeAnalysisCacheKey(options.userId, contentHash) : null;

  if (cacheKey) {
    try {
      const cached = await getAiContextCache<ResumeAnalysis>(cacheKey);
      if (cached) return cached;
    } catch {
      // Continue without cache.
    }
  }

  const fallbackAnalysis: ResumeAnalysis = {
    summary: heuristicSkills.length
      ? 'Resume skills extracted locally. Add AI credentials for a deeper analysis.'
      : 'Resume uploaded successfully. Add API credentials for a full AI analysis.',
    skills: heuristicSkills,
    experienceLevel: /b\.?\s*tech|student|undergraduate|graduate/i.test(resumeText) ? 'Student' : 'Unknown',
    yearsOfExperience: 0,
    score: heuristicSkills.length ? Math.min(85, 55 + heuristicSkills.length) : 60,
    strengths: heuristicSkills.slice(0, 4).length
      ? heuristicSkills.slice(0, 4).map((skill) => `Hands-on exposure to ${skill}`)
      : ['Readable resume structure'],
    gaps: ['AI provider is not configured, so deep narrative analysis is unavailable'],
    suggestedQuestions: heuristicSkills.slice(0, 3).map((skill) => `Tell me about a project where you used ${skill}.`),
  };

  const analysis = await generateJson<ResumeAnalysis>(
    `You are a senior technical recruiter and resume analyst. Perform a COMPLETE, EXHAUSTIVE analysis of the following resume.

RESUME TEXT (full document):
---
${resumeText}
---

YOUR TASK — read every line and extract ALL of the following:

1. SKILLS — list EVERY technical and professional skill mentioned anywhere in the resume:
   - Programming languages (e.g. Python, Java, TypeScript, C++, Go, Rust)
   - Frameworks & libraries (e.g. React, Node.js, Spring Boot, Django, TensorFlow)
   - Databases (e.g. PostgreSQL, MongoDB, Redis, MySQL, Cassandra)
   - Cloud & DevOps (e.g. AWS, GCP, Azure, Docker, Kubernetes, CI/CD, Terraform)
   - Tools (e.g. Git, Jira, Figma, Postman, VS Code)
   - Methodologies (e.g. Agile, Scrum, TDD, REST, GraphQL, Microservices)
   - Soft skills ONLY if explicitly stated (e.g. Leadership, Mentoring, Communication)
   - Domain-specific skills (e.g. Machine Learning, System Design, Data Structures, Algorithms)
   - Certifications and their relevant skills
   RULES for skills:
   - Include ALL skills you find — do NOT skip any
   - Use the canonical name: "JavaScript" not "js", "PostgreSQL" not "postgres"
   - Do NOT invent skills not present in the resume
   - Do NOT deduplicate variations — list "React" and "React.js" as just "React"
   - Minimum 10 skills if the resume is non-trivial; list everything you find
   - Order by strength/prominence (most-used or most-emphasized first)

2. EXPERIENCE LEVEL — classify as exactly one of: "Student", "Fresher", "Junior", "Mid", "Senior", "Lead", "Principal", "Executive"
   - Base on total years of work experience and role titles
   - Internships count as 0.5 years each

3. YEARS OF EXPERIENCE — total professional experience as a number (0 for students/freshers with only internships < 1yr)

4. SUMMARY — 2-3 sentences describing who this person is, their strongest domain, and their career stage

5. STRENGTHS — 3-5 specific, evidence-based strengths (reference actual projects/roles from the resume)

6. GAPS — 2-4 areas that are missing or weak compared to a typical candidate at this level

7. SUGGESTED QUESTIONS — generate 8-10 targeted interview questions that are SPECIFIC to THIS resume:
   - Each question must reference a specific project, technology, company, or role from THIS resume — never a date, month, or year from the resume
   - Anchor to entities (company/project/certification), not time periods (wrong: "In 2023 at X"; right: "During your internship at X")
   - Mix technical deep-dives, behavioral STAR questions, and situational scenarios
   - Questions must be distinct and non-overlapping
   - Order: warm-up → core technical → behavioral → challenging

Return ONLY this exact JSON (no markdown, no preamble):
{
  "summary": string,
  "skills": string[],
  "experienceLevel": string,
  "yearsOfExperience": number,
  "score": number (0-100 resume quality/completeness score),
  "strengths": string[],
  "gaps": string[],
  "suggestedQuestions": string[]
}`,
    fallbackAnalysis,
    {
      requestType: 'resume_analysis',
      interviewId: options?.interviewId,
      userIdHash: hashUserIdForTelemetry(options?.userId),
    },
  );

  const normalized = !analysis.skills?.length || isSoftSkillOnlyFallback(analysis.skills)
    ? {
      ...analysis,
      skills: heuristicSkills,
      suggestedQuestions: (analysis.suggestedQuestions ?? [])
        .map((question) => sanitizeDateAnchoredQuestionText({ question }) ?? null)
        .filter((question): question is string => Boolean(question)),
    }
    : {
      ...analysis,
      skills: unique([...analysis.skills, ...heuristicSkills]).slice(0, 40),
      suggestedQuestions: (analysis.suggestedQuestions ?? [])
        .map((question) => sanitizeDateAnchoredQuestionText({ question }) ?? null)
        .filter((question): question is string => Boolean(question)),
    };

  if (cacheKey) {
    try {
      await setAiContextCache({
        cacheKey,
        kind: 'resume_analysis',
        contentHash,
        payload: normalized as unknown as Record<string, unknown>,
        userId: options?.userId,
      });
    } catch {
      // Cache is best-effort.
    }
  }

  return normalized;
};

export type QuestionBankGenerateInput = {
  roleTopic: string;
  company?: string;
  category: string;
  difficulty: string;
  count: number;
};

export const generateQuestionBankCandidates = async (input: QuestionBankGenerateInput) => {
  const count = Math.min(10, Math.max(1, input.count));
  const prompt = [
    `Generate ${count} distinct interview questions.`,
    `Role/topic: ${input.roleTopic}`,
    `Category: ${input.category}`,
    `Difficulty: ${input.difficulty}`,
    input.company ? `Company context: ${input.company}` : 'No specific company.',
    'Return strict JSON: { "questions": [{ "text": string, "category": string, "difficulty": string, "company": string, "tags": string[] }] }',
    'Questions must be realistic, non-duplicative, and suitable for live interviews.',
  ].join('\n');

  const fallback = {
    questions: Array.from({ length: count }, (_, index) => ({
      text: `[Fallback] ${input.roleTopic} question ${index + 1} (${input.difficulty} ${input.category})`,
      category: input.category,
      difficulty: input.difficulty,
      company: input.company || '',
      tags: ['fallback'],
    })),
  };

  const payload = await generateJson<{ questions: Array<{
    text: string;
    category: string;
    difficulty: string;
    company?: string;
    tags?: string[];
  }> }>(prompt, fallback, {
    systemPrompt: 'You generate interview question bank entries. Return JSON only.',
    temperature: 0.7,
    requestType: 'question_bank_preview',
  });

  return (payload.questions || []).slice(0, count).map((item) => ({
    text: String(item.text || '').trim(),
    category: item.category || input.category,
    difficulty: item.difficulty || input.difficulty,
    company: item.company || input.company || '',
    tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
  })).filter((item) => item.text.length >= 8);
};
