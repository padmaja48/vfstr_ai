import { evaluateAnswer } from '../services/ai.service';
import {
  alignEvaluationFeedbackToScore,
  BANNED_REPORT_AI_SPEAK,
  humanizeReportText,
} from '../services/interviewReport.utils';

const question = 'How did you build the PDF Knowledge Chatbot retrieval pipeline?';
const evaluationContext = {
  expectedSignals: ['chunking strategy', 'embedding pipeline', 'retrieval accuracy', 'latency optimization'],
  questionType: 'technical' as const,
  difficulty: 'medium' as const,
  topic: 'PDF Knowledge Chatbot',
  resumeProjects: ['PDF Knowledge Chatbot'],
  resumeSkills: ['Python', 'LangChain', 'FAISS'],
};

const strongA =
  'I built PDF Knowledge Chatbot with LangChain and FAISS. I chunked documents into 512-token pieces, embedded them with OpenAI embeddings, stored vectors in FAISS, and returned top-k matches with citations. Measured recall at 87% and cut latency from 4s to 1.2s after caching frequent queries.';

const strongB =
  'For PDF Knowledge Chatbot I used a recursive text splitter with 400-token chunks and 50-token overlap, stored embeddings in Pinecone, and reranked results with a cross-encoder. Load tests showed 92% answer accuracy and p95 query time under 800ms.';

const weak = 'I used Python and did stuff with AI for the project. It went well overall.';

const BANNED_UNGROUNDED = [
  'good communication skills',
  'could be more confident',
  'needs more detail',
  'the answer attempted the question directly',
  'gave enough detail for evaluation',
];

const feedbackLooksSpecific = (evaluation: Awaited<ReturnType<typeof evaluateAnswer>>, answer: string) => {
  const blob = [
    evaluation.feedback,
    ...(evaluation.dynamicFeedback?.strengths || []),
    ...(evaluation.dynamicFeedback?.areasToImprove || []),
    evaluation.dynamicFeedback?.communication,
    evaluation.dynamicFeedback?.confidence,
  ].filter(Boolean).join(' ');

  expect(blob.length).toBeGreaterThan(40);
  expect(
    BANNED_UNGROUNDED.some((phrase) => blob.toLowerCase().includes(phrase) && !/"[^"]{4,}"|`[^`]{3,}`/i.test(blob)),
  ).toBe(false);

  const answerWords = answer.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
  const hasGrounding = answerWords.some((word) => blob.toLowerCase().includes(word))
    || /"[^"]{4,}"|`[^`]{3,}`/i.test(blob);
  expect(hasGrounding).toBe(true);
};

