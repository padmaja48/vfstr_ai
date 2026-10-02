import { z } from 'zod';
import { getRedis } from '../config/redis';
import { Interview } from '../models/Interview';
import { Report } from '../models/Report';
import { Resume } from '../models/Resume';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import {
  buildJobDescriptionProfile,
  decideAdaptiveFollowUp,
  evaluateAnswer,
  extractEducationEntities,
  generateAdaptiveInterviewQuestion,
  generateInterviewQuestions,
  generateReport,
  transcribeInterviewAnswer,
} from '../services/ai.service';
import { uploadBuffer, uploadText } from '../services/storage.service';
import { assertUserInAdminScope, resourceFilterForScope, scopeFromRequest } from '../middleware/adminScope';
import { getPersonaIntro, getPersonaVoiceStyle, synthesizeSpeech } from '../services/voice.service';
import {
  buildInterviewQuestionSet,
  buildInterviewRoadmap,
  deriveInterviewRuntimeState,
  getCompanyInterviewGuidance,
  getCompanyInterviewGuidanceWithResearch,
  COMPANY_LABELS,
  questionIdentity,
} from '../services/companyQuestions.service';
import { buildCompanyQuestionPack } from '../services/companyQuestionPack.service';
import {
  buildConceptBasedRoleQuestions,
  collectStudentConceptUsage,
  collectStudentRoleConceptUsage,
} from '../services/questionConcept.service';
import { mapExperienceLevel, type CompanyQuestionEntry } from '../services/promptBuilder';
import { slugifyCompanyName } from '../services/companyQuestionBank';
import { incrementQuestionUsage } from '../services/questionBank.service';
import {
  buildReportSessionMeta,
  buildReportTranscriptFromInterview,
  extractSpeakerNameFromAnswer,
  inferQuestionTypeFromContent,
  isMetaInterviewQuestion,
  isNearDuplicateQuestion,
  isSelfIntroductionQuestion,
  sanitizeStoredReportForInterview,
  sharedProjectName,
} from '../services/interviewReport.utils';
import { normalizeReportData } from '../services/report/normalizeReportData';
import { renderReportPdf } from '../services/report/renderReportPdf';

const idParams = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
});

export const interviewParamsSchema = idParams;

export const createInterviewSchema = z.object({
  body: z.object({
    resumeId: z.string().optional(),
    resumeText: z.string().optional(),
    resumeUrl: z.string().url().optional(),
    jobDescription: z.string().max(20000).optional(),
    roleLevel: z.enum(['Fresher', 'Mid', 'Senior', 'Lead']),
    roleDomain: z.string().min(2),
    interviewStyle: z.string().min(2).default('Mixed'),
    duration: z.coerce.number().int().refine((value) => value === 30, 'Interview duration must be 30 minutes').default(30),
    personaId: z.enum(['us-american', 'us-indian', 'us-australian', 'ru-russian']).optional(),
    interviewType: z.enum(['Behavioural', 'Technical', 'Mixed']).optional(),
    interviewMode: z.enum(['sde', 'frontend', 'backend', 'data_analyst', 'ai_ml', 'qa', 'hr_behavioral']).optional(),
    complexity: z.enum(['Beginner', 'Intermediate', 'Advanced']).optional(),
    targetCompany: z.string().min(1).max(120).optional(),
  }),
});

export const startInterviewSchema = z.object({
  body: z.object({
    interviewId: z.string().optional(),
    networkQualityTier: z.enum(['good', 'fair', 'poor']).optional(),
  }),
});

export const answerSchema = z.object({
  body: z.object({
    interviewId: z.string().optional(),
    question: z.string().optional(),
    answer: z.string().min(1),
  }),
});

export const speakSchema = z.object({
  body: z.object({
    text: z.string().min(1),
    voiceStyle: z.enum(['default', 'professional_female', 'professional_male', 'neutral']).default('default'),
    voiceId: z.string().min(1).optional(),
    personaId: z.enum(['us-american', 'us-indian', 'us-australian', 'ru-russian']).optional(),
    pace: z.coerce.number().min(0.75).max(1.35).optional(),
  }),
  params: z.object({
    id: z.string().min(1),
  }),
});

const getInterviewForUser = async (id: string, userId?: string) => {
  const interview = await Interview.findById(id);
  if (!interview) {
    throw new AppError('Interview not found', 404, 'INTERVIEW_NOT_FOUND');
  }

  if (userId && String(interview.userId) !== String(userId)) {
    throw new AppError('You do not have access to this interview', 403, 'INTERVIEW_FORBIDDEN');
  }

  return interview;
};

/** Exported for authz unit tests */
export const __testGetInterviewForUser = getInterviewForUser;

const firstString = (value: unknown) => {
  if (Array.isArray(value)) {
    return value[0];
  }

  return typeof value === 'string' ? value : undefined;
};

const requestedInterviewId = (req: { params: { id?: unknown }; body: { interviewId?: unknown } }) =>
  firstString(req.params.id) ?? firstString(req.body.interviewId);

const writeInterviewState = async (interviewId: string, state: unknown) => {
  try {
    await getRedis().set(`interview:${interviewId}:state`, JSON.stringify(state), 'EX', 60 * 60 * 4);
  } catch (error) {
    console.warn('Interview state cache write failed; continuing with database state.', error);
  }
};

const deleteInterviewState = async (interviewId: string) => {
  try {
    await getRedis().del(`interview:${interviewId}:state`);
  } catch (error) {
    console.warn('Interview state cache delete failed; continuing with database state.', error);
  }
};

const PERSONA_PERSONALITIES: Record<string, string> = {
  'us-american': 'Direct, confident, values concrete examples and measurable outcomes. Uses STAR method prompts.',
  'us-indian': 'Analytical, probes technical depth, asks detailed follow-up questions.',
  'us-australian': 'Relaxed but sharp, tests product thinking and communication clarity.',
  'ru-russian': 'Precise and methodical, focuses on algorithmic thinking and system design, expects rigorous well-reasoned answers.',
};

const getPersonaPersonality = (personaId?: string) =>
  personaId ? (PERSONA_PERSONALITIES[personaId] ?? '') : '';

