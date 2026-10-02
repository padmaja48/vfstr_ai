import type { JobDescriptionProfile, ResumeInterviewProfile } from './ai.service';
import {
  buildCompactInterviewState,
  formatCompactInterviewStateBlock,
  type CompactInterviewState,
} from './compactInterviewState';

export type InterviewPromptType = 'technical' | 'behavioral' | 'mixed';
export type ExperienceLevel = 'fresher' | 'experienced';

export type CompanyQuestionEntry = {
  question: string;
  type: 'behavioral' | 'technical' | 'situational' | 'coding' | 'system_design';
  source?: string;
  questionId?: string;
  bankQuestionId?: string;
};

export type ConversationTurn = {
  question: string;
  answer?: string;
  score?: number;
  topic?: string;
  questionType?: string;
};

export type PromptBuilderInput = {
  candidateResume: ResumeInterviewProfile | {
    summary?: string;
    skills?: string[];
    rawText?: string;
  };
  jobDescription?: string;
  jdProfile?: JobDescriptionProfile;
  company?: string;
  role: string;
  experienceLevel: ExperienceLevel;
  companyQuestionBank: CompanyQuestionEntry[] | null;
  companyBankMode: 'verified' | 'web_research' | 'role_based' | 'generic' | 'none';
  interviewType: InterviewPromptType;
  personaId?: string;
  personaPersonality?: string;
  interviewModeLabel?: string;
  interviewModeTemplate?: string;
  complexity?: string;
  roleLevel?: string;
  previouslyAskedQuestions?: string[];
};

const PERSONA_NAMES: Record<string, string> = {
  'us-american': 'Ryan Carter',
  'us-indian': 'Priya Sharma',
  'us-australian': 'Ananya Rao',
  'ru-russian': 'Rahul Menon',
};

const FORBIDDEN_TRANSITION_PHRASES = [
  "Let's make that more concrete",
  'You touched on',
  'Good, let\'s connect',
  'Thanks, let\'s connect',
  'Since your last answer',
  'You mentioned',
  'Let\'s go one level deeper on',
];

export const mapExperienceLevel = (roleLevel?: string): ExperienceLevel =>
  roleLevel === 'Fresher' ? 'fresher' : 'experienced';

export const mapInterviewPromptType = (interviewType?: string): InterviewPromptType => {
  if (interviewType === 'Technical') return 'technical';
  if (interviewType === 'Behavioural') return 'behavioral';
  return 'mixed';
};

const isStructuredResume = (
  resume: PromptBuilderInput['candidateResume'],
): resume is ResumeInterviewProfile => 'projects' in resume && 'skills' in resume;

const formatStructuredResume = (resume: ResumeInterviewProfile) => {
  const { candidateInformation, skills, projects, internships, workExperience, certifications, coursework } = resume;
  return [
    candidateInformation.name ? `Name: ${candidateInformation.name}` : '',
    candidateInformation.college ? `Education: ${candidateInformation.college}` : '',
    candidateInformation.degree ? `Degree: ${candidateInformation.degree}` : '',
    candidateInformation.branch ? `Branch: ${candidateInformation.branch}` : '',
    candidateInformation.cgpa ? `CGPA: ${candidateInformation.cgpa}` : '',
    projects.length ? `Projects (cite these by name):\n${projects.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}` : '',
    internships.length ? `Internships:\n${internships.map((item) => `  - ${item}`).join('\n')}` : '',
    workExperience.length ? `Work Experience:\n${workExperience.map((item) => `  - ${item}`).join('\n')}` : '',
    certifications.length ? `Certifications: ${certifications.join('; ')}` : '',
    coursework.length ? `Coursework: ${coursework.join(', ')}` : '',
    `Tech stack — Languages: ${skills.programmingLanguages.join(', ') || 'none listed'}`,
    `Frameworks: ${skills.frameworks.join(', ') || 'none listed'}`,
    `Databases: ${skills.databases.join(', ') || 'none listed'}`,
    `Cloud/DevOps: ${skills.cloudTechnologies.join(', ') || 'none listed'}`,
    `Tools: ${skills.developerTools.join(', ') || 'none listed'}`,
  ]
    .filter(Boolean)
    .join('\n');
};

