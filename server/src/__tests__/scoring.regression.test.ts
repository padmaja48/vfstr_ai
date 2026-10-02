import { evaluateAnswer } from '../services/ai.service';
import {
  applyScoringBandGuards,
  isVagueAnswerText,
} from '../services/interviewReport.utils';

describe('scoring regression (G01–G06 canned answers)', () => {
  const question = 'How did you build the PDF Knowledge Chatbot retrieval pipeline?';
  const evaluationContext = {
    expectedSignals: ['chunking strategy', 'embedding pipeline', 'retrieval accuracy', 'latency optimization'],
    questionType: 'technical',
    difficulty: 'medium',
    topic: 'PDF Knowledge Chatbot',
    resumeProjects: ['PDF Knowledge Chatbot'],
    resumeSkills: ['Python', 'LangChain', 'FAISS'],
  };

  it('empty / skipped answers score 0 with explicit no-answer feedback', async () => {
    const empty = await evaluateAnswer(question, '');
    const skipped = await evaluateAnswer(question, '(skipped)');
    expect(empty.score).toBe(0);
    expect(skipped.score).toBe(0);
    expect(empty.feedback).toMatch(/no answer was provided/i);
  });

  it('vague answers are classified and capped at ≤50 (G04)', () => {
    const vague = 'I used Python and did stuff with AI for the project.';
    expect(isVagueAnswerText(vague)).toBe(true);
    const guarded = applyScoringBandGuards({ score: 78, feedback: 'Looks ok' }, vague);
    expect(guarded.score).toBeLessThanOrEqual(50);
  });

  it('STAR + metric answers get a soft floor of ≥70 when mid-band (G05)', () => {
    const strong =
      'I led the retrieval redesign for PDF Knowledge Chatbot. I implemented FAISS chunking in Python, measured recall, and cut latency by 35% after load testing. The result was faster answers for users.';
    expect(isVagueAnswerText(strong)).toBe(false);
    const guarded = applyScoringBandGuards({ score: 60, feedback: 'Solid' }, strong);
    expect(guarded.score).toBeGreaterThanOrEqual(70);
  });

  it('ASR-damaged answers get partial credit instead of zero (G06)', () => {
    const noisy =
      'We took the voltage of the PDF, made chunks, stored them in Fire, then asked the crop model to answer questions.';
    const guarded = applyScoringBandGuards(
      { score: 0, feedback: 'Unclear', nextAction: 'reduce_difficulty' },
      noisy,
      [{ heard: 'voltage', likelyMeant: 'whole text / the full document text' }],
    );
    expect(guarded.score).toBe(35);
    expect(guarded.nextAction).toBe('clarify');
    expect(guarded.feedback).toMatch(/did you mean/i);
  });

  it('same canned evaluation is stable under band guards (G01)', () => {
    const answer =
      'I built PDF Knowledge Chatbot with LangChain and FAISS. I chunked documents, embedded them, and returned top matches with citations.';
    const first = applyScoringBandGuards({ score: 62, feedback: 'A' }, answer);
    const second = applyScoringBandGuards({ score: 62, feedback: 'A' }, answer);
    expect(Math.abs((first.score ?? 0) - (second.score ?? 0))).toBeLessThanOrEqual(0);
  });

  it('evaluateAnswer empty path is deterministic across two calls', async () => {
    const a = await evaluateAnswer(question, '(no answer)');
    const b = await evaluateAnswer(question, '(no answer)');
    expect(a.score).toBe(b.score);
    expect(a.score).toBe(0);
  });

  it('strong non-coding answers score in a realistic good band (fallback or model)', async () => {
    const strong =
      'I built PDF Knowledge Chatbot with LangChain and FAISS. I chunked documents into 512-token pieces, embedded them with OpenAI embeddings, stored vectors in FAISS, and returned top-k matches with citations. Measured recall at 87% and cut latency from 4s to 1.2s after caching frequent queries.';
    const evaluation = await evaluateAnswer(question, strong, evaluationContext);
    expect(evaluation.score).toBeGreaterThanOrEqual(65);
    expect(evaluation.score).toBeLessThanOrEqual(100);
  });

  it('weak vague answers stay low and do not inherit a good-answer floor', async () => {
    const weak = 'I used Python and did stuff with AI for the project.';
    const evaluation = await evaluateAnswer(question, weak, evaluationContext);
    expect(evaluation.score).toBeLessThanOrEqual(50);
  });
});

describe('coding answer scoring', () => {
  jest.setTimeout(120_000);
  const twoSum =
    'Given an array of integers, write a function to return the indices of the two numbers that add up to a target. Explain your approach and its time and space complexity.';
  const ctx = {
    questionType: 'technical',
    difficulty: 'problem-solving',
    topic: 'Coding / Problem Solving: algorithms',
    expectedSignals: ['hash map or nested loop approach', 'correctness', 'time complexity', 'edge cases'],
  };

  it('blank / starter template scores 0', async () => {
    const blank = await evaluateAnswer(twoSum, 'Submitted code (python):\n\n', ctx);
    const starter = await evaluateAnswer(
      twoSum,
      'Submitted code (python):\ndef solve():\n    # write your approach\n    pass\n',
      ctx,
    );
    expect(blank.score).toBe(0);
    expect(starter.score).toBe(0);
    expect(starter.feedback).toMatch(/placeholder|starter|no working code/i);
  });

  it('hard-coded wrong return does not get full marks', async () => {
    const wrong = await evaluateAnswer(
      twoSum,
      'Submitted code (python):\ndef twoSum(nums, target):\n    return [0, 1]\n',
      ctx,
    );
    expect(wrong.score).toBeLessThanOrEqual(25);
    expect(wrong.score).toBeGreaterThanOrEqual(0);
    expect(`${wrong.feedback} ${wrong.technicalMistakes?.join(' ')}`).toMatch(/hard.{0,3}cod|placeholder|not a working|cannot earn|constant|input parameters/i);
  });

  it('a real hash-map solution scores clearly above a wrong constant return', async () => {
    const correct = await evaluateAnswer(
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
# hashmap, one pass, O(n) time, O(n) space, handles empty input and no pair
`,
      ctx,
    );
    const wrong = await evaluateAnswer(
      twoSum,
      'Submitted code (python):\ndef twoSum(nums, target):\n    return [0, 1]\n',
      ctx,
    );
    expect(correct.score).toBeGreaterThan(wrong.score);
    expect(correct.score).toBeGreaterThanOrEqual(35);
  });
});
