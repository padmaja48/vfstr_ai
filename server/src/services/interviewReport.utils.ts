export type AnswerTurnType = 'answered_well' | 'answered_weakly' | 'clarification_request' | 'deflected';

export const normalizeQuestionText = (text: string) =>
  String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[?.!]+$/g, '');

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'your', 'you', 'what', 'how', 'when', 'where', 'that', 'this',
  'from', 'into', 'about', 'please', 'tell', 'me', 'can', 'could', 'would', 'did', 'does',
  'are', 'was', 'were', 'have', 'has', 'had', 'will', 'just', 'also', 'than', 'then',
]);

/** Lightweight paraphrase folding so "explain/walk through/describe" collide in feature space. */
const TOKEN_ALIASES: Record<string, string> = {
  explain: 'describe',
  describe: 'describe',
  walk: 'describe',
  through: 'describe',
  discuss: 'describe',
  outline: 'describe',
  built: 'implement',
  build: 'implement',
  implement: 'implement',
  implemented: 'implement',
  create: 'implement',
  created: 'implement',
  develop: 'implement',
  developed: 'implement',
  detail: 'depth',
  details: 'depth',
  architecture: 'design',
  design: 'design',
  pipeline: 'flow',
  approach: 'method',
  method: 'method',
};

const significantTokens = (text: string) =>
  text
    .split(/[^a-z0-9+#]+/i)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 3)
    .filter((token) => !STOPWORDS.has(token))
    .map((token) => TOKEN_ALIASES[token] || token);

const charNgrams = (text: string, n = 3) => {
  const compact = text.replace(/[^a-z0-9]+/g, ' ').trim();
  const grams: string[] = [];
  for (let i = 0; i <= compact.length - n; i += 1) {
    grams.push(compact.slice(i, i + n));
  }
  return grams;
};

const featureVector = (text: string) => {
  const counts = new Map<string, number>();
  const bump = (key: string, weight = 1) => counts.set(key, (counts.get(key) || 0) + weight);
  significantTokens(text).forEach((token) => bump(`t:${token}`, 2));
  charNgrams(text, 3).forEach((gram) => bump(`g:${gram}`, 1));
  return counts;
};

/** Cosine similarity over token + char-trigram features (offline stand-in for embeddings). */
export const questionCosineSimilarity = (left: string, right: string) => {
  const a = featureVector(normalizeQuestionText(left));
  const b = featureVector(normalizeQuestionText(right));
  if (!a.size || !b.size) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  a.forEach((value, key) => {
    normA += value * value;
    if (b.has(key)) dot += value * (b.get(key) || 0);
  });
  b.forEach((value) => {
    normB += value * value;
  });
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

/** Lexical + Jaccard + semantic cosine near-dupe check (E14). */
export const isNearDuplicateQuestion = (left: string, right: string) => {
  const normalizedLeft = normalizeQuestionText(left);
  const normalizedRight = normalizeQuestionText(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;
  if (normalizedLeft.length > 40 && normalizedRight.length > 40) {
    if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
      return true;
    }
  }

  const leftTokens = new Set(significantTokens(normalizedLeft));
  const rightTokens = new Set(significantTokens(normalizedRight));
  if (leftTokens.size >= 4 && rightTokens.size >= 4) {
    let overlap = 0;
    leftTokens.forEach((token) => {
      if (rightTokens.has(token)) overlap += 1;
    });
    const union = leftTokens.size + rightTokens.size - overlap;
    const jaccard = union > 0 ? overlap / union : 0;
    if (jaccard >= 0.72) return true;
  }

  return questionCosineSimilarity(normalizedLeft, normalizedRight) >= 0.78;
};

/** G04/G05 helpers used by scoring pipeline and regression tests. */
export const isVagueAnswerText = (answer: string) => {
  const text = String(answer || '').trim();
  if (text.length < 80) return true;
  const sentences = text.split(/[.!?]+/).map((part) => part.trim()).filter((part) => part.length > 20);
  const hasMetric = /\b\d+(\.\d+)?\s*(%|ms|s|users?|requests?|x|times)\b/i.test(text);
  const hasConcreteStack = /\b(python|java|react|node|sql|aws|docker|kafka|faiss|langchain|mongodb|postgres)\b/i.test(text);
  const hasStarSignal = /\b(situation|task|action|result|i (led|built|implemented|designed|measured))\b/i.test(text);
  return sentences.length < 2 && !hasMetric && !(hasConcreteStack && hasStarSignal);
};

const LANGUAGE_STARTERS = [
  'def solve():\n    # write your approach\n    pass',
  'function solve() {\n  // write your approach\n}',
  'class Solution {\n    public void solve() {\n        // write your approach\n    }\n}',
  '#include <iostream>\nusing namespace std;\n\nint main() {\n    // write your approach\n    return 0;\n}',
  'SELECT *\nFROM table_name\n-- continue here',
];

const normalizeCodeForCompare = (value = '') =>
  String(value).replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\s+/g, ' ').trim();

export const extractSubmittedCode = (answer: string) => {
  const text = String(answer || '');
  const match = text.match(/Submitted code(?:\s*\(([^)]+)\))?:\s*([\s\S]*)/i);
  if (match) {
    const rest = String(match[2] || '');
    const code = rest.replace(/\n\nDesign whiteboard notes:[\s\S]*$/i, '').trim();
    return {
      language: String(match[1] || '').trim(),
      code,
      spoken: text.slice(0, match.index).trim(),
      hasCodeBlock: true,
    };
  }
  return { language: '', code: '', spoken: text.trim(), hasCodeBlock: false };
};

export const isPlaceholderOrBlankCode = (code: string) => {
  const raw = String(code || '').trim();
  if (!raw) return true;
  if (LANGUAGE_STARTERS.some((starter) => normalizeCodeForCompare(starter) === normalizeCodeForCompare(raw))) {
    return true;
  }
  const withoutComments = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*#.*$/gm, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*--.*$/gm, '')
    .trim();
  if (!withoutComments) return true;
  if (
    /^(?:def\s+\w+\s*\([^)]*\):\s*)?(?:pass|return(?:\s+None)?|return\s+0|return\s+\[\]|return\s+\{\}|TODO|FIXME|NotImplemented(?:Error)?|throw new Error\([^)]*\)|console\.log\([^)]*\))?;?\s*$/i.test(
      withoutComments.replace(/\s+/g, ' ').trim(),
    )
  ) {
    return true;
  }
  const stripped = withoutComments
    .replace(/\b(?:def|function|class|public|void|int|main|solve|return|pass|none)\b/gi, ' ')
    .replace(/[{}();,=]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length < 2;
};

export const looksLikeCodingSubmission = (question: string, answer: string, questionType?: string) => {
  if (extractSubmittedCode(answer).hasCodeBlock) return true;
  return (
    /coding|problem-solving/i.test(questionType || '')
    || /\b(write a function|write or explain an? sql|given an array|given a string|palindrome|two numbers that add up|linked list|non-repeating|implement |leetcode|time (and space )?complexity|algorithm to|edge cases would you)\b/i.test(
      question,
    )
  );
};