const packEntriesFromGenerated = (
  questions: Array<{ question?: string; questionType?: string; resumeReference?: string; topic?: string }> = [],
): CompanyQuestionEntry[] =>
  questions
    .filter((item) => item.question)
    .map((item) => {
      const sourceMatch = item.resumeReference?.match(/·\s*(.+)$/);
      const type =
        /coding/i.test(`${item.topic ?? ''} ${item.resumeReference ?? ''}`)
          ? ('coding' as const)
          : item.questionType === 'behavioural'
          ? ('behavioral' as const)
          : item.questionType === 'situational'
          ? ('situational' as const)
          : ('technical' as const);
      return {
        question: item.question as string,
        type,
        source: sourceMatch?.[1],
      };
    });

const buildContextFromInterview = (interview: Awaited<ReturnType<typeof getInterviewForUser>>) => ({
  interviewId: String(interview._id),
  roleLevel: interview.roleLevel,
  roleDomain: interview.roleDomain,
  interviewStyle: (interview as any).interviewType ?? interview.interviewStyle,
  duration: interview.duration,
  resumeText: interview.resumeText,
  jobDescription: (interview as any).jobDescription,
  personaId: (interview as any).personaId,
  personaPersonality: getPersonaPersonality((interview as any).personaId),
  interviewType: (interview as any).interviewType,
  interviewMode: (interview as any).interviewMode,
  complexity: (interview as any).complexity,
  targetCompany: (interview as any).targetCompany,
  resumeSkills: (interview as any).resumeSkills ?? [],
  resumeExperienceLevel: (interview as any).resumeExperienceLevel ?? '',
  resumeSuggestedQuestions: (interview as any).resumeSuggestedQuestions ?? [],
  resumeSummary: (interview as any).resumeSummary ?? '',
  resumeProfile: (interview as any).interviewRoadmap?.resumeProfile,
  previouslyAskedQuestions: (interview as any).previouslyAskedQuestions ?? [],
  companyQuestionBank: (interview as any).companyQuestionBank as CompanyQuestionEntry[] | undefined,
  companyBankMode: (interview as any).companyQuestionSource as
    | 'verified'
    | 'web_research'
    | 'role_based'
    | 'generic'
    | 'none'
    | undefined,
});

const averageMetric = (previous: number | undefined, next: number | undefined, count: number) => {
  if (typeof next !== 'number') return previous;
  if (count <= 1 || typeof previous !== 'number') return Math.round(next);
  return Math.round(((previous * (count - 1)) + next) / count);
};

const getPublicState = (interview: Awaited<ReturnType<typeof getInterviewForUser>>) => ({
  status: interview.status,
  currentQuestionIndex: interview.currentQuestionIndex,
  currentQuestion: interview.questions[interview.currentQuestionIndex],
  totalQuestions: (interview as any).totalPlannedQuestions ?? interview.questions.length,
  questions: interview.questions,
  askedQuestionIds: (interview as any).askedQuestionIds ?? [],
  liveScores: (interview as any).liveScores ?? {},
  violations: interview.violations ?? [],
  faceIncidents: (interview as any).faceIncidents ?? [],
  terminationReason: (interview as any).terminationReason,
});

const ensureQuestionIds = (interview: any) => {
  const askedQuestionIds = new Set<string>(interview.askedQuestionIds ?? []);
  (interview.questions ?? []).forEach((question: any) => {
    question.questionId = question.questionId || questionIdentity(question);
  });
  interview.askedQuestionIds = [...askedQuestionIds];
};

const markQuestionAsked = async (interview: any, index: number) => {
  const question = interview.questions?.[index];
  if (!question) return;
  question.questionId = question.questionId || questionIdentity(question);
  const askedQuestionIds = new Set<string>(interview.askedQuestionIds ?? []);
  askedQuestionIds.add(question.questionId);
  interview.askedQuestionIds = [...askedQuestionIds];
  const bankId = question.bankQuestionId || (
    question.questionId && /^[a-f0-9]{24}$/i.test(question.questionId)
      ? question.questionId
      : undefined
  );
  if (bankId) {
    await incrementQuestionUsage(bankId);
  }
  if (question.conceptId) {
    const askedConceptIds = new Set<string>(interview.askedConceptIds ?? []);
    askedConceptIds.add(String(question.conceptId));
    interview.askedConceptIds = [...askedConceptIds];
  }
};

const toGeneratedQuestion = (item: any) => ({
  question: item.question,
  questionId: item.questionId,
  conceptId: item.conceptId,
  bankQuestionId: item.bankQuestionId || item.questionId,
  expectedSignals: item.expectedSignals ?? [],
  questionType: item.questionType,
  resumeReference: item.resumeReference,
  difficulty: item.difficulty,
  topic: item.topic,
  followUpIntent: item.followUpIntent,
});

export const logViolationSchema = z.object({
  body: z.object({
    type: z.string().min(1),
    description: z.string().optional(),
  }),
  params: z.object({ id: z.string().min(1) }),
});

export const logFaceIncidentSchema = z.object({
  body: z.object({
    type: z.enum(['no_face', 'multiple_faces']),
    startedAt: z.coerce.date(),
    durationMs: z.coerce.number().int().min(0),
    endedAt: z.coerce.date().optional(),
    description: z.string().max(500).optional(),
  }),
  params: z.object({ id: z.string().min(1) }),
});

export const terminateInterviewSchema = z.object({
  body: z.object({
    reasonType: z.enum(['fullscreen_exit', 'tab_switch']),
    questionIndex: z.coerce.number().int().min(0).optional(),
  }),
  params: z.object({ id: z.string().min(1) }),
});

export const logViolation = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { type, description } = req.body as { type: string; description?: string };
  const interview = await Interview.findOneAndUpdate(
    { _id: id, userId: req.userId },
    { $push: { violations: { type, description: description ?? '', timestamp: new Date() } } },
    { new: true },
  );
  if (!interview) throw new AppError('Interview not found', 404, 'INTERVIEW_NOT_FOUND');
  res.json({ violations: interview.violations });
});