const formatResumeBlock = (resume: PromptBuilderInput['candidateResume']) => {
  if (isStructuredResume(resume)) {
    return formatStructuredResume(resume);
  }

  return [
    resume.summary ? `Summary: ${resume.summary}` : '',
    resume.skills?.length ? `Skills: ${resume.skills.join(', ')}` : '',
    resume.rawText ? `Full resume text:\n${resume.rawText}` : '',
  ]
    .filter(Boolean)
    .join('\n');
};

const formatJdBlock = (jobDescription?: string, jdProfile?: JobDescriptionProfile) => {
  if (!jobDescription?.trim() && !jdProfile) return 'No job description provided. Use role and resume only.';

  return [
    jobDescription?.trim() ? `Full job description:\n${jobDescription.trim()}` : '',
    jdProfile
      ? `Extracted requirements — Required: ${jdProfile.requiredSkills.join(', ') || 'none'}; Tools: ${jdProfile.toolsTechnologies.join(', ') || 'none'}; Responsibilities: ${jdProfile.responsibilities.slice(0, 6).join('; ') || 'none'}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
};

const formatCompanyBankBlock = (
  company: string | undefined,
  bank: CompanyQuestionEntry[] | null,
  mode: PromptBuilderInput['companyBankMode'],
) => {
  if (!bank?.length) {
    return company
      ? `COMPANY MODE: role-based for "${company}". Do NOT invent fake "official ${company} interview questions". Ask strong role-based questions a company like ${company} would emphasize (fundamentals, projects, coding, ownership). Never use empty meta prompts like "company-style expectations".`
      : 'COMPANY MODE: No target company selected. Ask role-appropriate questions grounded in resume and JD.';
  }

  const label =
    mode === 'verified'
      ? `VERIFIED REFERENCE QUESTIONS for ${company} (candidate-reported style bank — match STYLE/DIFFICULTY, paraphrase lightly, do NOT claim they are official ${company} questions, do NOT copy verbatim):`
      : mode === 'web_research'
      ? `WEB-RESEARCHED REFERENCE QUESTIONS for ${company} (from public sources — use for STYLE/TOPICS, paraphrase lightly, do NOT claim official/guaranteed ${company} questions):`
      : mode === 'role_based'
      ? `ROLE-BASED REFERENCE QUESTIONS for a company like ${company} (honest role-shaped prompts — do NOT pretend these are official ${company} questions):`
      : `GENERIC INDUSTRY REFERENCE QUESTIONS (not company-specific — match difficulty/style only):`;

  return `${label}
RULES FOR USING THIS BANK:
- Prefer these topics/styles when asking company-flavored questions.
- Paraphrase lightly so it does not feel copy-pasted.
- Tie at least one follow-up to a specific resume project/tech.
- Never invent "Google/Amazon always asks X" claims beyond this bank.
- Never ask meta filler like "demonstrate interview expectations".

${bank
    .map(
      (entry, index) =>
        `${index + 1}. [${entry.type}${entry.source ? `, ${entry.source}` : ''}] ${entry.question}`,
    )
    .join('\n')}`;
};

const technicalMixRule = (interviewType: InterviewPromptType, role: string, experienceLevel: ExperienceLevel) => {
  const isTechnicalRole = /\b(?:software|sde|developer|engineer|frontend|backend|full\s*stack|data|ml|ai|devops|cloud|qa|sdet|architect|programmer)\b/i.test(role);
  if (!isTechnicalRole || interviewType === 'behavioral') {
    return 'Focus on behavioral STAR questions and situational judgment. No coding/DSA unless the JD explicitly requires it.';
  }

  if (interviewType === 'technical') {
    return experienceLevel === 'fresher'
      ? 'Include at least 2 genuine DSA/coding questions (approach + complexity, not definitions). Include 1 system-design-lite or architecture question tied to a resume project. Mix role-specific technical depth (APIs, databases, concurrency as relevant).'
      : 'Include at least 2 DSA/coding questions at appropriate depth, 1 system design or architecture question with trade-offs, and senior-level ownership/technical-decision probes.';
  }

  return experienceLevel === 'fresher'
    ? 'Mix roughly 40% behavioral STAR and 60% technical. Include at least 1-2 DSA/coding questions and project-grounded technical questions.'
    : 'Mix behavioral and technical. Include at least 1-2 DSA/coding questions, system design scaled to experience, and depth on past technical decisions.';
};

export const formatConversationHistory = (turns: ConversationTurn[]) => {
  if (!turns.length) return 'No prior conversation yet.';

  return turns
    .map((turn, index) => {
      const answer = turn.answer?.trim() || '(no answer yet)';
      return `Turn ${index + 1}:
Interviewer: ${turn.question}
Candidate: ${answer}${typeof turn.score === 'number' ? `\n(Evaluation score: ${turn.score})` : ''}`;
    })
    .join('\n\n');
};

export function buildInterviewSystemPrompt(input: PromptBuilderInput): string {
  const personaName = input.personaId ? (PERSONA_NAMES[input.personaId] ?? 'Alex Morgan') : 'Alex Morgan';
  const modeLabel = input.interviewModeLabel ?? 'Software Development Engineer';
  const modeTemplate =
    input.interviewModeTemplate ??
    'Use a balanced SDE loop: fundamentals, coding reasoning, projects, and ownership.';
  const experienceTone =
    input.experienceLevel === 'fresher'
      ? 'Candidate is a fresher/early-career. Prioritize fundamentals, coursework, internships, and personal projects. Avoid senior system-design pressure unless JD demands it.'
      : 'Candidate is experienced. Probe depth, trade-offs, past ownership, cross-team decisions, and production impact.';

  const companyLine = input.company
    ? input.companyBankMode === 'verified'
      ? `You are interviewing for ${input.company}. Match verified bank STYLE/DIFFICULTY; paraphrase lightly; do not invent official ${input.company} questions beyond those references.`
      : input.companyBankMode === 'web_research'
      ? `You are interviewing for ${input.company}. Use web-researched public patterns for style/topics only — never claim questions are official or guaranteed.`
      : input.companyBankMode === 'role_based'
      ? `Target company "${input.company}" uses role-based questions (no strong company bank). Ask what a strong ${input.role} screen would ask — do not fake company-specific claims.`
      : `Target company "${input.company}" was selected but bank coverage is thin. Be honest: role-based questions only, no fake company claims.`
    : 'No specific company target. Focus on role, resume, and JD.';

  return `You are ${personaName}, a real human interviewer conducting a live mock interview. You are NOT an AI assistant. Never say you are an AI, never mention prompts, models, or JSON.

PERSONA: ${input.personaPersonality || 'Professional, conversational, probing — like a real hiring manager.'}
ROLE: ${input.role} (${input.roleLevel ?? input.experienceLevel})
INTERVIEW TYPE: ${input.interviewType}
ROLE MODE: ${modeLabel} — ${modeTemplate}
COMPLEXITY: ${input.complexity ?? 'Intermediate'}
${companyLine}

CANDIDATE RESUME (use exact project names, technologies, companies, and schools — never paraphrase into generic categories):
${formatResumeBlock(input.candidateResume)}

JOB DESCRIPTION:
${formatJdBlock(input.jobDescription, input.jdProfile)}

${formatCompanyBankBlock(input.company, input.companyQuestionBank, input.companyBankMode)}

${
  input.previouslyAskedQuestions?.length
    ? `PREVIOUSLY ASKED QUESTIONS (this candidate — do NOT repeat or ask near-duplicates; cover different projects, skills, and angles):
${input.previouslyAskedQuestions
    .slice(0, 24)
    .map((question, index) => `${index + 1}. ${question}`)
    .join('\n')}`
    : ''
}

INTERVIEW RULES:
1. Ask ONE question at a time. Wait for the candidate's response before the next question.
2. Sound like a REAL hiring interview — the kind asked at product/service companies (project deep-dives, coding approach, trade-offs, behavioral STAR, "why this role/company").
3. Reference SPECIFIC resume details — actual project names, tech stack items, internship companies. Prefer project/tech questions over degree/college name alone.
4. Align questions with JD requirements when a JD is provided.
5. ${technicalMixRule(input.interviewType, input.role, input.experienceLevel)}
6. ${experienceTone}
7. Match reference question STYLE and DIFFICULTY — never copy reference questions verbatim. Prefer company/reference bank wording when available.
8. Follow-ups must react to what the candidate ACTUALLY said — quote a specific detail. Never use boilerplate transition phrases.
9. FORBIDDEN PHRASES (never use these or close variants): ${FORBIDDEN_TRANSITION_PHRASES.map((p) => `"${p}"`).join(', ')}, "You brought up", "accurate concept explanation", "company-style expectations", "I'd like more detail on clear career summary".
10. Vary your transitions naturally — each follow-up should sound like a real person thinking in the moment.
11. If the candidate asks YOU a question, answer briefly in-character, then ask the NEXT real interview question (never "Are you ready to proceed?").
12. If the answer is vague: ONE clarifying probe only (example/metric/trade-off), then move to a different project, coding, company, or HR topic.
13. Never ask standalone textbook definitions ("What is OOP?") — ask how they used the idea in a named project or interview-style coding problem.
14. For coding/DSA: pose a concrete problem or ask approach + edge cases + time/space complexity. Do not give solutions.
15. Do NOT re-ask "Tell me about yourself" after the opening. Do NOT ask meta filler ("ready to proceed", "interview expectations").
16. Speech-to-text errors are common. If a word sounds wrong in context (e.g. "voltage" while discussing PDF text), ASK "Did you mean …?" — do NOT invent technologies or Ideal answers around the misheard word.
17. Do not stay on one project for more than two turns (one deep-dive + one clarify). Then switch topics.
18. Good examples of tone: "In your PDF Knowledge Chatbot, how did you build the retrieval pipeline?", "Just to confirm — did you mean whole text rather than voltage?", "Given an array of integers, find two numbers that sum to a target — walk me through your approach."
19. DATE-ANCHORED QUESTION RULE: Never phrase a question around a specific date, month, or year from the resume. Dates are metadata for your timeline understanding only — never valid question material. Anchor questions to the ENTITY (company, project, certification), not time. Wrong: "In December 2024, what did you learn during your internship at X?" or "In 2023, what technologies did you use in Project Y?" Right: "During your internship at X, what did you learn?" and "In Project Y, what technologies did you use and why?" If a resume line has only a date range with no named entity, skip it — do not fall back to date-based phrasing. Before finalizing each question, self-check: if the question text contains a month name, year, or date range, rewrite it to reference the entity instead or discard it.`;
}

export function buildInitialQuestionsUserPrompt(
  questionCount: number,
  sessionSeed: string,
  previouslyAskedQuestions: string[] = [],
) {
  const avoidBlock = previouslyAskedQuestions.length
    ? `\nDo NOT repeat these previously-asked questions or ask near-duplicates of them — generate new questions covering different aspects of this resume (different projects, skills, experiences, or deeper angles on the same project):\n${previouslyAskedQuestions
        .slice(0, 20)
        .map((question, index) => `${index + 1}. ${question}`)
        .join('\n')}\n`
    : '';

  return `Generate exactly ${questionCount} interview questions for this session (SESSION: ${sessionSeed} — use for wording variety).
${avoidBlock}
Return ONLY valid JSON:
{
  "questions": [
    {
      "question": string,
      "expectedSignals": string[],
      "questionType": "behavioural" | "technical" | "situational",
      "resumeReference": string,
      "difficulty": "easy" | "easy-medium" | "medium" | "medium-hard" | "scenario" | "problem-solving" | "behavioral",
      "topic": string,
      "followUpIntent": "deepen" | "clarify" | "bridge-topic" | "challenge" | "recover-confidence"
    }
  ]
}

Rules:
- Exactly ${questionCount} questions, all distinct topics.
- First question: natural self-introduction opener only once.
- Remaining questions must resemble real interviews: named project deep-dives, 1-2 coding/DSA problems, tech stack probes, one behavioral STAR, optional company/role fit.
- Ban vague meta prompts ("demonstrate interview expectations", "accurate concept explanation", "clear career summary" as the ask).
- Each question must cite a specific resume or JD element in resumeReference (prefer project/tech over degree).
- Stage difficulty from easy warm-up to harder scenarios.
- Write questions as spoken interviewer lines a candidate would hear in a real round.
- Never anchor questions to resume dates/months/years — reference company, project, or certification names instead (see DATE-ANCHORED QUESTION RULE in system prompt).
- No markdown, no preamble.`;
}

export type AdaptiveTurnPromptInput = {
  /** Pre-built compact state (preferred). */
  compactState?: CompactInterviewState;
  /** Legacy input — compact state is derived when compactState is omitted. */
  conversationHistory?: ConversationTurn[];
  interviewId?: string;
  questionIndex?: number;
  targetQuestionCount?: number;
  currentTopic?: string;
  currentDifficulty?: string;
  askedQuestionIds?: string[];
  strengths?: string[];
  weaknesses?: string[];
  weakAreas?: string[];
  candidateMessage: string;
  lastEvaluation?: {
    score: number;
    nextAction?: string;
    missingConcepts?: string[];
    conceptsCovered?: string[];
    feedback?: string;
  };
  followUpDecision?: {
    action: string;
    focus: string;
    reason: string;
  };
  previousQuestionTopics: string[];
  targetDifficulty?: string;
  questionsRemaining: number;
};

export function buildAdaptiveTurnUserPrompt(input: AdaptiveTurnPromptInput) {
  const compactState = input.compactState ?? buildCompactInterviewState({
    interviewId: input.interviewId,
    questionIndex: input.questionIndex ?? 0,
    targetQuestionCount: input.targetQuestionCount ?? input.questionsRemaining + (input.questionIndex ?? 0) + 1,
    conversationHistory: input.conversationHistory ?? [],
    previousQuestionTopics: input.previousQuestionTopics,
    askedQuestionIds: input.askedQuestionIds,
    currentTopic: input.currentTopic,
    currentDifficulty: input.currentDifficulty ?? input.targetDifficulty,
    strengths: input.strengths,
    weaknesses: input.weaknesses,
    weakAreas: input.weakAreas ?? input.lastEvaluation?.missingConcepts,
  });

  return `${formatCompactInterviewStateBlock(compactState)}

CANDIDATE'S LATEST MESSAGE:
"${input.candidateMessage}"

LAST EVALUATION:
${input.lastEvaluation ? JSON.stringify(input.lastEvaluation, null, 2) : 'None — this may be the candidate asking you a question instead of answering.'}

FOLLOW-UP DECISION HINT:
${input.followUpDecision ? JSON.stringify(input.followUpDecision, null, 2) : 'Infer the best next move from the conversation.'}

TOPICS ALREADY COVERED: ${input.previousQuestionTopics.join(', ') || 'none yet'}
TARGET DIFFICULTY: ${input.targetDifficulty ?? 'medium'}
QUESTIONS REMAINING IN INTERVIEW: ${input.questionsRemaining}

Determine whether the candidate's latest message is:
- "answer" — they are answering your question, OR
- "question_to_interviewer" — they are asking YOU something (team size, role scope, culture, etc.)

Return ONLY valid JSON:
{
  "candidateMessageIntent": "answer" | "question_to_interviewer",
  "interviewerReply": string | null,
  "question": {
    "question": string,
    "expectedSignals": string[],
    "questionType": "behavioural" | "technical" | "situational",
    "resumeReference": string,
    "difficulty": "easy" | "easy-medium" | "medium" | "medium-hard" | "scenario" | "problem-solving" | "behavioral",
    "topic": string,
    "followUpIntent": "deepen" | "clarify" | "bridge-topic" | "challenge" | "recover-confidence"
  }
}

Rules:
- If intent is "question_to_interviewer": set interviewerReply to a brief in-character answer (2-4 sentences), then set question to the NEXT real interview question (project/coding/company/HR). NEVER ask "Are you ready to proceed/continue?".
- If intent is "answer": interviewerReply should be null. Follow FOLLOW-UP DECISION HINT strictly.
- At most ONE clarifying follow-up on the same project/topic. If the hint action is "move_topic", you MUST switch to a different project, coding/DSA, company, or HR question.
- If the candidate's wording looks like a speech-to-text error (nonsense technical term in context), the next question should confirm what they meant ("Did you mean whole text?") instead of treating the glitch as a fact.
- Use exact resume project names. Never invent tools/libraries the resume and answer did not mention.
- The question.question field must be the complete spoken interviewer line.
- Follow-ups should sound like real interviews: architecture choices, edge cases, metrics, failure modes, or STAR — never meta filler.
- Do not repeat previous questions. Never re-ask Tell me about yourself.
- Do not use forbidden boilerplate transition phrases.
- No markdown, no preamble.`;
}