export const applyScoringBandGuards = <T extends { score?: number; feedback?: string; nextAction?: string; dynamicFeedback?: { strengths?: string[] } }>(
  evaluation: T,
  answer: string,
  speechHints: Array<{ heard: string; likelyMeant: string }> = [],
  options: { isCoding?: boolean; code?: string } = {},
): T => {
  const scoringAnswer = String(answer || '');
  const next = { ...evaluation };

  if (options.isCoding) {
    if (speechHints.length) {
      const hint = speechHints[0];
      next.feedback = `${next.feedback || ''} Transcription risk: heard "${hint.heard}" — did you mean ${hint.likelyMeant}?`.trim();
    }
    const score = next.score ?? 0;
    const praiseBlob = [next.feedback, ...(next.dynamicFeedback?.strengths ?? [])].join(' ');
    if (score <= 25 && /\b(excellent|outstanding|great job|well done|strong solution)\b/i.test(praiseBlob)) {
      next.dynamicFeedback = {
        ...next.dynamicFeedback,
        strengths: (next.dynamicFeedback?.strengths ?? []).filter(
          (line) => !/\b(excellent|outstanding|great job|well done|strong solution)\b/i.test(line),
        ),
      };
    }
    return next;
  }

  if (isVagueAnswerText(scoringAnswer) && (next.score ?? 0) > 50) {
    next.score = 50;
    next.feedback = `${next.feedback || ''} Vague answers without concrete examples are capped at 50.`.trim();
  }

  const hasStarSignal = /\b(i (led|built|implemented|designed|measured)|result|impact|situation|action)\b/i.test(
    scoringAnswer,
  );
  const hasMetric = /\b\d+(\.\d+)?\s*%|\b\d+(\.\d+)?\s*(ms|users?|requests?|times)\b/i.test(scoringAnswer);
  if (
    !isVagueAnswerText(scoringAnswer)
    && hasStarSignal
    && hasMetric
    && (next.score ?? 0) < 70
    && (next.score ?? 0) >= 55
  ) {
    next.score = 70;
  }

  if (speechHints.length) {
    const hint = speechHints[0];
    const asrNote = `Transcription risk: heard "${hint.heard}" — did you mean ${hint.likelyMeant}? Do not grade the misheard word as a technical claim.`;
    next.feedback = `${next.feedback || ''} ${asrNote}`.trim();
    if (next.nextAction !== 'move_topic') {
      next.nextAction = 'clarify';
    }
  }

  if (speechHints.length && (next.score ?? 0) === 0 && scoringAnswer.length >= 40) {
    next.score = 35;
    next.feedback = `${next.feedback || ''} Partial credit given despite noisy transcription.`.trim();
  }

  return next;
};

export const dedupeTranscriptItems = <T extends { question: string }>(items: T[]): T[] => {
  const deduped: T[] = [];
  for (const item of items) {
    const previous = deduped[deduped.length - 1];
    if (previous && isNearDuplicateQuestion(previous.question, item.question)) continue;
    deduped.push(item);
  }
  return deduped;
};

/** True when the candidate submitted or skipped a question (not a never-reached planned slot). */
export const isAttemptedInterviewQuestion = (item: {
  userAnswer?: string | null;
  score?: number | null;
  feedback?: string | null;
}) => {
  const answer = String(item.userAnswer ?? '').trim();
  if (answer) return true;
  if (
    typeof item.score === 'number'
    && Number.isFinite(item.score)
    && String(item.feedback ?? '').trim()
  ) {
    return true;
  }
  return false;
};

/** Substantive spoken/written answer — excludes blank, skip, and placeholder text. */
export const isSubstantiveReportAnswer = (answer?: string | null) => {
  const text = String(answer ?? '').trim();
  return Boolean(
    text
    && text !== '(no answer)'
    && text.length >= 10
    && !/^\(?(no answer|skipped?|n\/a|nothing|none)\)?$/i.test(text),
  );
};

export type ReportTranscriptItem = {
  question: string;
  answer?: string;
  feedback?: string;
  score?: number;
  questionType?: string;
  resumeReference?: string;
  difficulty?: string;
  topic?: string;
  idealAnswer?: string;
  samplePerfectAnswer?: string;
  conceptsCovered?: string[];
  missingConcepts?: string[];
  incorrectStatements?: string[];
  wrongTerminology?: string[];
  technicalMistakes?: string[];
  dynamicFeedback?: {
    strengths?: string[];
    areasToImprove?: string[];
    missingConcepts?: string[];
    technicalMistakes?: string[];
    communication?: string;
    confidence?: string;
    nextLearningSuggestions?: string[];
    practicalUnderstanding?: string;
    interviewReadiness?: string;
  };
};

export const mapInterviewQuestionToTranscriptItem = (item: Record<string, unknown>): ReportTranscriptItem => ({
  question: String(item.question || ''),
  answer: item.userAnswer as string | undefined,
  feedback: item.feedback as string | undefined,
  score: typeof item.score === 'number' ? item.score : undefined,
  questionType: item.questionType as string | undefined,
  resumeReference: item.resumeReference as string | undefined,
  difficulty: item.difficulty as string | undefined,
  topic: item.topic as string | undefined,
  idealAnswer: item.idealAnswer as string | undefined,
  samplePerfectAnswer: item.samplePerfectAnswer as string | undefined,
  conceptsCovered: item.conceptsCovered as string[] | undefined,
  missingConcepts: item.missingConcepts as string[] | undefined,
  incorrectStatements: item.incorrectStatements as string[] | undefined,
  wrongTerminology: item.wrongTerminology as string[] | undefined,
  technicalMistakes: item.technicalMistakes as string[] | undefined,
  dynamicFeedback: item.dynamicFeedback as ReportTranscriptItem['dynamicFeedback'],
});

/** How many planned question slots were reached in the live session (excludes never-presented tail). */
export const getInterviewReachedQuestionCount = (interview: {
  questions?: Array<Record<string, unknown>>;
  currentQuestionIndex?: number;
  terminationQuestionIndex?: number;
  status?: string;
}) => {
  const questions = interview.questions ?? [];
  const total = questions.length;
  const current = Math.max(0, Number(interview.currentQuestionIndex ?? 0));

  let lastAttemptedIndex = -1;
  questions.forEach((item, index) => {
    if (isAttemptedInterviewQuestion(item)) lastAttemptedIndex = index;
  });
  const progressFromAnswers = lastAttemptedIndex + 1;

  let reached = Math.max(current, progressFromAnswers);
  if (interview.status === 'Terminated' && interview.terminationQuestionIndex != null) {
    reached = Math.max(reached, Number(interview.terminationQuestionIndex) + 1);
  }
  return Math.min(total, reached);
};

/** Only questions the candidate actually attempted — excludes unreached planned slots. */
export const buildReportTranscriptFromInterview = (interview: {
  questions?: Array<Record<string, unknown>>;
  totalPlannedQuestions?: number;
  status?: string;
  terminationReason?: string;
  currentQuestionIndex?: number;
  terminationQuestionIndex?: number;
}) => {
  const questions = interview.questions ?? [];
  const reachedCount = getInterviewReachedQuestionCount(interview);
  const reached = questions.slice(0, reachedCount);
  const attempted = reached.filter((item) => isAttemptedInterviewQuestion(item));
  return dedupeTranscriptItems(attempted.map(mapInterviewQuestionToTranscriptItem));
};

export type ReportSessionMeta = {
  totalPlannedQuestions: number;
  questionsAttempted: number;
  questionsAnswered: number;
  endedEarly: boolean;
  endReason?: 'terminated' | 'manual_early' | 'completed';
  terminationReason?: string;
  scoreConfidenceNote?: string;
  sessionNote?: string;
};