describe('feedback specificity', () => {
  jest.setTimeout(60_000);

  it('strong vs weak answers produce clearly different feedback', async () => {
    const good = await evaluateAnswer(question, strongA, evaluationContext);
    const bad = await evaluateAnswer(question, weak, evaluationContext);

    expect(good.feedback).not.toBe(bad.feedback);
    expect(good.dynamicFeedback?.strengths?.join(' ')).not.toEqual(bad.dynamicFeedback?.strengths?.join(' '));
    expect(good.dynamicFeedback?.areasToImprove?.join(' ')).not.toEqual(bad.dynamicFeedback?.areasToImprove?.join(' '));

    feedbackLooksSpecific(good, strongA);
    feedbackLooksSpecific(bad, weak);
    expect(good.score).toBeGreaterThan(bad.score);
  });

  it('two different strong answers get different strength feedback', async () => {
    const evalA = await evaluateAnswer(question, strongA, evaluationContext);
    const evalB = await evaluateAnswer(question, strongB, evaluationContext);

    const strengthsA = (evalA.dynamicFeedback?.strengths || []).join(' ').toLowerCase();
    const strengthsB = (evalB.dynamicFeedback?.strengths || []).join(' ').toLowerCase();

    expect(strengthsA).not.toBe(strengthsB);
    expect(strengthsA.includes('faiss') || strengthsA.includes('512') || strengthsA.includes('chunk')).toBe(true);
    expect(strengthsB.includes('pinecone') || strengthsB.includes('rerank') || strengthsB.includes('400')).toBe(true);
  });

  it('coding feedback references submitted code constructs', async () => {
    const twoSum =
      'Given an array of integers, write a function to return the indices of the two numbers that add up to a target.';
    const wrong = await evaluateAnswer(
      twoSum,
      'Submitted code (python):\ndef twoSum(nums, target):\n    return [0, 1]\n',
      {
        questionType: 'technical',
        difficulty: 'problem-solving',
        expectedSignals: ['hash map or nested loop approach', 'correctness', 'time complexity'],
      },
    );

    const blob = [
      wrong.feedback,
      ...(wrong.dynamicFeedback?.areasToImprove || []),
      ...(wrong.dynamicFeedback?.technicalMistakes || []),
    ].join(' ').toLowerCase();

    expect(blob).toMatch(/return|\[0,\s*1\]|hard|constant|nums|target|hash|loop/);
    expect(blob).not.toMatch(/^could be more efficient\.?$/);
    expect(blob.toLowerCase()).not.toMatch(/the candidate demonstrated/);
    for (const banned of BANNED_REPORT_AI_SPEAK) {
      expect(blob.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });

  it('coding feedback score and narrative stay aligned for broken submissions', async () => {
    const twoSum =
      'Given an array of integers, write a function to return the indices of the two numbers that add up to a target.';
    const wrong = await evaluateAnswer(
      twoSum,
      'Submitted code (python):\ndef twoSum(nums, target):\n    return [0, 1]\n',
      {
        questionType: 'technical',
        difficulty: 'problem-solving',
        expectedSignals: ['hash map or nested loop approach', 'correctness', 'time complexity'],
      },
    );

    expect(wrong.score).toBeLessThanOrEqual(25);
    const blob = [wrong.feedback, ...(wrong.dynamicFeedback?.strengths ?? [])].join(' ');
    expect(blob).not.toMatch(/\b(excellent|outstanding|great job|well done)\b/i);
    expect(blob).toMatch(/return|\[0,\s*1\]|hard|nums|target/i);
  });

  it('strong coding solution feedback references specific code constructs', async () => {
    const twoSum =
      'Given an array of integers, write a function to return the indices of the two numbers that add up to a target.';
    const good = await evaluateAnswer(
      twoSum,
      `Submitted code (python):
def twoSum(nums, target):
    seen = {}
    for i, n in enumerate(nums):
        need = target - n
        if need in seen:
            return [seen[need], i]
        seen[n] = i
    return []
`,
      {
        questionType: 'technical',
        difficulty: 'problem-solving',
        expectedSignals: ['hash map or nested loop approach', 'correctness', 'time complexity'],
      },
    );

    const blob = [good.feedback, ...(good.dynamicFeedback?.strengths ?? [])].join(' ').toLowerCase();
    expect(good.score).toBeGreaterThan(25);
    expect(blob).toMatch(/seen|hash|dict|for|enumerate|twoSum/);
    expect(humanizeReportText('The candidate demonstrated strong logic.', { secondPerson: true }).toLowerCase()).toMatch(/\byou\b/);
  });

  it('alignEvaluationFeedbackToScore replaces praise that contradicts a low coding score', () => {
    const aligned = alignEvaluationFeedbackToScore(
      {
        score: 18,
        feedback: 'Excellent performance overall. The candidate demonstrated strong coding skills.',
        technicalScore: 85,
        dynamicFeedback: {
          strengths: ['Great job overall!', 'Outstanding solution'],
          areasToImprove: [],
        },
      },
      {
        isCoding: true,
        code: 'def twoSum(nums, target):\n    return [0, 1]',
        answer: 'Submitted code (python):\ndef twoSum(nums, target):\n    return [0, 1]',
        scoreAlignedFeedback:
          'Your `return [0, 1]` hard-codes the answer instead of using `nums` and `target` — that cannot pass hidden tests.',
        scoreAlignedStrengths: [],
      },
    );

    expect(aligned.score).toBe(18);
    expect(aligned.technicalScore).toBe(18);
    expect(aligned.feedback?.toLowerCase()).toMatch(/return \[0, 1\]|hard/);
    expect(aligned.feedback?.toLowerCase()).not.toMatch(/excellent|outstanding|great job/);
    expect(aligned.dynamicFeedback?.strengths?.length ?? 0).toBe(0);
  });
});
