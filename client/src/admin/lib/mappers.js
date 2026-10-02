/** Map Mongo/API documents into admin UI row shapes. */

const idOf = (doc) => {
  if (!doc) return '';
  if (typeof doc === 'string') return doc;
  return String(doc._id || doc.id || '');
};

const userOf = (doc) => {
  if (!doc) return null;
  if (typeof doc === 'string') return { _id: doc, name: 'Unknown', email: '' };
  return doc;
};

const readinessFromScore = (score) => {
  const n = Number(score) || 0;
  if (n >= 75) return 'Ready';
  if (n >= 50) return 'Intermediate';
  return 'Beginner';
};

const accountStatus = (user) => {
  if (user.isActive === false) return 'deactivated';
  if (user.requiresAccountSetup === true) return 'pending_setup';
  return 'active';
};

export const mapUserToStudent = (user) => {
  const averageScore = Number(user.averageScore) || 0;
  return {
    id: idOf(user),
    name: user.name || 'Unnamed',
    email: user.email || '',
    username: user.username || '',
    role: user.role || 'candidate',
    institution: (user.institution || '').trim(),
    institutionId: user.institutionId ? String(user.institutionId) : ((user.institution || '').trim() || 'unassigned'),
    batch: user.batch || '',
    branch: user.branch || '',
    batchYear: user.createdAt ? new Date(user.createdAt).getFullYear() : null,
    readinessLevel: readinessFromScore(averageScore),
    totalInterviews: Number(user.totalSessions) || 0,
    averageScore,
    status: accountStatus(user),
    level: user.level,
    skills: user.skills || {},
    createdAt: user.createdAt,
    raw: user,
  };
};

export const mapUserToPlatformAdmin = (user) => {
  const role = normalizeAdminRole(user.role);
  const assignedIds = (user.assignedInstitutionIds || []).map(String);
  const assignedNames = Array.isArray(user.assignedInstitutions)
    ? user.assignedInstitutions.map((i) => i.name).filter(Boolean)
    : [];
  const institutionLabel = assignedNames.length
    ? assignedNames.join(', ')
    : ((user.institution || '').trim() || '—');
  return {
    id: idOf(user),
    name: user.name || 'Unnamed',
    email: user.email || '',
    institutionName: institutionLabel,
    assignedInstitutionIds: assignedIds,
    roleScope: role === 'superAdmin' ? 'Super Admin' : role === 'admin' ? 'Admin' : role,
    status: accountStatus(user),
    invitedAt: user.createdAt,
    raw: user,
  };
};

const normalizeAdminRole = (role) => {
  const r = String(role || '').trim();
  if (r === 'recruiter' || r === 'institutionAdmin') return 'admin';
  if (r === 'candidate') return 'student';
  return r;
};

const mapInterviewStatus = (status, violations = []) => {
  if (status === 'Terminated') return 'terminated';
  if (Array.isArray(violations) && violations.length > 0) return 'flagged';
  switch (status) {
    case 'In Progress':
      return 'live';
    case 'Completed':
      return 'completed';
    case 'Pending Review':
      return 'flagged';
    case 'Cancelled':
      return 'cancelled';
    case 'Setup':
      return 'setup';
    default:
      return String(status || 'unknown').toLowerCase().replace(/\s+/g, '-');
  }
};

const mapInterviewType = (iv) => {
  if (iv.interviewType) return iv.interviewType === 'Behavioural' ? 'Behavioral' : iv.interviewType;
  if (iv.interviewMode === 'hr_behavioral') return 'Behavioral';
  if (iv.interviewMode === 'sde' || iv.interviewMode === 'backend' || iv.interviewMode === 'frontend') {
    return 'Technical';
  }
  if (iv.interviewMode === 'qa') return 'Aptitude';
  return iv.roleDomain || 'Technical';
};

const isAttemptedQuestion = (q) => {
  const answer = String(q?.userAnswer ?? '').trim();
  if (answer) return true;
  return typeof q?.score === 'number'
    && Number.isFinite(q.score)
    && String(q?.feedback ?? '').trim();
};

const reachedQuestionCount = (iv) => {
  const total = Array.isArray(iv?.questions) ? iv.questions.length : 0;
  const current = Math.max(0, Number(iv?.currentQuestionIndex ?? 0));
  if (iv?.status === 'Terminated' && iv?.terminationQuestionIndex != null) {
    return Math.min(total, Math.max(current, Number(iv.terminationQuestionIndex) + 1));
  }
  return Math.min(total, current);
};