export const logFaceIncident = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { type, startedAt, durationMs, endedAt, description } = req.body as {
    type: 'no_face' | 'multiple_faces';
    startedAt: Date;
    durationMs: number;
    endedAt?: Date;
    description?: string;
  };
  const interview = await Interview.findOneAndUpdate(
    { _id: id, userId: req.userId },
    {
      $push: {
        faceIncidents: {
          type,
          startedAt,
          durationMs,
          endedAt: endedAt ?? new Date(),
          description: description ?? '',
        },
      },
    },
    { new: true },
  );
  if (!interview) throw new AppError('Interview not found', 404, 'INTERVIEW_NOT_FOUND');
  res.json({ faceIncidents: interview.faceIncidents });
});

export const createInterview = asyncHandler(async (req, res) => {
  let resumeSkills: string[] = [];
  let resumeExperienceLevel = '';
  let resumeSuggestedQuestions: string[] = [];
  let resumeSummary = '';
  let resumeText = req.body.resumeText ?? '';

  if (req.body.resumeId) {
    const resume = await Resume.findOne({ _id: req.body.resumeId, userId: req.userId });
    if (resume) {
      resumeText = resume.rawText ?? resumeText;
      resumeSkills = resume.analysis?.skills ?? [];
      resumeExperienceLevel = resume.analysis?.experienceLevel ?? '';
      resumeSuggestedQuestions = resume.analysis?.suggestedQuestions ?? [];
      resumeSummary = resume.analysis?.summary ?? '';
    }
  }

  const jdProfile = buildJobDescriptionProfile(req.body.jobDescription, {
    roleLevel: req.body.roleLevel,
    roleDomain: req.body.roleDomain,
    resumeSkills,
  });
  const companyGuidance =
    (await getCompanyInterviewGuidanceWithResearch({
      targetCompany: req.body.targetCompany,
      roleDomain: req.body.roleDomain,
    })) ?? getCompanyInterviewGuidance(req.body.targetCompany);
  const interviewRoadmap = buildInterviewRoadmap({
    resumeText,
    resumeSkills,
    resumeSummary,
    roleDomain: req.body.roleDomain,
    roleLevel: req.body.roleLevel,
    duration: req.body.duration ?? 30,
    complexity: req.body.complexity,
    targetCompany: req.body.targetCompany,
    jdProfile,
    companyGuidance,
  });
  const interviewState = deriveInterviewRuntimeState({
    roadmap: interviewRoadmap,
    transcript: [],
  });

  const interview = await Interview.create({
    userId: req.userId,
    ...req.body,
    resumeText,
    resumeSkills,
    resumeExperienceLevel,
    resumeSuggestedQuestions,
    resumeSummary,
    jdProfile,
    companyGuidance,
    interviewRoadmap,
    interviewState,
    totalPlannedQuestions: interviewRoadmap.targetQuestionCount,
    liveScores: {},
    status: 'Setup',
  });

  res.status(201).json(interview);
});

export const getUserInterviews = asyncHandler(async (req, res) => {
  const interviews = await Interview.find({ userId: req.userId })
    .populate('userId', 'name email')
    .sort({ createdAt: -1 });
  res.json(interviews);
});

export const getInterview = asyncHandler(async (req, res) => {
  const interviewId = requestedInterviewId(req);
  if (!interviewId) {
    throw new AppError('Interview id is required', 400, 'INTERVIEW_ID_REQUIRED');
  }

  const interview = await getInterviewForUser(interviewId, req.userId);
  await interview.populate('userId', 'name email');
  res.json(interview);
});

