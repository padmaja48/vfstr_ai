export type CleanReportQuestion = {
  number: number;
  difficulty: string;
  score: number;
  questionText: string;
  candidateAnswer: string;
  isCode: boolean;
  whatWasCorrect: string;
  whatWasMissing: string;
  conceptsToRevise: string[];
  idealAnswer: string;
  suggestedImprovedAnswer: string;
};

export type CleanReportSectionReadiness = {
  category: string;
  score: number;
  measures: string;
};

export type CleanReportData = {
  candidate: {
    name: string;
    email: string;
    role: string;
    date: string;
    durationMinutes: number;
  };
  summary: {
    overallScore: number;
    type: string;
    level: string;
    questionsAnswered: number;
    questionsTotal: number;
    questionsReached: number;
    averageEvaluatedScore: number;
    verdict: string;
    recommendationNote: string;
    executiveSummaryText: string;
  };
  sectionReadiness: CleanReportSectionReadiness[];
  strengths: string[];
  areasToImprove: string[];
  practiceNext: string[];
  hiringSignal: string;
  hiringSignalNote: string;
  missedConcepts: string[];
  trend: { previousScore: number | null; currentScore: number };
  difficultyProgression: string[];
  questions: CleanReportQuestion[];
};

export type NormalizeReportInput = {
  report: Record<string, unknown>;
  interview: Record<string, unknown>;
  user?: Record<string, unknown> | null;
  previousOverallScore?: number | null;
};