export const mapInterview = (iv) => {
  const user = userOf(iv.userId);
  const questions = Array.isArray(iv.questions) ? iv.questions : [];
  const attemptedQuestions = questions
    .slice(0, reachedQuestionCount(iv))
    .filter(isAttemptedQuestion);
  const answers = attemptedQuestions.map((q) => q.userAnswer).filter(Boolean);
  const score = Number(iv.totalScore);
  const totalPlanned = Number(iv.totalPlannedQuestions) || questions.length;
  return {
    id: idOf(iv),
    studentId: idOf(user),
    studentName: user?.name || 'Unknown',
    studentEmail: user?.email || '',
    institution: (user?.institution || '').trim(),
    targetCompany: iv.targetCompany || '—',
    type: mapInterviewType(iv),
    score: Number.isFinite(score) ? score : 0,
    duration: Number(iv.duration) || 0,
    status: mapInterviewStatus(iv.status, iv.violations),
    rawStatus: iv.status,
    date: iv.completedAt || iv.startedAt || iv.createdAt,
    totalPlannedQuestions: totalPlanned,
    questionsAttempted: attemptedQuestions.length,
    questionsAsked: attemptedQuestions.map((q) => q.question).filter(Boolean),
    questions,
    transcriptExcerpt: answers[0]?.slice(0, 280) || iv.feedbackSummary?.overallFeedback || '',
    aiFeedback: {
      strengths: iv.feedbackSummary?.strengths || [],
      improvements: iv.feedbackSummary?.improvements || [],
      overall: iv.feedbackSummary?.overallFeedback || '',
    },
    scores: iv.scores || {},
    violations: iv.violations || [],
    faceIncidents: iv.faceIncidents || [],
    terminationReason: iv.terminationReason || '',
    terminatedAt: iv.terminatedAt,
    terminationQuestionIndex: iv.terminationQuestionIndex,
    currentQuestionIndex: iv.currentQuestionIndex ?? 0,
    roleDomain: iv.roleDomain,
    roleLevel: iv.roleLevel,
    raw: iv,
  };
};

export const mapResume = (resume) => {
  const user = userOf(resume.userId);
  const analysis = resume.analysis || {};
  const score = Number(analysis.score);
  return {
    id: idOf(resume),
    studentId: idOf(user),
    studentName: user?.name || 'Unknown',
    studentEmail: user?.email || '',
    institution: (user?.institution || '').trim(),
    fileName: resume.fileName || 'resume',
    uploadedAt: resume.createdAt,
    resumeScore: Number.isFinite(score) ? score : 0,
    atsScore: Number.isFinite(score) ? score : 0,
    jdMatchScore: null,
    skills: analysis.skills || [],
    missingSkills: analysis.gaps || [],
    weakSections: analysis.gaps || [],
    strengths: analysis.strengths || [],
    summary: analysis.summary || '',
    suggestedQuestions: analysis.suggestedQuestions || [],
    experienceLevel: analysis.experienceLevel,
    yearsOfExperience: analysis.yearsOfExperience,
    rawText: resume.rawText,
    raw: resume,
  };
};

export const skillsFromScores = (scores = {}, fallback = 40) => {
  const tech = Number(scores.technical);
  const comm = Number(scores.communication);
  const behav = Number(scores.behavioral);
  const base = Number.isFinite(tech) || Number.isFinite(comm) || Number.isFinite(behav)
    ? Math.round(
      ([tech, comm, behav].filter((n) => Number.isFinite(n)).reduce((a, b) => a + b, 0)
        / [tech, comm, behav].filter((n) => Number.isFinite(n)).length),
    )
    : fallback;
  return {
    technical: Number.isFinite(tech) ? tech : base,
    problemSolving: Number.isFinite(tech) ? Math.max(0, tech - 2) : Math.max(15, base - 4),
    communication: Number.isFinite(comm) ? comm : Math.min(95, base + 4),
    confidence: Number.isFinite(behav) ? behav : Math.max(18, base - 2),
    answerRelevance: Number.isFinite(behav) ? behav : base,
    overall: base,
  };
};