export const startInterview = asyncHandler(async (req, res) => {
  const interviewId = requestedInterviewId(req);
  if (!interviewId) {
    throw new AppError('Interview id is required', 400, 'INTERVIEW_ID_REQUIRED');
  }

  const interview = await getInterviewForUser(interviewId, req.userId);

  if (!(interview as any).jdProfile) {
    (interview as any).jdProfile = buildJobDescriptionProfile((interview as any).jobDescription, {
      roleLevel: interview.roleLevel,
      roleDomain: interview.roleDomain,
      resumeSkills: (interview as any).resumeSkills ?? [],
    });
  }
  if (!(interview as any).companyGuidance) {
    (interview as any).companyGuidance =
      (await getCompanyInterviewGuidanceWithResearch({
        targetCompany: (interview as any).targetCompany,
        roleDomain: interview.roleDomain,
      })) ?? getCompanyInterviewGuidance((interview as any).targetCompany);
  }
  if (!(interview as any).interviewRoadmap) {
    (interview as any).interviewRoadmap = buildInterviewRoadmap({
      resumeText: interview.resumeText,
      resumeSkills: (interview as any).resumeSkills ?? [],
      resumeSummary: (interview as any).resumeSummary,
      roleDomain: interview.roleDomain,
      roleLevel: interview.roleLevel,
      duration: interview.duration,
      complexity: (interview as any).complexity,
      targetCompany: (interview as any).targetCompany,
      jdProfile: (interview as any).jdProfile,
      companyGuidance: (interview as any).companyGuidance,
    });
  }
  if (!(interview as any).interviewState) {
    (interview as any).interviewState = deriveInterviewRuntimeState({
      roadmap: (interview as any).interviewRoadmap,
      transcript: [],
    });
  }
  (interview as any).totalPlannedQuestions =
    (interview as any).interviewRoadmap?.targetQuestionCount ?? (interview as any).totalPlannedQuestions;

  if (interview.questions.length === 0) {
    let researchedCompanyQuestions: import('../services/ai.service').GeneratedQuestion[] = [];
    let roleConceptQuestions: import('../services/ai.service').GeneratedQuestion[] = [];
    const targetCompany = (interview as any).targetCompany as string | undefined;
    const recentInterviews = await Interview.find({
      userId: req.userId,
      _id: { $ne: interview._id },
      'questions.0': { $exists: true },
    })
      .select('questions resumeId resumeText targetCompany roleDomain askedConceptIds createdAt')
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    const sameResumeInterviews = recentInterviews.filter((recentInterview: any) => {
      const interviewResumeId = (interview as any).resumeId;
      if (interviewResumeId && recentInterview.resumeId) {
        return String(recentInterview.resumeId) === String(interviewResumeId);
      }
      const left = interview.resumeText?.trim();
      const right = recentInterview.resumeText?.trim();
      return Boolean(left && right && left === right);
    });

    const previouslyAskedQuestions = recentInterviews.flatMap((recentInterview: any) =>
      (recentInterview.questions ?? [])
        .map((question: any) => String(question.question || '').trim())
        .filter(Boolean),
    );
    const recentQuestionHistory = recentInterviews.map((recentInterview: any) =>
      (recentInterview.questions ?? []).map((question: any) => question.questionId || questionIdentity(question)),
    );
    const questionVariantOffset = sameResumeInterviews.length;

    (interview as any).previouslyAskedQuestions = previouslyAskedQuestions;

    if (targetCompany) {
      const resumeProject =
        (interview as any).interviewRoadmap?.resumeProfile?.projects?.[0] as string | undefined;
      const resumeSkills = ((interview as any).resumeSkills ?? []) as string[];
      const companySlug = slugifyCompanyName(targetCompany);
      const { excludedConceptIds, studentConceptHistory } = collectStudentConceptUsage(
        recentInterviews as any[],
        companySlug,
      );
      const pack = await buildCompanyQuestionPack({
        companyName: targetCompany,
        role: interview.roleDomain,
        experienceLevel: mapExperienceLevel(interview.roleLevel),
        resumeProject,
        resumeSkills,
        excludedConceptIds,
        studentConceptHistory,
      }).catch(() => ({
        questions: [] as import('../services/ai.service').GeneratedQuestion[],
        mode: 'role_based' as const,
        companyLabel: targetCompany,
        composition: { culture: 0, technical: 0, coding: 0 },
      }));

      researchedCompanyQuestions = pack.questions;
      (interview as any).companyQuestionSource = pack.mode;
      (interview as any).companyQuestionComposition = pack.composition;
      (interview as any).companyQuestionBank = packEntriesFromGenerated(pack.questions);
    } else {
      const resumeProject = (interview as any).interviewRoadmap?.resumeProfile?.projects?.[0] as string | undefined;
      const resumeSkills = ((interview as any).resumeSkills ?? []) as string[];
      const { excludedConceptIds, studentConceptHistory } = collectStudentRoleConceptUsage(
        recentInterviews as any[],
        interview.roleDomain,
      );
      roleConceptQuestions = await buildConceptBasedRoleQuestions({
        role: interview.roleDomain,
        experienceLevel: mapExperienceLevel(interview.roleLevel),
        resumeProject,
        resumeSkills,
        excludedConceptIds,
        studentConceptHistory,
      }).catch(() => [] as import('../services/ai.service').GeneratedQuestion[]);
      (interview as any).roleQuestionSource = roleConceptQuestions.length ? 'concept_pool' : 'none';
    }

    // Always allow AI to fill resume/role gaps; company pack supplies the company stage.
    const useAiGeneration = true;
    const generated = await generateInterviewQuestions(buildContextFromInterview(interview)).catch(() => ({
      questions: [],
    }));

    interview.questions = buildInterviewQuestionSet({
      generatedQuestions: generated.questions,
      targetCompany,
      duration: interview.duration,
      interviewRoadmap: (interview as any).interviewRoadmap,
      prioritizeGenerated: useAiGeneration && Boolean((interview as any).jobDescription?.trim()),
      researchedCompanyQuestions,
      roleConceptQuestions,
      randomize: true,
      recentQuestionHistory,
      previouslyAskedQuestions,
      questionVariantOffset,
    });
  }

  ensureQuestionIds(interview);
  await markQuestionAsked(interview, interview.currentQuestionIndex);

  interview.status = 'In Progress';
  interview.startedAt = interview.startedAt ?? new Date();
  if (req.body.networkQualityTier) {
    (interview as any).networkQualityTier = req.body.networkQualityTier;
  }
  await interview.save();

  const state = getPublicState(interview);

  await writeInterviewState(String(interview._id), state);
  res.json({ interview, state });
});