const formatIntegrityReason = (reason = '') => {
  const value = String(reason).replace(/^integrity_violation:/, '').replace(/_/g, ' ').trim();
  if (!value) return 'integrity policy violation';
  return value.charAt(0).toUpperCase() + value.slice(1);
};

export const buildReportSessionMeta = (
  interview: {
    status?: string;
    totalPlannedQuestions?: number;
    questions?: Array<Record<string, unknown>>;
    terminationReason?: string;
    currentQuestionIndex?: number;
    terminationQuestionIndex?: number;
  },
  transcript: ReportTranscriptItem[],
): ReportSessionMeta => {
  const totalPlannedQuestions =
    interview.totalPlannedQuestions
    ?? interview.questions?.length
    ?? transcript.length;
  const scored = transcript.filter((item) => !isMetaInterviewQuestion(item.question));
  const questionsAttempted = scored.length;
  const questionsAnswered = scored.filter((item) => isSubstantiveReportAnswer(item.answer)).length;
  const isTerminated = interview.status === 'Terminated';
  const endedEarly = isTerminated || questionsAttempted < totalPlannedQuestions;

  let endReason: ReportSessionMeta['endReason'] = 'completed';
  if (isTerminated) endReason = 'terminated';
  else if (endedEarly) endReason = 'manual_early';

  const progressLabel = `${questionsAnswered} of ${totalPlannedQuestions} questions answered`;

  let sessionNote: string | undefined;
  if (endedEarly) {
    if (isTerminated && interview.terminationReason) {
      sessionNote = `Interview ended early — ${progressLabel}. Terminated due to ${formatIntegrityReason(interview.terminationReason)}.`;
    } else {
      sessionNote = `Interview ended early — ${progressLabel}.`;
    }
  }

  let scoreConfidenceNote: string | undefined;
  if (questionsAnswered > 0 && questionsAnswered <= 2) {
    scoreConfidenceNote = `Limited data — based on ${questionsAnswered} answered question${questionsAnswered === 1 ? '' : 's'}, this score may not fully reflect readiness.`;
  }

  return {
    totalPlannedQuestions,
    questionsAttempted,
    questionsAnswered,
    endedEarly,
    endReason,
    terminationReason: interview.terminationReason,
    scoreConfidenceNote,
    sessionNote,
  };
};

/** Re-align a persisted report with the interview's real answered questions (fixes legacy partial reports). */
export const sanitizeStoredReportForInterview = (
  report: Record<string, unknown> | null | undefined,
  interview: Record<string, unknown>,
) => {
  if (!report) return report ?? null;

  const transcript = buildReportTranscriptFromInterview(interview);
  const sessionMeta = buildReportSessionMeta(interview, transcript);
  const participationRatio = sessionMeta.totalPlannedQuestions > 0
    ? sessionMeta.questionsAnswered / sessionMeta.totalPlannedQuestions
    : 0;

  const storedByQuestion = new Map<string, Record<string, unknown>>();
  for (const item of (report.questionAnalysis as Array<{ question?: string }> | undefined) ?? []) {
    const key = normalizeQuestionText(String(item?.question || ''));
    if (key) storedByQuestion.set(key, item as Record<string, unknown>);
  }

  const questionAnalysis = transcript.map((item) => {
    const key = normalizeQuestionText(item.question);
    const stored = key ? storedByQuestion.get(key) : undefined;
    const score = typeof item.score === 'number'
      ? item.score
      : (typeof stored?.score === 'number' ? stored.score : undefined);
    return {
      ...(stored ?? {}),
      question: item.question,
      answer: item.answer ?? stored?.answer ?? '(no answer)',
      score: typeof score === 'number' ? score : 0,
      feedback: item.feedback ?? stored?.feedback ?? 'No answer was provided.',
      questionType: item.questionType ?? stored?.questionType ?? 'general',
      resumeReference: item.resumeReference ?? stored?.resumeReference ?? 'general',
      whatWorked: stored?.whatWorked ?? item.dynamicFeedback?.strengths?.[0] ?? '',
      whatToImprove: stored?.whatToImprove ?? item.dynamicFeedback?.areasToImprove?.[0] ?? '',
      idealAnswer: item.idealAnswer ?? stored?.idealAnswer,
      samplePerfectAnswer: item.samplePerfectAnswer ?? stored?.samplePerfectAnswer,
      conceptsCovered: item.conceptsCovered ?? stored?.conceptsCovered ?? [],
      missingConcepts: item.missingConcepts ?? stored?.missingConcepts ?? [],
      incorrectStatements: item.incorrectStatements ?? stored?.incorrectStatements ?? [],
      wrongTerminology: item.wrongTerminology ?? stored?.wrongTerminology ?? [],
      technicalMistakes: item.technicalMistakes ?? stored?.technicalMistakes ?? [],
      dynamicFeedback: item.dynamicFeedback ?? stored?.dynamicFeedback,
    };
  });

  const derived = deriveReportScoresFromTranscript(transcript, {
    participationRatio,
    liveScores: interview.liveScores as Partial<Record<'grammar' | 'vocabulary' | 'confidence' | 'completeness' | 'depth' | 'terminology' | 'domain', number>>,
  });

  const sessionNote = sessionMeta.sessionNote;
  let transcriptSummary = typeof report.transcriptSummary === 'string' ? report.transcriptSummary : '';
  if (sessionNote && transcriptSummary && !transcriptSummary.includes(sessionNote)) {
    transcriptSummary = `${sessionNote} ${transcriptSummary}`.trim();
  }

  return {
    ...report,
    ...sessionMeta,
    questionAnalysis,
    overallScore: derived.overallScore,
    communicationScore: derived.communicationScore,
    technicalScore: derived.technicalScore,
    behavioralScore: derived.behavioralScore,
    confidenceScore: derived.confidenceScore,
    grammarScore: derived.grammarScore,
    vocabularyScore: derived.vocabularyScore,
    domainExpertiseScore: derived.domainExpertiseScore,
    transcriptSummary: transcriptSummary || report.transcriptSummary,
    questionTimeline: transcript.map((item) => ({
      question: item.question,
      topic: item.topic ?? item.resumeReference ?? 'general',
      difficulty: item.difficulty ?? 'unknown',
      score: typeof item.score === 'number' ? item.score : 0,
    })),
    difficultyProgression: transcript.map((item) => item.difficulty ?? 'unknown'),
  };
};

export const isSelfIntroductionQuestion = (question: string) =>
  /tell me about yourself|introduce yourself|walk me through your (background|education)|who are you/i.test(question);

/** Process / filler lines that must never be scored as interview questions. */
export const isMetaInterviewQuestion = (question: string) =>
  /are you ready to (proceed|continue|move forward|go on)|ready to proceed|take a deep breath|don'?t worry.? it'?s okay|let'?s continue the interview|shall we (continue|proceed)|interview expectations|company-style expectations|demonstrate .*(expectations|readiness)/i.test(
    String(question || ''),
  );

export type SpeechArtifactHint = { heard: string; likelyMeant: string };

