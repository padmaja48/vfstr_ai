import { extractQuestionsFromText } from '../services/companyQuestionResearch.service';
import { buildGroqWhisperPrompt, normalizeTechnicalTranscript } from '../services/ai.service';

describe('company question research', () => {
  it('extracts interview-style questions from web snippets', () => {
    const text =
      'Candidates reported these Amazon SDE questions: Given an array of integers, find two numbers that add up to a target? ' +
      'Tell me about a time you had to learn a new technology quickly. ' +
      'Click here to read more about Amazon careers.';

    const questions = extractQuestionsFromText(text, 'reported 2024');
    expect(questions.length).toBeGreaterThanOrEqual(2);
    expect(questions.some((item) => /array of integers/i.test(item.question))).toBe(true);
    expect(questions.some((item) => /learn a new technology/i.test(item.question))).toBe(true);
    expect(questions.every((item) => !/click here/i.test(item.question))).toBe(true);
  });
});

describe('Groq Whisper prompt priming', () => {
  it('uses vocabulary style priming instead of instruction text', () => {
    const prompt = buildGroqWhisperPrompt({
      resumeSkills: ['React', 'Node.js', 'PostgreSQL'],
      resumeProjects: ['Inventory Tracker'],
      roleDomain: 'Software Engineer',
      currentQuestion: 'Explain how you designed the REST API for your inventory project using PostgreSQL.',
      targetCompany: 'amazon',
    });

    expect(prompt).toMatch(/^In my project I used /);
    expect(prompt).toContain('React');
    expect(prompt).toContain('PostgreSQL');
    expect(prompt).not.toMatch(/do not hallucinate/i);
    expect(prompt).not.toMatch(/Explain how you designed/i);
  });

  it('keeps prompt within Whisper priming size limits', () => {
    const prompt = buildGroqWhisperPrompt({
      resumeSkills: Array.from({ length: 30 }, (_, index) => `Skill${index}`),
      roleDomain: 'Software Engineer',
    });

    expect(prompt.length).toBeLessThanOrEqual(800);
  });
});

describe('transcription normalization safety', () => {
  it('does not replace common English words with tech terms', () => {
    const text = normalizeTechnicalTranscript('I will go to the store and then come back', {
      resumeSkills: ['Go', 'Java'],
    });

    expect(text.toLowerCase()).toContain('go to the store');
  });

  it('still fixes obvious technical mis-hearings', () => {
    const text = normalizeTechnicalTranscript('i used fast api with postgres and git hub', {
      resumeSkills: ['FastAPI', 'PostgreSQL'],
    });

    expect(text).toContain('FastAPI');
    expect(text).toContain('PostgreSQL');
    expect(text).toContain('GitHub');
  });

  it('only fuzzy-corrects close single-token mis-hearings', () => {
    const text = normalizeTechnicalTranscript('we deployed on postgre sql', {
      resumeSkills: ['PostgreSQL'],
    });

    expect(text).toContain('PostgreSQL');
  });
});