export const submitAnswer = asyncHandler(async (req, res) => {
  const interviewId = requestedInterviewId(req);
  if (!interviewId) {
    throw new AppError('Interview id is required', 400, 'INTERVIEW_ID_REQUIRED');
  }

  const interview = await getInterviewForUser(interviewId, req.userId);
  ensureQuestionIds(interview);
  const questionIndex = interview.currentQuestionIndex;
  const currentQuestion = interview.questions[questionIndex]?.question ?? req.body.question;

  if (!currentQuestion) {
    throw new AppError('No active question found', 400, 'NO_ACTIVE_QUESTION');
  }

  const activeQuestion = interview.questions[questionIndex];
  const resumeProjects =
    (interview as any).interviewRoadmap?.resumeProfile?.projects ?? [];
  const resumeSkills = [
    ...((interview as any).resumeSkills ?? []),
    ...((interview as any).interviewRoadmap?.resumeProfile?.skills?.programmingLanguages ?? []),
    ...((interview as any).interviewRoadmap?.resumeProfile?.skills?.frameworks ?? []),
    ...((interview as any).interviewRoadmap?.resumeProfile?.skills?.technicalSkills ?? []),
  ].filter(Boolean);

  // Meta / process lines are not interview questions — do not score them.
  if (isMetaInterviewQuestion(currentQuestion)) {
    if (interview.questions[questionIndex]) {
      interview.questions[questionIndex].userAnswer = req.body.answer || '(skipped)';
      interview.questions[questionIndex].feedback =
        'This was a process prompt, not an interview question, so it was not scored.';
      interview.questions[questionIndex].score = 0;
      interview.questions[questionIndex].idealAnswer =
        'Interviewers should ask a real project, coding, company, or HR question instead of "Are you ready?" prompts.';
      interview.questions[questionIndex].samplePerfectAnswer =
        'No candidate answer was needed here. Continue with the next substantive interview question.';
      interview.questions[questionIndex].conceptsCovered = [];
      interview.questions[questionIndex].missingConcepts = [];
    }
  }

  const evaluation = isMetaInterviewQuestion(currentQuestion)
    ? {
        score: 0,
        feedback: 'This was a process prompt, not an interview question, so it was not scored.',
        idealAnswer:
          'Interviewers should ask a real project, coding, company, or HR question instead of "Are you ready?" prompts.',
        samplePerfectAnswer:
          'No candidate answer was needed here. Continue with the next substantive interview question.',
        conceptsCovered: [],
        missingConcepts: [],
        incorrectStatements: [],
        wrongTerminology: [],
        technicalMistakes: [],
        dynamicFeedback: {
          strengths: [],
          missingConcepts: [],
          technicalMistakes: [],
          communication: 'N/A',
          confidence: 'N/A',
          areasToImprove: [],
          nextLearningSuggestions: [],
          practicalUnderstanding: 'N/A',
          interviewReadiness: 'N/A',
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
        nextAction: 'move_topic' as const,
        suggestedDifficulty: 'easy' as const,
        detectedSignals: [],
        missingSignals: [],
      }
    : await evaluateAnswer(currentQuestion, req.body.answer, {
        interviewId: String(interview._id),
        expectedSignals: activeQuestion?.expectedSignals ?? [],
        roleDomain: interview.roleDomain,
        roleLevel: interview.roleLevel,
        targetCompany: (interview as any).targetCompany,
        difficulty: activeQuestion?.difficulty,
        questionType: activeQuestion?.questionType,
        topic: activeQuestion?.topic,
        resumeProjects,
        resumeSkills,
        resumeText: interview.resumeText,
      });

  if (interview.questions[questionIndex] && !isMetaInterviewQuestion(currentQuestion)) {
    interview.questions[questionIndex].userAnswer = req.body.answer;
    interview.questions[questionIndex].feedback = evaluation.feedback;
    interview.questions[questionIndex].score = evaluation.score;
    interview.questions[questionIndex].idealAnswer = evaluation.idealAnswer;
    interview.questions[questionIndex].samplePerfectAnswer = evaluation.samplePerfectAnswer;
    interview.questions[questionIndex].conceptsCovered = evaluation.conceptsCovered;
    interview.questions[questionIndex].missingConcepts = evaluation.missingConcepts;
    interview.questions[questionIndex].incorrectStatements = evaluation.incorrectStatements;
    interview.questions[questionIndex].wrongTerminology = evaluation.wrongTerminology;
    interview.questions[questionIndex].technicalMistakes = evaluation.technicalMistakes;
    interview.questions[questionIndex].dynamicFeedback = evaluation.dynamicFeedback;
    interview.questions[questionIndex].questionType = inferQuestionTypeFromContent(
      currentQuestion,
      interview.interviewMode,
      interview.questions[questionIndex].questionType,
    );
  } else if (!interview.questions[questionIndex]) {
    interview.questions.push({
      question: currentQuestion,
      userAnswer: req.body.answer,
      feedback: evaluation.feedback,
      score: evaluation.score,
      idealAnswer: evaluation.idealAnswer,
      samplePerfectAnswer: evaluation.samplePerfectAnswer,
      conceptsCovered: evaluation.conceptsCovered,
      missingConcepts: evaluation.missingConcepts,
      incorrectStatements: evaluation.incorrectStatements,
      wrongTerminology: evaluation.wrongTerminology,
      technicalMistakes: evaluation.technicalMistakes,
      dynamicFeedback: evaluation.dynamicFeedback,
    });
  }

  if (!(interview as any).speakerName && isSelfIntroductionQuestion(currentQuestion)) {
    const extracted = extractSpeakerNameFromAnswer(req.body.answer, currentQuestion);
    if (extracted.name && extracted.confidence !== 'low') {
      (interview as any).speakerName = extracted.name;
      (interview as any).speakerNameConfidence = extracted.confidence;
    }
  }

  const answeredCount = interview.questions.filter((item) => typeof item.score === 'number').length;
  const liveScores = (interview as any).liveScores ?? {};
  (interview as any).liveScores = {
    confidence: averageMetric(liveScores.confidence, evaluation.confidenceScore, answeredCount),
    completeness: averageMetric(liveScores.completeness, evaluation.completenessScore, answeredCount),
    depth: averageMetric(liveScores.depth, evaluation.depthScore, answeredCount),
    terminology: averageMetric(liveScores.terminology, evaluation.terminologyScore, answeredCount),
    grammar: averageMetric(liveScores.grammar, evaluation.grammarScore, answeredCount),
    vocabulary: averageMetric(liveScores.vocabulary, evaluation.vocabularyScore, answeredCount),
    domain: averageMetric(liveScores.domain, evaluation.domainScore, answeredCount),
  };

  const nextIndex = questionIndex + 1;
  const targetQuestionCount = (interview as any).totalPlannedQuestions ?? interview.questions.length;
  const answeredTranscript = interview.questions.slice(0, nextIndex).map((item) => ({
    question: item.question,
    answer: item.userAnswer,
    score: item.score,
    feedback: item.feedback,
    questionType: item.questionType,
    resumeReference: item.resumeReference,
    difficulty: item.difficulty,
    topic: item.topic,
    idealAnswer: (item as any).idealAnswer,
    samplePerfectAnswer: (item as any).samplePerfectAnswer,
    conceptsCovered: (item as any).conceptsCovered,
    missingConcepts: (item as any).missingConcepts,
    incorrectStatements: (item as any).incorrectStatements,
    wrongTerminology: (item as any).wrongTerminology,
    technicalMistakes: (item as any).technicalMistakes,
    dynamicFeedback: (item as any).dynamicFeedback,
  }));
  (interview as any).interviewState = deriveInterviewRuntimeState({
    roadmap: (interview as any).interviewRoadmap,
    transcript: answeredTranscript,
  });

  if (nextIndex < targetQuestionCount) {
    const plannedNextQuestion = interview.questions[nextIndex];
    if (plannedNextQuestion && activeQuestion) {
      const followUpDecision = decideAdaptiveFollowUp({
        evaluation,
        lastQuestion: toGeneratedQuestion(activeQuestion),
        position: nextIndex,
        total: targetQuestionCount,
        transcript: answeredTranscript,
        resumeProjects,
      });

      const adaptiveTurn = await generateAdaptiveInterviewQuestion({
        ...buildContextFromInterview(interview),
        previousQuestions: interview.questions.slice(0, nextIndex).map(toGeneratedQuestion),
        transcript: answeredTranscript,
        lastQuestion: toGeneratedQuestion(activeQuestion),
        lastAnswer: req.body.answer,
        lastEvaluation: evaluation,
        followUpDecision,
        targetQuestionCount,
        currentQuestionIndex: questionIndex,
        jdProfile: (interview as any).jdProfile,
        companyGuidance: (interview as any).companyGuidance,
        interviewRoadmap: (interview as any).interviewRoadmap,
        interviewState: (interview as any).interviewState,
      }).catch(() => undefined);

      const plannedGenerated = plannedNextQuestion
        ? toGeneratedQuestion(plannedNextQuestion)
        : undefined;
      const plannedSameProject = Boolean(
        plannedGenerated
        && sharedProjectName(
          `${plannedGenerated.question} ${plannedGenerated.topic || ''}`,
          `${activeQuestion.question} ${activeQuestion.topic || ''}`,
          resumeProjects,
        ),
      );

      // When moving topics, prefer adaptive over a planned question stuck on the same project.
      const candidates = (
        followUpDecision.action === 'move_topic'
          ? [adaptiveTurn?.question, plannedSameProject ? undefined : plannedGenerated]
          : [adaptiveTurn?.question, plannedGenerated]
      ).filter(Boolean) as ReturnType<typeof toGeneratedQuestion>[];

      const nextQuestion =
        candidates.find(
          (item) =>
            !isSelfIntroductionQuestion(item.question || '')
            && !isMetaInterviewQuestion(item.question || ''),
        ) ?? candidates[0];

      const askedQuestionIds = new Set<string>(interview.askedQuestionIds ?? []);
      const isDuplicate = nextQuestion
        ? interview.questions
            .slice(0, nextIndex)
            .some((item) => isNearDuplicateQuestion(item.question, nextQuestion.question))
            || askedQuestionIds.has(questionIdentity(nextQuestion.question))
        : true;

      if (nextQuestion && !isDuplicate && !isMetaInterviewQuestion(nextQuestion.question)) {
        nextQuestion.questionType = inferQuestionTypeFromContent(
          nextQuestion.question,
          interview.interviewMode,
          nextQuestion.questionType,
        );
        nextQuestion.questionId = questionIdentity(nextQuestion.question);
        interview.questions[nextIndex] = nextQuestion;
      } else if (plannedGenerated && isMetaInterviewQuestion(plannedGenerated.question)) {
        // Replace meta planned questions with a bridge away from the last project.
        const bridgeProject =
          resumeProjects.find(
            (name: string) =>
              !sharedProjectName(
                `${activeQuestion.question} ${activeQuestion.topic || ''}`,
                name,
                [name],
              ),
          ) || resumeProjects[1] || resumeProjects[0] || interview.roleDomain;
        interview.questions[nextIndex] = {
          question: `Let's switch topics. In ${bridgeProject}, what was the hardest challenge and how did you solve it?`,
          expectedSignals: ['specific challenge', 'actions taken', 'result'],
          questionType: 'technical',
          resumeReference: `Projects: ${bridgeProject}`,
          difficulty: 'medium',
          topic: bridgeProject,
          followUpIntent: 'bridge-topic',
        } as any;
      }
    }
    interview.markModified('questions');
  }
  interview.markModified('interviewState');

  interview.currentQuestionIndex = nextIndex; // may equal target count; that signals completion
  await markQuestionAsked(interview, nextIndex);
  await interview.save();

  const state = getPublicState(interview);

  await writeInterviewState(String(interview._id), state);
  res.json({ interview, evaluation, state });
});

const reportCreationLocks = new Map<string, Promise<any>>();

const createInterviewReport = async (interview: any, userId: string) => {
  const interviewId = String(interview._id);
  const existingReport = await Report.findOne({ interviewId: interview._id }).sort({ createdAt: -1 });
  if (existingReport) return existingReport;

  const inFlight = reportCreationLocks.get(interviewId);
  if (inFlight) return inFlight;

  const promise = (async () => {
    const lockedExisting = await Report.findOne({ interviewId: interview._id }).sort({ createdAt: -1 });
    if (lockedExisting) return lockedExisting;

    await interview.populate('userId', 'name email');
  const accountOwnerName =
    interview.accountOwnerName
    || (typeof interview.userId === 'object' && interview.userId !== null ? interview.userId.name : undefined);
  if (!interview.accountOwnerName && accountOwnerName) interview.accountOwnerName = accountOwnerName;

  const transcript = buildReportTranscriptFromInterview(interview);
  const sessionMeta = buildReportSessionMeta(interview, transcript);
  const aiReportRaw = await generateReport(transcript, {
    interviewId: String(interview._id),
    speakerName: interview.speakerName,
    accountOwnerName,
    targetCompany: interview.targetCompany,
    interviewMode: interview.interviewMode,
    resumeProjects: interview.interviewRoadmap?.resumeProfile?.projects ?? [],
    resumeSkills: [
      ...(interview.resumeSkills ?? []),
      ...(interview.interviewRoadmap?.resumeProfile?.skills?.programmingLanguages ?? []),
      ...(interview.interviewRoadmap?.resumeProfile?.skills?.frameworks ?? []),
    ].filter(Boolean),
    liveScores: (interview as any).liveScores,
    totalPlannedQuestions: sessionMeta.totalPlannedQuestions,
    sessionMeta,
  });
  const aiReport = sanitizeStoredReportForInterview(
    aiReportRaw as Record<string, unknown>,
    typeof interview.toObject === 'function' ? interview.toObject() : interview,
  ) as typeof aiReportRaw;
  const storedReport = await uploadText(JSON.stringify(aiReport, null, 2), `interview-${interview._id}.json`, 'reports');
  const report = await Report.create({
    userId,
    interviewId: interview._id,
    reportUrl: storedReport.url,
    ...aiReport,
    questionAnalysis: aiReport.questionAnalysis ?? [],
  });

  interview.totalScore = aiReport.overallScore;
  interview.scores = {
    communication: aiReport.communicationScore,
    technical: aiReport.technicalScore,
    behavioral: aiReport.behavioralScore,
  };
  interview.feedbackSummary = {
    strengths: aiReport.strengths,
    improvements: aiReport.improvements,
    overallFeedback: aiReport.transcriptSummary,
  };
  interview.reportUrl = storedReport.url;
  await interview.save();
  return report;
  })().finally(() => {
    reportCreationLocks.delete(interviewId);
  });

  reportCreationLocks.set(interviewId, promise);
  return promise;
};

const toPlainInterview = (interview: any) =>
  (typeof interview?.toObject === 'function' ? interview.toObject() : interview);

const toPlainReport = (report: any) =>
  (report && typeof report.toObject === 'function' ? report.toObject() : report);

const withSanitizedReport = (interview: any, report: any) => {
  const interviewObj = toPlainInterview(interview);
  return {
    interview: interviewObj,
    report: sanitizeStoredReportForInterview(toPlainReport(report), interviewObj),
  };
};

export const getInterviewReport = asyncHandler(async (req, res) => {
  const interview = await Interview.findOne({ _id: req.params.id, userId: req.userId })
    .populate('userId', 'name email');
  if (!interview) throw new AppError('Not found', 404, 'NOT_FOUND');
  const report = await Report.findOne({ interviewId: interview._id }).sort({ createdAt: -1 });
  res.json(withSanitizedReport(interview, report));
});

const loadInterviewReportBundle = async (interviewId: string, userId: string) => {
  const interview = await Interview.findOne({ _id: interviewId, userId })
    .populate('userId', 'name email');
  if (!interview) throw new AppError('Not found', 404, 'NOT_FOUND');
  const report = await Report.findOne({ interviewId: interview._id }).sort({ createdAt: -1 });
  if (!report) throw new AppError('Report not found', 404, 'REPORT_NOT_FOUND');
  const bundle = withSanitizedReport(interview, report);
  return { interview, report, bundle };
};

const findPreviousOverallScore = async (
  userId: string,
  roleDomain: string | undefined,
  currentInterviewId: string,
) => {
  const filter: Record<string, unknown> = {
    userId,
    _id: { $ne: currentInterviewId },
    status: { $in: ['Completed', 'Terminated'] },
  };
  if (roleDomain) filter.roleDomain = roleDomain;

  const previous = await Interview.findOne(filter)
    .sort({ completedAt: -1, createdAt: -1 })
    .select('_id totalScore');
  if (!previous) return null;

  const prevReport = await Report.findOne({ interviewId: previous._id }).sort({ createdAt: -1 });
  if (prevReport?.overallScore != null) return Number(prevReport.overallScore);
  if (previous.totalScore != null) return Number(previous.totalScore);
  return null;
};

export const getInterviewReportPdf = asyncHandler(async (req, res) => {
  const { interview, bundle } = await loadInterviewReportBundle(String(req.params.id), String(req.userId));
  const interviewObj = bundle.interview as Record<string, unknown>;
  const reportObj = bundle.report as Record<string, unknown>;
  const userObj = typeof interview.userId === 'object' && interview.userId !== null
    ? (interview.userId as { name?: string; email?: string })
    : undefined;

  const previousOverallScore = await findPreviousOverallScore(
    String(req.userId),
    interview.roleDomain,
    String(interview._id),
  );

  const clean = normalizeReportData({
    report: reportObj,
    interview: interviewObj,
    user: userObj,
    previousOverallScore,
  });

  const pdf = await renderReportPdf(clean);
  const safeName = String(clean.candidate.name || 'candidate')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'candidate';

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}-interview-report.pdf"`);
  res.send(pdf);
});