/** Common ASR glitches in technical answers — ask to confirm, do not treat as facts. */
export const detectLikelySpeechArtifacts = (
  answer: string,
  contextText = '',
): SpeechArtifactHint[] => {
  const text = `${answer} ${contextText}`;
  const lower = text.toLowerCase();
  const hints: SpeechArtifactHint[] = [];

  if (/\bvoltage\b/i.test(answer) && /\b(pdf|text|chunk|vector|extract|tokenize|document)\b/i.test(lower)) {
    hints.push({ heard: 'voltage', likelyMeant: 'whole text / the full document text' });
  }
  if (/\b(fire|fares|face)\b/i.test(answer) && /\b(vector|embedding|store|database|chunk)\b/i.test(lower)) {
    hints.push({ heard: 'Fire/Face', likelyMeant: 'FAISS (or another vector store)' });
  }
  if (/\bcrop model\b/i.test(answer) && /\b(llm|pdf|chat|answer|question)\b/i.test(lower)) {
    hints.push({ heard: 'crop model', likelyMeant: 'LLM / chat model' });
  }
  if (/\bchart put\b/i.test(answer) && /\b(pdf|chat|conversation)\b/i.test(lower)) {
    hints.push({ heard: 'chart put', likelyMeant: 'chatbot' });
  }
  if (/\bold (sentence|text)\b/i.test(answer) && /\b(chunk|vector|pdf)\b/i.test(lower)) {
    hints.push({ heard: 'old sentence/text', likelyMeant: 'whole sentence / whole text' });
  }
  if (/\briya\b/i.test(answer) && /\b(front|react|mern|ui|form|website|platform)\b/i.test(lower)) {
    hints.push({ heard: 'Riya', likelyMeant: 'React' });
  }
  if (/\b(gate|kitten get up|gid have|get up)\b/i.test(answer) && /\b(git|github|deploy|project|version)\b/i.test(lower)) {
    hints.push({ heard: 'Gate/Git mishear', likelyMeant: 'Git / GitHub' });
  }
  if (/\b(google )?collap\b/i.test(answer)) {
    hints.push({ heard: 'collap', likelyMeant: 'Google Colab' });
  }
  if (/\b(jupiter|repeater)\s+notebook\b/i.test(answer)) {
    hints.push({ heard: 'jupiter/repeater notebook', likelyMeant: 'Jupyter Notebook' });
  }
  if (/\bbatchments\b/i.test(answer)) {
    hints.push({ heard: 'batchments', likelyMeant: 'batchmates / teammates' });
  }
  if (/\bmonster\b/i.test(answer) && /\b(java|python|javascript|sql)\b/i.test(lower)) {
    hints.push({ heard: 'monster', likelyMeant: 'and/or (possible ASR glitch between language names)' });
  }
  if (/\bairport\b/i.test(answer) && /\b(pdf|chatbot|knowledge|project)\b/i.test(lower)) {
    hints.push({ heard: 'airport', likelyMeant: 'chatbot / project name mishear' });
  }
  if (/\brend was ali\b|\brent was\b/i.test(answer) && /\b(deploy|render|vercel)\b/i.test(lower)) {
    hints.push({ heard: 'rent/rend', likelyMeant: 'Render (deployment)' });
  }

  // Broad garbled-speech signal when many rare tokens appear in a long answer.
  const words = String(answer || '').split(/\s+/).filter(Boolean);
  const garbageHits = words.filter((word) =>
    /^(kid|gate|riya|monster|collap|dear|stain|diploning|invitation|batchments|airport)$/i.test(word),
  ).length;
  if (words.length >= 12 && garbageHits >= 2 && hints.length === 0) {
    hints.push({
      heard: 'multiple unclear words',
      likelyMeant: 'possible speech-to-text noise — ask the candidate to repeat key tech names',
    });
  }

  return hints;
};

export const sharedProjectName = (
  left: string,
  right: string,
  projects: string[] = [],
): string | undefined => {
  const haystack = `${left} ${right}`.toLowerCase();
  return projects.find((project) => {
    const token = String(project || '').toLowerCase().trim();
    if (token.length < 4) return false;
    const short = token.slice(0, Math.min(18, token.length));
    return haystack.includes(token) || haystack.includes(short);
  });
};

/** Common LLM-invented tools that must not appear unless grounded in resume/answer. */
const HALLUCINATION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bnamed entity recognition\b|\bner\b/i, label: 'named entity recognition' },
  { pattern: /\bpart-of-speech tagging\b|\bpos tagging\b/i, label: 'part-of-speech tagging' },
  { pattern: /\bnltk\b/i, label: 'NLTK' },
  { pattern: /\bspacy\b|\bspaCy\b/i, label: 'spaCy' },
  { pattern: /\bpytest\b/i, label: 'pytest' },
  { pattern: /\bjunit\b/i, label: 'JUnit' },
  { pattern: /\bselenium\b/i, label: 'Selenium' },
  { pattern: /\bpdf converter\b/i, label: 'PDF converter' },
  { pattern: /\ba technique from your stack(?: library)?\b/i, label: 'ungrounded technique placeholder' },
  { pattern: /\btensorflow\b/i, label: 'TensorFlow' },
  { pattern: /\bpytorch\b/i, label: 'PyTorch' },
  { pattern: /\bkafka\b/i, label: 'Kafka' },
  { pattern: /\bredis\b/i, label: 'Redis' },
  { pattern: /\belasticsearch\b/i, label: 'Elasticsearch' },
  { pattern: /\bgraphql\b/i, label: 'GraphQL' },
  { pattern: /\bkubernetes\b|\bk8s\b/i, label: 'Kubernetes' },
];

/**
 * Strip or rewrite ungrounded tool/project claims from Ideal/Improved text.
 * Acceptance: H03, H04 — exact resume names; no invented frameworks.
 */
