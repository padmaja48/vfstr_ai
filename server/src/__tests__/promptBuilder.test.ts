import {
  buildAdaptiveTurnUserPrompt,
  buildInterviewSystemPrompt,
  formatConversationHistory,
  mapExperienceLevel,
  mapInterviewPromptType,
} from '../services/promptBuilder';
import { getCompanyQuestions, listAvailableCompanyBanks } from '../services/companyQuestionBank';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';

describe('promptBuilder', () => {
  it('maps experience and interview types', () => {
    expect(mapExperienceLevel('Fresher')).toBe('fresher');
    expect(mapExperienceLevel('Senior')).toBe('experienced');
    expect(mapInterviewPromptType('Technical')).toBe('technical');
    expect(mapInterviewPromptType('Mixed')).toBe('mixed');
  });

  it('includes resume specifics and forbids boilerplate transitions', () => {
    const prompt = buildInterviewSystemPrompt({
      candidateResume: {
        candidateInformation: { name: 'Jane Doe', college: 'IIT Delhi' },
        skills: {
          programmingLanguages: ['Python'],
          frameworks: ['FastAPI'],
          libraries: [],
          databases: ['PostgreSQL'],
          cloudTechnologies: ['AWS'],
          operatingSystems: [],
          developerTools: ['Git'],
          versionControl: ['Git'],
          technicalSkills: ['REST APIs'],
          softSkills: [],
        },
        projects: ['Smart Inventory Tracker — Flask + PostgreSQL'],
        internships: ['Amazon SDE Intern 2024'],
        workExperience: [],
        certifications: [],
        coursework: ['Data Structures'],
        achievements: [],
        hackathons: [],
        researchPapers: [],
        publications: [],
        leadership: [],
        positionsOfResponsibility: [],
        strengths: [],
        areasOfInterest: [],
        interests: [],
      },
      jobDescription: 'Backend engineer with Python and AWS.',
      company: 'Amazon',
      role: 'Software Engineer',
      experienceLevel: 'fresher',
      companyQuestionBank: [
        { question: 'Two-sum style coding question', type: 'coding', source: 'reported 2024' },
      ],
      companyBankMode: 'verified',
      interviewType: 'technical',
      roleLevel: 'Fresher',
    });

    expect(prompt).toContain('Smart Inventory Tracker');
    expect(prompt).toContain('Jane Doe');
    expect(prompt).toContain('VERIFIED REFERENCE QUESTIONS');
    expect(prompt).toContain('DSA/coding');
    expect(prompt).toContain("Let's make that more concrete");
  });

  it('formats conversation history for stateless model calls', () => {
    const history = formatConversationHistory([
      { question: 'Tell me about your project X.', answer: 'I built X using React.' },
    ]);

    expect(history).toContain('Interviewer: Tell me about your project X.');
    expect(history).toContain('Candidate: I built X using React.');
  });

  it('uses compact interview state for adaptive turns', () => {
    const prompt = buildAdaptiveTurnUserPrompt({
      compactState: {
        interviewId: 'iv-1',
        questionIndex: 3,
        targetQuestionCount: 18,
        remainingQuestions: 14,
        recentTurns: [{ question: 'Recent question', answer: 'Recent answer', score: 70 }],
        coveredTopics: ['react'],
        topicCoverage: { react: 1 },
        answerScores: [70],
        strengths: ['clear'],
        weaknesses: ['depth'],
        weakAreas: ['testing'],
        askedQuestionIds: ['q-1'],
      },
      candidateMessage: 'I used Jest for testing.',
      previousQuestionTopics: ['react'],
      questionsRemaining: 14,
    });

    expect(prompt).toContain('COMPACT INTERVIEW STATE');
    expect(prompt).not.toContain('FULL CONVERSATION SO FAR');
    expect(prompt).toContain('I used Jest for testing.');
  });

  it('marks role-based mode honestly when no verified bank exists', () => {
    const prompt = buildInterviewSystemPrompt({
      candidateResume: { summary: 'Backend developer', skills: ['Node.js'], rawText: 'Built APIs' },
      company: 'Unknown Startup',
      role: 'Software Engineer',
      experienceLevel: 'experienced',
      companyQuestionBank: null,
      companyBankMode: 'role_based',
      interviewType: 'mixed',
    });

    expect(prompt).toMatch(/role-based/i);
    expect(prompt).not.toContain('VERIFIED REFERENCE QUESTIONS');
    expect(prompt).toMatch(/Do NOT invent fake/i);
  });
});

describe('companyQuestionBank', () => {
  beforeAll(async () => {
    await connectDatabase();

    const { Question } = await import('../models/Question');
    const { normalizeQuestionText } = await import('../services/questionBank.service');

    const amazonExists = await Question.exists({ companySlug: 'amazon', status: 'active' });
    if (!amazonExists) {
      await Question.create({
        text: 'Amazon test coding question: find two numbers that add up to a target in an array.',
        normalizedText: normalizeQuestionText('Amazon test coding question: find two numbers that add up to a target in an array.'),
        category: 'Company-specific',
        difficulty: 'Easy',
        company: 'Amazon',
        companySlug: 'amazon',
        role: 'Software Engineer',
        experienceLevel: 'fresher',
        tags: ['coding'],
        createdBy: 'migrated',
        status: 'active',
      });
    }

    const genericExists = await Question.exists({ tags: 'generic-pool', status: 'active' });
    if (!genericExists) {
      await Question.create({
        text: 'Generic pool test question: explain the difference between a stack and a queue.',
        normalizedText: normalizeQuestionText('Generic pool test question: explain the difference between a stack and a queue.'),
        category: 'Technical',
        difficulty: 'Easy',
        role: 'Software Engineer',
        experienceLevel: 'fresher',
        tags: ['generic-pool', 'technical'],
        createdBy: 'migrated',
        status: 'active',
      });
    }
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('loads verified Amazon questions for software engineers', async () => {
    const result = await getCompanyQuestions('Amazon', 'Software Engineer', 'fresher', 4);
    expect(result).not.toBeNull();
    expect(result?.mode).toBe('verified');
    expect(result?.questions.length).toBeGreaterThan(0);
    expect(result?.questions.some((item) => item.type === 'coding')).toBe(true);
  });

  it('falls back to generic pool for unknown companies', async () => {
    const result = await getCompanyQuestions('Some Unknown Corp', 'Software Engineer', 'fresher', 4);
    expect(result).not.toBeNull();
    expect(result?.mode).toBe('generic');
  });

  it('lists company banks from database catalog helper', () => {
    const banks = listAvailableCompanyBanks();
    expect(Array.isArray(banks)).toBe(true);
  });
});