export const completeInterview = asyncHandler(async (req, res) => {
  const interviewId = requestedInterviewId(req);
  if (!interviewId) {
    throw new AppError('Interview id is required', 400, 'INTERVIEW_ID_REQUIRED');
  }

  const interview = await getInterviewForUser(interviewId, req.userId);
  if (interview.status === 'Completed' || interview.status === 'Terminated') {
    const report = await Report.findOne({ interviewId: interview._id }).sort({ createdAt: -1 });
    await deleteInterviewState(String(interview._id));
    res.json(withSanitizedReport(interview, report));
    return;
  }
  const report = await createInterviewReport(interview, req.userId!);
  interview.status = 'Completed';
  interview.completedAt = new Date();
  await interview.save();

  await deleteInterviewState(String(interview._id));
  res.json(withSanitizedReport(interview, report));
});

export const terminateInterview = asyncHandler(async (req, res) => {
  const interviewId = requestedInterviewId(req);
  if (!interviewId) throw new AppError('Interview id is required', 400, 'INTERVIEW_ID_REQUIRED');

  const interview = await getInterviewForUser(interviewId, req.userId);
  if (interview.status === 'Terminated' || interview.status === 'Completed') {
    const report = await Report.findOne({ interviewId: interview._id }).sort({ createdAt: -1 });
    res.json(withSanitizedReport(interview, report));
    return;
  }

  const { reasonType, questionIndex } = req.body as {
    reasonType: 'fullscreen_exit' | 'tab_switch';
    questionIndex?: number;
  };
  interview.status = 'Terminated';
  interview.terminatedAt = new Date();
  interview.terminationReason = `integrity_violation:${reasonType}`;
  interview.terminationQuestionIndex = Math.max(
    interview.currentQuestionIndex,
    questionIndex ?? 0,
  );
  interview.completedAt = new Date();
  await interview.save();

  const report = await createInterviewReport(interview, req.userId!);
  await deleteInterviewState(String(interview._id));
  res.json(withSanitizedReport(interview, report));
});