export const sanitizeGroundedFeedbackText = (
  text: string,
  grounding: {
    projects?: string[];
    skills?: string[];
    answer?: string;
    question?: string;
  } = {},
): string => {
  let output = String(text || '').trim();
  if (!output) return output;

  const allowed = `${(grounding.projects || []).join(' ')} ${(grounding.skills || []).join(' ')} ${grounding.answer || ''} ${grounding.question || ''}`.toLowerCase();

  // Prefer exact project names when a close wrong title appears (before stripping).
  for (const project of grounding.projects || []) {
    const exact = String(project || '').trim();
    if (exact.length < 4) continue;
    if (/pdf knowledge chatbot/i.test(exact) && /\bpdf converter\b/i.test(output)) {
      output = output.replace(/\bpdf converter\b/gi, exact);
    }
  }

  for (const item of HALLUCINATION_PATTERNS) {
    if (!item.pattern.test(output)) continue;
    if (item.pattern.test(allowed)) continue;
    output = output
      .replace(item.pattern, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([.,;:!?])/g, '$1')
      .replace(/(?:^|\s),\s*/g, ' ')
      .trim();
  }

  // Drop ungrounded auth/cache claims often invented for MERN ideals.
  if (!/\bjwt\b|json web token/i.test(allowed)) {
    output = output
      .replace(/\bJSON Web Tokens?\s*\(?JWT\)?/gi, 'authentication')
      .replace(/\bJWTs?\b/gi, 'authentication')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  if (!/\bcache|caching|redis\b/i.test(allowed)) {
    output = output
      .replace(/\ba caching mechanism\b/gi, 'a performance improvement')
      .replace(/\bcaching mechanism\b/gi, 'performance improvement')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  return output;
};

export const extractSpeakerNameFromAnswer = (
  answer: string,
  _question?: string,
): { name: string | null; confidence: 'high' | 'medium' | 'low' } => {
  const text = String(answer || '').trim();
  if (text.length < 5) return { name: null, confidence: 'low' };

  const patterns = [
    /\b(?:my name is|i am|i'm|this is|call me)\s+([A-Za-z]+(?:\s+[A-Za-z]+){0,3})/i,
    /^([A-Za-z]+(?:\s+[A-Za-z]+){0,3})(?:,|\s+and\s|\s+here\b)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const name = match[1]
      .trim()
      .replace(/\b(?:sir|madam|ma'am|here)\b/gi, '')
      .trim();
    const words = name.split(/\s+/).filter(Boolean);
    if (words.length >= 1 && words.length <= 4 && name.length >= 3) {
      return {
        name: words.map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(' '),
        confidence: /\b(?:my name is|i am|i'm)\b/i.test(text) ? 'high' : 'medium',
      };
    }
  }

  return { name: null, confidence: 'low' };
};

export const classifyAnswerTurn = (answer: string): AnswerTurnType => {
  const text = String(answer || '').toLowerCase();
  if (
    /could you explain|did not understand|don't understand|do not understand|can you repeat|what do you mean|second part of the question|clarify|explain me that|explain that part/i.test(
      text,
    )
  ) {
    return 'clarification_request';
  }
  if (/don't know|do not know|not sure|skip|no idea|pass\b|can't answer|cannot answer/i.test(text) && text.length < 90) {
    return 'deflected';
  }
  if (text.trim().split(/\s+/).filter(Boolean).length < 25) return 'answered_weakly';
  return 'answered_well';
};

export const inferQuestionTypeFromContent = (
  question: string,
  interviewMode?: string,
  declaredType?: string,
): 'behavioural' | 'technical' | 'situational' => {
  const normalized = String(question || '').toLowerCase();

  if (
    /tell me about a time|star|conflict|teamwork|motivation|strength|weakness|career goal|why (this|our) (role|company)|behavio|communication style|working with others/i.test(
      normalized,
    )
  ) {
    return 'behavioural';
  }
  if (/scenario|suppose|what would you do if|production incident|under load|if .* fail/i.test(normalized)) {
    return 'situational';
  }
  if (
    /algorithm|complexity|implement|write code|coding|data structure|leetcode|sql query|architecture|debug|system design|api design|time complexity|space complexity/i.test(
      normalized,
    )
  ) {
    return 'technical';
  }
  if (interviewMode === 'hr_behavioral') return 'behavioural';
  if (declaredType === 'behavioural' || declaredType === 'behavioral') return 'behavioural';
  if (declaredType === 'situational') return 'situational';
  if (declaredType === 'technical') return 'technical';
  if (/how did .+ factor in|what would you do differently today/i.test(normalized)) {
    return interviewMode === 'hr_behavioral' ? 'behavioural' : 'situational';
  }
  return 'behavioural';
};

export const buildClarificationIdealAnswer = (question: string, coreIdeal: string) =>
  `When a question is unclear, briefly restate what you understood and ask which part needs clarification. After the interviewer clarifies "${question}", answer directly: ${coreIdeal}`;

export const buildDifficultyProgressionSummary = (
  transcript: Array<{ difficulty?: string; score?: number }>,
): string[] =>
  transcript.map((item, index) => {
    const difficulty = item.difficulty || 'medium';
    const score = item.score ?? 0;
    const label = difficulty.replace(/-/g, ' ');
    if (score >= 70) return `Q${index + 1} (${label}): Strong response with clear evidence.`;
    if (score >= 45) return `Q${index + 1} (${label}): Partial answer; depth or structure needs work.`;
    if (score > 0) return `Q${index + 1} (${label}): Weak answer; key points were missing.`;
    return `Q${index + 1} (${label}): Not answered or too vague to score.`;
  });

export const computeCompanyReadinessScore = (
  transcript: Array<{ answer?: string; score?: number }>,
  options: { targetCompany?: string; overallScore: number },
): number => {
  const answered = transcript.filter((item) => String(item.answer || '').trim().length >= 10);
  if (!answered.length) return Math.max(0, Math.round(options.overallScore * 0.45));

  const companyToken = String(options.targetCompany || '')
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(/\s+/)[0];

  let companySignals = 0;
  let roleFitSignals = 0;
  let scoreSum = 0;

  for (const item of answered) {
    const answer = String(item.answer || '').toLowerCase();
    scoreSum += item.score ?? 0;
    if (companyToken && answer.includes(companyToken)) companySignals += 1;
    if (/\b(researched|read about|mission|values|culture|customers|why this company|why here|why join)\b/i.test(answer)) {
      companySignals += 1;
    }
    if (/\b(internship|project|experience|implemented|collaborated|stakeholder|managed|delivered)\b/i.test(answer)) {
      roleFitSignals += 1;
    }
  }

  const averageScore = scoreSum / answered.length;
  const mentionRatio = companyToken ? Math.min(1, companySignals / Math.max(1, answered.length)) : 0.35;
  const roleFitRatio = Math.min(1, roleFitSignals / answered.length);
  const readiness = averageScore * 0.55 + mentionRatio * 100 * 0.25 + roleFitRatio * 100 * 0.2;
  const rounded = Math.round(Math.max(0, Math.min(100, readiness)));

  if (options.targetCompany && rounded === Math.round(options.overallScore) && companySignals === 0) {
    return Math.max(0, rounded - 10);
  }
  return rounded;
};

export const aggregateSessionStrengths = (
  transcript: Array<{
    score?: number;
    answer?: string;
    dynamicFeedback?: { strengths?: string[] };
  }>,
  whatWorkedList: string[] = [],
): string[] => {
  const perQuestion = transcript.flatMap((item) => item.dynamicFeedback?.strengths || []).filter(Boolean);
  const fromWhatWorked = whatWorkedList.filter(
    (item) => item && !/nothing|no specific|no answer|no meaningful|not recorded/i.test(item),
  );
  const strengths = [...new Set([...perQuestion, ...fromWhatWorked])].slice(0, 4);

  if (transcript.length > 0 && transcript.every((item) => String(item.answer || '').trim().length > 0)) {
    strengths.push('Attempted every question in the session without skipping the flow.');
  }
  if (transcript.some((item) => classifyAnswerTurn(String(item.answer || '')) === 'clarification_request')) {
    strengths.push('Asked for clarification when a question was unclear instead of guessing blindly.');
  }
  if (strengths.length === 0 && transcript.some((item) => (item.score ?? 0) > 0)) {
    strengths.push('Provided at least partial relevant content on some questions.');
  }
  if (strengths.length === 0) {
    strengths.push('Stayed engaged through the interview and completed the session.');
  }

  return [...new Set(strengths)].slice(0, 4);
};

/** Stock phrases that make post-interview reports sound AI-generated. */
export const BANNED_REPORT_AI_SPEAK = [
  'overall,',
  'in conclusion,',
  "it's worth noting that",
  'it is worth noting that',
  'furthermore,',
  'moreover,',
  'additionally,',
  'on the other hand,',
  'in summary,',
  'to summarize,',
  'it is important to note',
  'the candidate demonstrated',
  'the candidate showed',
  'the candidate exhibited',
  'the candidate displayed',
  'the candidate has shown',
  'the candidate effectively',
  'great job!',
  'great job overall',
  'well done overall',
  'well done!',
  'excellent performance',
  'outstanding performance',
  'strong performance overall',
  'could potentially',
  'may benefit from possibly',
  'might potentially',
  'demonstrated strong',
  'performed well overall',
  'did a good job',
];

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Strip AI-speak and optionally shift third-person report language to direct "you" address. */
export const humanizeReportText = (
  text: string,
  options: { secondPerson?: boolean } = {},
): string => {
  let result = String(text || '').trim();
  if (!result) return result;

  if (options.secondPerson !== false) {
    result = result
      .replace(/\bthe candidate\b/gi, 'you')
      .replace(/\bthe student\b/gi, 'you')
      .replace(/\bthey were able to\b/gi, 'you were able to')
      .replace(/\bthey showed\b/gi, 'you showed')
      .replace(/\bthey demonstrated\b/gi, 'you demonstrated');
  }

  for (const phrase of BANNED_REPORT_AI_SPEAK) {
    result = result.replace(new RegExp(escapeRegExp(phrase), 'gi'), '');
  }

  return result
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/^[,.\s]+|[,.\s]+$/g, '')
    .trim();
};

const humanizeReportLines = (lines: string[] | undefined, secondPerson = true) =>
  (lines ?? [])
    .map((line) => humanizeReportText(line, { secondPerson }))
    .filter((line) => line.length >= 8);

export type DerivedReportScores = {
  overallScore: number;
  communicationScore: number;
  technicalScore: number;
  behavioralScore: number;
  confidenceScore: number;
  grammarScore: number;
  vocabularyScore: number;
  domainExpertiseScore: number;
};

export const deriveReportScoresFromTranscript = (
  transcript: ReportTranscriptItem[],
  options: {
    participationRatio?: number;
    liveScores?: Partial<Record<'grammar' | 'vocabulary' | 'confidence' | 'completeness' | 'depth' | 'terminology' | 'domain', number>>;
  } = {},
): DerivedReportScores => {
  const scored = transcript.filter((item) => !isMetaInterviewQuestion(item.question));
  const avg = (items: ReportTranscriptItem[]) => {
    const withScores = items.filter(
      (item) => typeof item.score === 'number' && Number.isFinite(item.score),
    );
    if (!withScores.length) return 0;
    return Math.round(withScores.reduce((sum, item) => sum + (item.score ?? 0), 0) / withScores.length);
  };

  const overallScore = avg(scored);
  const technicalItems = scored.filter(
    (item) => inferQuestionTypeFromContent(item.question, undefined, item.questionType) === 'technical',
  );
  const behavioralItems = scored.filter(
    (item) => inferQuestionTypeFromContent(item.question, undefined, item.questionType) === 'behavioural',
  );
  const situationalItems = scored.filter(
    (item) => inferQuestionTypeFromContent(item.question, undefined, item.questionType) === 'situational',
  );

  const participation = options.participationRatio ?? 1;
  const capForLowParticipation = (value: number) =>
    participation < 0.5 ? Math.min(value, 50) : value;

  const live = options.liveScores ?? {};
  const communicationScore = capForLowParticipation(
    Math.round(live.completeness ?? avg(scored.map((item) => ({ ...item, score: Math.round((item.score ?? 0) * 0.92) })))),
  );
  const technicalScore = capForLowParticipation(technicalItems.length ? avg(technicalItems) : overallScore);
  const behavioralScore = capForLowParticipation(
    behavioralItems.length || situationalItems.length
      ? avg([...behavioralItems, ...situationalItems])
      : Math.round(overallScore * 0.88),
  );

  return {
    overallScore,
    communicationScore,
    technicalScore,
    behavioralScore,
    confidenceScore: capForLowParticipation(Math.round(live.confidence ?? overallScore * 0.9)),
    grammarScore: capForLowParticipation(Math.round(live.grammar ?? communicationScore)),
    vocabularyScore: capForLowParticipation(Math.round(live.vocabulary ?? communicationScore * 0.95)),
    domainExpertiseScore: capForLowParticipation(Math.round(live.domain ?? technicalScore)),
  };
};

const scoreBandLabel = (avg: number) => {
  if (avg >= 85) return 'strong';
  if (avg >= 70) return 'solid';
  if (avg >= 50) return 'mixed';
  if (avg >= 30) return 'weak';
  return 'struggling';
};

const contradictoryPraisePattern =
  /\b(excellent|outstanding|strong performance|highly impressive|great job|well done|performed very well|exceptional)\b/i;

export const buildMentorTranscriptSummary = (options: {
  overallScore: number;
  answeredCount: number;
  totalCount: number;
  speakerName?: string;
  topStrength?: string;
  topGap?: string;
}) => {
  const { overallScore, answeredCount, totalCount, speakerName, topStrength, topGap } = options;
  const firstName = speakerName?.split(/\s+/)[0];
  const greeting = firstName ? `${firstName}, ` : '';
  const participation = `${answeredCount}/${totalCount} questions`;
  const band = scoreBandLabel(overallScore);

  if (overallScore === 0) {
    return `${greeting}you didn't submit answers I could score this time — restart when you're ready and take each question one at a time.`;
  }
  if (band === 'struggling' || band === 'weak') {
    return `${greeting}this run averaged ${overallScore}/100 across ${participation}. ${topGap || "Most answers stayed surface-level — I'd pick 2-3 projects and rehearse a clear walkthrough with metrics before the next attempt."}`;
  }
  if (band === 'mixed') {
    return `${greeting}you're at ${overallScore}/100 (${participation}) — some answers landed, others needed more structure. ${topStrength || 'You stayed in the conversation.'} Next focus: ${topGap || 'add concrete examples and trade-offs where answers trailed off.'}`;
  }
  if (band === 'solid') {
    return `${greeting}nice work — ${overallScore}/100 average on ${participation}. ${topStrength || 'You showed real project depth in spots.'} To level up: ${topGap || 'tighten the weaker answers with metrics and clearer structure.'}`;
  }
  return `${greeting}strong session at ${overallScore}/100 (${participation}). ${topStrength || 'Your best answers had specifics interviewers can probe further.'} Still worth polishing: ${topGap || 'one or two answers that were thinner on trade-offs or verification.'}`;
};

export const buildReportGenerationPrompt = (options: {
  transcript: unknown;
  speakerLabel: string;
  accountOwnerName?: string;
  answeredCount: number;
  totalCount: number;
  participationRatio: number;
  precomputedAvg: number;
  resumeProjects?: string[];
  resumeSkills?: string[];
}) => {
  const band = scoreBandLabel(options.precomputedAvg);
  const bannedList = BANNED_REPORT_AI_SPEAK.map((phrase) => `"${phrase.replace(/"/g, '')}"`).join(', ');

  return `You are an experienced mock interview coach writing post-session feedback for ${options.speakerLabel}. Write like a real mentor talking directly to them after a practice round — honest, specific, encouraging where earned, direct where not. NOT a corporate HR performance review.

ACCOUNT OWNER (login profile): ${options.accountOwnerName ?? 'Not specified'}
Use the candidate name above when it helps; otherwise address them as "you". Never substitute the account owner name for the speaker.

TRANSCRIPT (per-question scores and feedback are already final — do NOT change scores):
${JSON.stringify(options.transcript, null, 2)}

RESUME PROJECTS (exact names): ${(options.resumeProjects ?? []).join(', ') || 'not provided'}
RESUME SKILLS: ${(options.resumeSkills ?? []).slice(0, 20).join(', ') || 'not provided'}

SCORE TRUTH (mandatory — narrative must match):
- Pre-computed average per-question score: ${Math.round(options.precomputedAvg)}/100 (${band} band)
- ${options.answeredCount}/${options.totalCount} questions answered (${Math.round(options.participationRatio * 100)}% participation)
- Band guidance:
  * struggling/weak (0-49): lead with gaps; at most 1-2 small honest positives
  * mixed (50-69): balanced — name what worked AND what didn't, tied to answers
  * solid (70-84): mostly strengths with 2-3 sharp improvements
  * strong (85+): celebrate specifics; still name 2 concrete next steps

VOICE RULES:
- Use "you" / "your" — never "the candidate"
- Contractions are fine (you're, didn't, I'd)
- Vary sentence length and openings — do NOT start every bullet with the same phrase
- Quote or paraphrase their actual words when praising or correcting
- Reference specific projects, technologies, or steps from THEIR answers
- Human mentor tone: direct, supportive, not stiff or corporate

BANNED PHRASES (never use): ${bannedList}

CONTENT RULES:
1. Reference actual answer content — do NOT fabricate things they didn't say
2. Preserve each transcript item's idealAnswer, samplePerfectAnswer, conceptsCovered, missingConcepts, incorrectStatements, wrongTerminology, technicalMistakes, dynamicFeedback when present
3. Question-level feedback must reflect the stored score — if score is low, feedback must say why honestly
4. Skip scoring meta lines like "Are you ready to proceed?" — mark score 0 with brief note
5. difficultyProgression: one entry per transcript question (${options.totalCount} entries)
6. overallScore and category scores will be overwritten — still return numbers close to ${Math.round(options.precomputedAvg)}

Return ONLY this exact JSON structure (no markdown):
{
  "communicationScore": number,
  "technicalScore": number,
  "behavioralScore": number,
  "confidenceScore": number,
  "grammarScore": number,
  "vocabularyScore": number,
  "domainExpertiseScore": number,
  "overallScore": number,
  "strengths": string[] (2-4 items for mixed+ bands; 0-2 for weak bands — each must cite evidence from answers),
  "improvements": string[] (3-5 specific gaps from actual answers),
  "recommendations": string[] (3-5 concrete next steps),
  "transcriptSummary": string (2-4 sentences in mentor voice, must match ${Math.round(options.precomputedAvg)}/100 band),
  "skillWiseStrengths": [{ "skill": string, "evidence": string, "score": number }],
  "areasForImprovement": string[],
  "missedConcepts": string[],
  "recommendedLearningResources": string[],
  "difficultyProgression": string[],
  "questionTimeline": [{ "question": string, "topic": string, "difficulty": string, "score": number }],
  "followUpQuality": string (1-2 sentences, conversational),
  "hiringRecommendation": "Strong Hire" | "Hire" | "Borderline" | "No Hire",
  "hiringRecommendationReason": string (honest, matches score band),
  "questionAnalysis": [
    {
      "question": string,
      "answer": string,
      "score": number,
      "feedback": string (2-3 sentences, mentor voice, cites their answer),
      "whatWorked": string,
      "whatToImprove": string,
      "questionType": string,
      "resumeReference": string,
      "idealAnswer": string,
      "samplePerfectAnswer": string,
      "conceptsCovered": string[],
      "missingConcepts": string[],
      "incorrectStatements": string[],
      "wrongTerminology": string[],
      "technicalMistakes": string[],
      "dynamicFeedback": { "strengths": string[], "missingConcepts": string[], "technicalMistakes": string[], "communication": string, "confidence": string, "areasToImprove": string[], "nextLearningSuggestions": string[], "practicalUnderstanding": string, "interviewReadiness": string }
    }
  ]
}`;
};

export type RefineReportInput = {
  transcript: ReportTranscriptItem[];
  answeredCount: number;
  totalCount: number;
  participationRatio: number;
  speakerName?: string;
  liveScores?: Partial<Record<'grammar' | 'vocabulary' | 'confidence' | 'completeness' | 'depth' | 'terminology' | 'domain', number>>;
  endedEarly?: boolean;
  sessionNote?: string;
};

/** Align narrative fields with deterministic scores and humanize voice. */
export const refineInterviewReport = <T extends {
  overallScore?: number;
  communicationScore?: number;
  technicalScore?: number;
  behavioralScore?: number;
  confidenceScore?: number;
  grammarScore?: number;
  vocabularyScore?: number;
  domainExpertiseScore?: number;
  strengths?: string[];
  improvements?: string[];
  recommendations?: string[];
  transcriptSummary?: string;
  areasForImprovement?: string[];
  followUpQuality?: string;
  hiringRecommendation?: string;
  hiringRecommendationReason?: string;
  questionAnalysis?: Array<{ feedback?: string; whatWorked?: string; whatToImprove?: string; score?: number }>;
}>(
  report: T,
  input: RefineReportInput,
): T => {
  const derived = deriveReportScoresFromTranscript(input.transcript, {
    participationRatio: input.participationRatio,
    liveScores: input.liveScores,
  });
  const avg = derived.overallScore;

  const topStrength = input.transcript
    .flatMap((item) => item.dynamicFeedback?.strengths ?? [])
    .find((line) => line && line.length > 20);
  const topGap = input.transcript
    .flatMap((item) => item.dynamicFeedback?.areasToImprove ?? [])
    .find((line) => line && line.length > 20);

  const next = { ...report };
  next.overallScore = avg;
  next.communicationScore = derived.communicationScore;
  next.technicalScore = derived.technicalScore;
  next.behavioralScore = derived.behavioralScore;
  next.confidenceScore = derived.confidenceScore;
  next.grammarScore = derived.grammarScore;
  next.vocabularyScore = derived.vocabularyScore;
  next.domainExpertiseScore = derived.domainExpertiseScore;

  next.strengths = humanizeReportLines(next.strengths);
  next.improvements = humanizeReportLines(next.improvements);
  next.recommendations = humanizeReportLines(next.recommendations);
  next.areasForImprovement = humanizeReportLines(next.areasForImprovement);
  next.followUpQuality = humanizeReportText(next.followUpQuality || '', { secondPerson: true });
  next.hiringRecommendationReason = humanizeReportText(next.hiringRecommendationReason || '', { secondPerson: true });

  const groundedStrengths = humanizeReportLines(
    aggregateSessionStrengths(input.transcript, input.transcript.map((item) => item.feedback || '')),
  );
  if (avg < 45) {
    next.strengths = [...new Set([...(next.strengths ?? []).slice(0, 1), ...groundedStrengths])].slice(0, 2);
  } else if ((next.strengths?.length ?? 0) < 2) {
    next.strengths = [...new Set([...(next.strengths ?? []), ...groundedStrengths])].slice(0, 4);
  }

  const summary = humanizeReportText(next.transcriptSummary || '', { secondPerson: true });
  if (!summary || (contradictoryPraisePattern.test(summary) && avg < 55)) {
    next.transcriptSummary = buildMentorTranscriptSummary({
      overallScore: avg,
      answeredCount: input.answeredCount,
      totalCount: input.totalCount,
      speakerName: input.speakerName,
      topStrength: topStrength ? humanizeReportText(topStrength, { secondPerson: true }) : undefined,
      topGap: topGap ? humanizeReportText(topGap, { secondPerson: true }) : undefined,
    });
  } else {
    next.transcriptSummary = summary;
  }

  if (input.sessionNote && input.endedEarly) {
    const note = humanizeReportText(input.sessionNote, { secondPerson: true });
    if (!next.transcriptSummary?.includes(note)) {
      next.transcriptSummary = `${note} ${next.transcriptSummary || ''}`.trim();
    }
  }

  if (avg >= 85) next.hiringRecommendation = 'Strong Hire';
  else if (avg >= 70) next.hiringRecommendation = 'Hire';
  else if (avg >= 50) next.hiringRecommendation = 'Borderline';
  else next.hiringRecommendation = 'No Hire';

  if (!next.hiringRecommendationReason || (contradictoryPraisePattern.test(next.hiringRecommendationReason) && avg < 55)) {
    next.hiringRecommendationReason = buildMentorTranscriptSummary({
      overallScore: avg,
      answeredCount: input.answeredCount,
      totalCount: input.totalCount,
      speakerName: input.speakerName,
      topGap: topGap ? humanizeReportText(topGap, { secondPerson: true }) : undefined,
    });
  }

  if (next.questionAnalysis?.length) {
    next.questionAnalysis = next.questionAnalysis.map((item, index) => {
      const source = input.transcript[index];
      const score = Number.isFinite(Number(source?.score)) ? Number(source?.score) : Number(item.score) || 0;
      return {
        ...item,
        score,
        feedback: humanizeReportText(source?.feedback || item.feedback || '', { secondPerson: true }),
        whatWorked: humanizeReportText(item.whatWorked || source?.dynamicFeedback?.strengths?.[0] || '', {
          secondPerson: true,
        }),
        whatToImprove: humanizeReportText(
          item.whatToImprove || source?.dynamicFeedback?.areasToImprove?.[0] || '',
          { secondPerson: true },
        ),
      };
    });
  }

  return next;
};

export const formatBannedFeedbackPhrasesForPrompt = () =>
  BANNED_REPORT_AI_SPEAK.map((phrase) => `"${phrase.replace(/,$/, '').trim()}"`).join(', ');

export const feedbackGroundsInSubmission = (feedbackText: string, answer: string, code = '') => {
  const text = String(feedbackText || '');
  if (!text) return false;
  if (/`[^`]{3,}`|"[^"]{4,}"|'[^']{4,}'/i.test(text)) return true;

  const haystack = `${answer}\n${code}`.toLowerCase();
  const words = haystack.split(/\s+/).filter((word) => word.length > 3);
  for (let index = 0; index <= words.length - 3; index += 1) {
    const phrase = words.slice(index, index + 3).join(' ');
    if (text.toLowerCase().includes(phrase)) return true;
  }

  const fnMatch = code.match(/\b(?:def|function)\s+(\w+)/i);
  if (fnMatch?.[1] && text.toLowerCase().includes(fnMatch[1].toLowerCase())) return true;
  return false;
};

export type EvaluationFeedbackShape = {
  score?: number;
  feedback?: string;
  technicalScore?: number;
  communicationScore?: number;
  dynamicFeedback?: {
    strengths?: string[];
    areasToImprove?: string[];
    nextLearningSuggestions?: string[];
    communication?: string;
    confidence?: string;
    practicalUnderstanding?: string;
    interviewReadiness?: string;
    technicalMistakes?: string[];
  };
};

/** Apply mentor voice to per-question evaluation feedback (coding + non-coding). */
export const humanizeEvaluationFeedback = <T extends EvaluationFeedbackShape>(evaluation: T): T => {
  const next = { ...evaluation };
  if (next.feedback) {
    next.feedback = humanizeReportText(next.feedback, { secondPerson: true });
  }
  if (next.dynamicFeedback) {
    next.dynamicFeedback = {
      ...next.dynamicFeedback,
      strengths: humanizeReportLines(next.dynamicFeedback.strengths),
      areasToImprove: humanizeReportLines(next.dynamicFeedback.areasToImprove),
      nextLearningSuggestions: humanizeReportLines(next.dynamicFeedback.nextLearningSuggestions),
      communication: next.dynamicFeedback.communication
        ? humanizeReportText(next.dynamicFeedback.communication, { secondPerson: true })
        : next.dynamicFeedback.communication,
      confidence: next.dynamicFeedback.confidence
        ? humanizeReportText(next.dynamicFeedback.confidence, { secondPerson: true })
        : next.dynamicFeedback.confidence,
      practicalUnderstanding: next.dynamicFeedback.practicalUnderstanding
        ? humanizeReportText(next.dynamicFeedback.practicalUnderstanding, { secondPerson: true })
        : next.dynamicFeedback.practicalUnderstanding,
      interviewReadiness: next.dynamicFeedback.interviewReadiness
        ? humanizeReportText(next.dynamicFeedback.interviewReadiness, { secondPerson: true })
        : next.dynamicFeedback.interviewReadiness,
    };
  }
  return next;
};

/** Keep per-question score and feedback narrative from contradicting each other. */
export const alignEvaluationFeedbackToScore = <T extends EvaluationFeedbackShape>(
  evaluation: T,
  options: {
    isCoding?: boolean;
    code?: string;
    answer?: string;
    scoreAlignedFeedback?: string;
    scoreAlignedStrengths?: string[];
  } = {},
): T => {
  const next = humanizeEvaluationFeedback({ ...evaluation });
  const score = next.score ?? 0;
  const code = options.code || '';
  const answer = options.answer || '';
  const feedbackBlob = [
    next.feedback,
    ...(next.dynamicFeedback?.strengths ?? []),
    next.dynamicFeedback?.communication,
  ]
    .filter(Boolean)
    .join(' ');

  const praiseMismatch = contradictoryPraisePattern.test(feedbackBlob) && score < 55;
  const ungroundedHighCoding =
    Boolean(options.isCoding)
    && score >= 55
    && !feedbackGroundsInSubmission(feedbackBlob, answer, code);
  const ungroundedLowCoding =
    Boolean(options.isCoding)
    && score <= 25
    && !feedbackGroundsInSubmission(next.feedback || '', answer, code);

  if (options.scoreAlignedFeedback && (praiseMismatch || ungroundedLowCoding || ungroundedHighCoding)) {
    next.feedback = humanizeReportText(options.scoreAlignedFeedback, { secondPerson: true });
  } else if (praiseMismatch && score <= 25) {
    next.feedback = humanizeReportText(
      options.scoreAlignedFeedback
        || `At ${score}/100, this submission doesn't solve the problem yet — focus on using the inputs and handling edge cases before optimizing.`,
      { secondPerson: true },
    );
  }

  if (next.dynamicFeedback) {
    let strengths = next.dynamicFeedback.strengths ?? [];
    if (score < 40) {
      strengths = strengths.slice(0, score === 0 ? 0 : 1);
    } else if (score < 55) {
      strengths = strengths.slice(0, 2);
    }
    if (
      options.scoreAlignedStrengths?.length
      && (strengths.length === 0 || ungroundedHighCoding)
    ) {
      strengths = options.scoreAlignedStrengths.slice(0, score >= 70 ? 3 : 2);
    }
    if (score < 55 && strengths.some((line) => contradictoryPraisePattern.test(line))) {
      strengths = strengths.filter((line) => !contradictoryPraisePattern.test(line));
    }
    next.dynamicFeedback.strengths = humanizeReportLines(strengths);
  }

  if (options.isCoding && typeof next.technicalScore === 'number') {
    if (Math.abs(next.technicalScore - score) > 15) {
      next.technicalScore = score;
    }
  }

  return next;
};
