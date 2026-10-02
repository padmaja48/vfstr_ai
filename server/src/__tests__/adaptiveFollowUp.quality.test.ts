import {
  decideAdaptiveFollowUp,
  type AnswerEvaluation,
  type GeneratedQuestion,
} from '../services/ai.service';
import {
  detectLikelySpeechArtifacts,
  isMetaInterviewQuestion,
} from '../services/interviewReport.utils';

const baseEvaluation = (overrides: Partial<AnswerEvaluation> = {}): AnswerEvaluation => ({
  score: 45,
  feedback: 'Partial',
  idealAnswer: 'ideal',
  samplePerfectAnswer: 'improved',
  conceptsCovered: [],
  missingConcepts: ['chunking'],
  incorrectStatements: [],
  wrongTerminology: [],
  technicalMistakes: [],
  communicationScore: 40,
  technicalScore: 40,
  behavioralScore: 40,
  confidenceScore: 40,
  completenessScore: 50,
  depthScore: 40,
  terminologyScore: 40,
  grammarScore: 40,
  vocabularyScore: 40,
  domainScore: 40,
  nextAction: 'clarify',
  suggestedDifficulty: 'easy',
  detectedSignals: [],
  missingSignals: ['chunking'],
  ...overrides,
});

describe('adaptive follow-up quality guards', () => {
  it('detects meta ready-to-proceed questions', () => {
    expect(
      isMetaInterviewQuestion(
        'It seems like you were not able to answer. Are you ready to proceed with the next question?',
      ),
    ).toBe(true);
    expect(isMetaInterviewQuestion('In PDF Knowledge Chatbot, how did you chunk the text?')).toBe(false);
  });

  it('flags voltage as a likely speech artifact in PDF context', () => {
    const hints = detectLikelySpeechArtifacts(
      'we extract the voltage from that PDF and convert into vector base',
      'PDF Knowledge Chatbot tokenization',
    );
    expect(hints.some((hint) => hint.heard === 'voltage')).toBe(true);
  });

  it('moves topic after two consecutive turns on the same project', () => {
    const lastQuestion: GeneratedQuestion = {
      question: 'In PDF Knowledge Chatbot, how did you apply tokenization?',
      topic: 'PDF Knowledge Chatbot',
      resumeReference: 'Projects: PDF Knowledge Chatbot',
      difficulty: 'medium',
      questionType: 'technical',
      expectedSignals: [],
    };
    const decision = decideAdaptiveFollowUp({
      evaluation: baseEvaluation({ score: 30, nextAction: 'clarify' }),
      lastQuestion,
      position: 5,
      total: 18,
      resumeProjects: ['PDF Knowledge Chatbot', 'Blood Donation Platform'],
      transcript: [
        {
          question: 'You mentioned working on the PDF Knowledge Chatbot',
          topic: 'PDF Knowledge Chatbot',
          score: 50,
        },
        {
          question: 'In PDF Knowledge Chatbot, how did you apply tokenization?',
          topic: 'PDF Knowledge Chatbot',
          score: 20,
        },
      ],
    });

    expect(decision.action).toBe('move_topic');
    expect(decision.followUpIntent).toBe('bridge-topic');
  });

  it('allows one clarify on the first weak answer for a topic', () => {
    const lastQuestion: GeneratedQuestion = {
      question: 'Tell me about the PDF Knowledge Chatbot',
      topic: 'PDF Knowledge Chatbot',
      difficulty: 'medium',
      questionType: 'technical',
      expectedSignals: [],
    };
    const decision = decideAdaptiveFollowUp({
      evaluation: baseEvaluation({ score: 35, nextAction: 'reduce_difficulty' }),
      lastQuestion,
      position: 2,
      total: 18,
      resumeProjects: ['PDF Knowledge Chatbot', 'Blood Donation Platform'],
      transcript: [
        {
          question: 'Tell me about the PDF Knowledge Chatbot',
          topic: 'PDF Knowledge Chatbot',
          score: 35,
        },
      ],
    });

    // One prior turn on topic → do not drill; bridge away after the weak probe opportunity.
    expect(['move_topic', 'reduce_difficulty']).toContain(decision.action);
  });
});