export const getInterviewState = asyncHandler(async (req, res) => {
  const interviewId = requestedInterviewId(req);
  if (!interviewId) {
    throw new AppError('Interview id is required', 400, 'INTERVIEW_ID_REQUIRED');
  }

  const interview = await getInterviewForUser(interviewId, req.userId);
  const cached = await getRedis().get(`interview:${interview._id}:state`).catch((error) => {
    console.warn('Interview state cache read failed; using database state.', error);
    return null;
  });
  res.json(cached ? JSON.parse(cached) : getPublicState(interview));
});

export const synthesizeQuestion = asyncHandler(async (req, res) => {
  const interviewId = requestedInterviewId(req);
  if (!interviewId) {
    throw new AppError('Interview id is required', 400, 'INTERVIEW_ID_REQUIRED');
  }

  const interview = await getInterviewForUser(interviewId, req.userId);
  const personaId = (interview as any).personaId as string | undefined;
  const requestedPersonaId = req.body.personaId as string | undefined;
  if (personaId && requestedPersonaId && personaId !== requestedPersonaId) {
    throw new AppError('The requested voice does not match the selected interviewer persona.', 400, 'INTERVIEW_PERSONA_VOICE_MISMATCH');
  }
  const effectivePersonaId = personaId || requestedPersonaId;
  const voiceStyle = effectivePersonaId ? getPersonaVoiceStyle(effectivePersonaId) : req.body.voiceStyle;
  const audio = await synthesizeSpeech(req.body.text, voiceStyle, effectivePersonaId, undefined, {
    context: 'interview',
    pace: req.body.pace ?? 1.0,
    voiceId: req.body.voiceId,
  });
  res.setHeader('X-TTS-Cache-Key', audio.cacheKey);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.type(audio.contentType).send(audio.buffer);
});

/* ── Persona voice preview (no interview session required) ─────── */
export const personaPreviewSchema = z.object({
  body: z.object({
    personaId: z.enum(['us-american', 'us-indian', 'us-australian', 'ru-russian']),
    voiceId: z.string().min(1).optional(),
  }),
});

export const personaVoicePreview = asyncHandler(async (req, res) => {
  const { personaId } = req.body as { personaId: string };
  const intro = getPersonaIntro(personaId);
  const voiceStyle = getPersonaVoiceStyle(personaId);
  const audio = await synthesizeSpeech(intro, voiceStyle, personaId, undefined, {
    context: 'preview',
    pace: 1.0,
  });
  res.setHeader('X-TTS-Cache-Key', audio.cacheKey);
  res.setHeader('X-TTS-Text', encodeURIComponent(intro));
  res.setHeader('X-TTS-Persona-Id', personaId);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.type(audio.contentType).send(audio.buffer);
});

export const transcribeRecording = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('Audio file is required', 400, 'FILE_REQUIRED');
  }

  const interviewId = requestedInterviewId(req);
  if (!interviewId) {
    throw new AppError('Interview id is required', 400, 'INTERVIEW_ID_REQUIRED');
  }

  const interview = await getInterviewForUser(interviewId, req.userId);
  const resumeProfile = (interview as any).interviewRoadmap?.resumeProfile;
  const transcription = await transcribeInterviewAnswer(req.file, {
    interviewId: String(interview._id),
    roleDomain: interview.roleDomain,
    currentQuestion: interview.questions[interview.currentQuestionIndex]?.question,
    jobDescription: (interview as any).jobDescription,
    resumeSkills: (interview as any).resumeSkills ?? [],
    resumeProjects: resumeProfile?.projects ?? [],
    resumeSummary: (interview as any).resumeSummary,
    resumeText: interview.resumeText?.slice(0, 4000),
    resumeEducation: extractEducationEntities(interview.resumeText),
    targetCompany: (interview as any).targetCompany,
  });
  res.json(transcription);
});

export const uploadRecording = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('Recording file is required', 400, 'FILE_REQUIRED');
  }

  const interviewId = requestedInterviewId(req);
  if (!interviewId) {
    throw new AppError('Interview id is required', 400, 'INTERVIEW_ID_REQUIRED');
  }

  const interview = await getInterviewForUser(interviewId, req.userId);
  const stored = await uploadBuffer(req.file, 'recordings');
  interview.recordingUrl = stored.url;
  await interview.save();

  res.json({ interview, recording: stored });
});

/** Admin: interview list scoped to caller's institution (or global for superAdmin). */
export const adminListInterviews = asyncHandler(async (req, res) => {
  const scope = scopeFromRequest(req);
  const filter = await resourceFilterForScope(scope);

  const interviews = await Interview.find(filter)
    .populate('userId', 'name email institution institutionId role batch branch')
    .sort({ createdAt: -1 })
    .lean();
  res.json(interviews);
});

/** Admin: single interview + report — scoped. */
export const adminGetInterview = asyncHandler(async (req, res) => {
  const interviewId = req.params.id;
  if (!interviewId) {
    throw new AppError('Interview id is required', 400, 'INTERVIEW_ID_REQUIRED');
  }

  const interview = await Interview.findById(interviewId)
    .populate('userId', 'name email institution institutionId role batch branch')
    .lean();
  if (!interview) throw new AppError('Interview not found', 404, 'NOT_FOUND');

  const userId = typeof interview.userId === 'object' && interview.userId?._id
    ? String(interview.userId._id)
    : String(interview.userId);
  await assertUserInAdminScope(scopeFromRequest(req), userId);

  const report = await Report.findOne({ interviewId: interview._id }).lean();
  res.json(withSanitizedReport(interview, report));
});

/** Admin: download interview report PDF — scoped to assigned institutions. */
export const adminGetInterviewReportPdf = asyncHandler(async (req, res) => {
  const interviewId = String(req.params.id);
  const interview = await Interview.findById(interviewId).populate('userId', 'name email');
  if (!interview) throw new AppError('Not found', 404, 'NOT_FOUND');

  const ownerId = typeof interview.userId === 'object' && interview.userId !== null
    ? String((interview.userId as { _id: unknown })._id)
    : String(interview.userId);
  await assertUserInAdminScope(scopeFromRequest(req), ownerId);

  const { bundle } = await loadInterviewReportBundle(interviewId, ownerId);
  const interviewObj = bundle.interview as Record<string, unknown>;
  const reportObj = bundle.report as Record<string, unknown>;
  const userObj = typeof interview.userId === 'object' && interview.userId !== null
    ? (interview.userId as { name?: string; email?: string })
    : undefined;

  const previousOverallScore = await findPreviousOverallScore(
    ownerId,
    interview.roleDomain,
    interviewId,
  );

  const clean = normalizeReportData({
    report: reportObj,
    interview: interviewObj,
    user: userObj,
    previousOverallScore,
  });

  const pdf = await renderReportPdf(clean);
  const safeName = String(clean.candidate.name || 'candidate')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'candidate';

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}-interview-report.pdf"`);
  res.send(pdf);
});

export const __testCreateInterviewReport = createInterviewReport;
