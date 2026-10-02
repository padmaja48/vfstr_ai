import {
  buildJobDescriptionProfile,
  decideAdaptiveFollowUp,
  evaluateAnswer,
  extractEducationEntities,
  getInterviewModeGuidance,
  normalizeTechnicalTranscript,
} from '../services/ai.service';

describe('adaptive interview engine helpers', () => {
  it('builds a JD-first profile with skill graph signals', () => {
    const profile = buildJobDescriptionProfile(
      'We need a Python backend engineer with FastAPI, SQL, Docker, AWS, and REST APIs. ' +
        'Responsibilities include designing APIs, deploying services, and communicating with stakeholders. 3+ years required.',
      {
        roleLevel: 'Mid',
        roleDomain: 'Backend Engineering',
        resumeSkills: ['Python', 'MongoDB'],
      },
    );

    expect(profile.requiredSkills).toEqual(expect.arrayContaining(['Python', 'FastAPI', 'SQL', 'Docker', 'AWS', 'REST APIs']));
    expect(profile.softSkills).toContain('Communication');
    expect(profile.responsibilities.some((item) => item.toLowerCase().includes('designing apis'))).toBe(true);
    expect(profile.skillGraph.nodes.some((node) => node.skill === 'FastAPI')).toBe(true);
    expect(profile.skillGraph.edges.length).toBeGreaterThan(0);
  });

  it('normalizes technical speech-to-text terms with interview context', () => {
    const text = normalizeTechnicalTranscript('i used fast api with rest api, numpy, postgres and git hub', {
      jobDescription: 'FastAPI, PostgreSQL, REST APIs, GitHub',
      resumeSkills: ['NumPy'],
    });

    expect(text).toContain('FastAPI');
    expect(text).toContain('REST API');
    expect(text).toContain('NumPy');
    expect(text).toContain('PostgreSQL');
    expect(text).toContain('GitHub');
  });

  it('corrects university mishears using THIS resume, not a national college list', () => {
    const text = normalizeTechnicalTranscript('I am from with Nancy University vigyan', {
      resumeText: "Education\nB.Tech CSE - Vignan's University, Guntur\nSkills: Python, ML",
    });
    expect(text.toLowerCase()).toContain('vignan');
    expect(text.toLowerCase()).not.toContain('nancy');
  });

  it('extracts education entities from resume text', () => {
    const entities = extractEducationEntities(
      "Education\nVignan's University, Guntur\nB.Tech Computer Science\nSkills: React",
    );
    expect(entities.some((item) => /vignan/i.test(item))).toBe(true);
  });

  it('keeps distinct prompt guidance for each role-wise interview mode', () => {
    expect(getInterviewModeGuidance('frontend').questionAngles).toEqual(expect.arrayContaining(['accessibility', 'frontend performance']));
    expect(getInterviewModeGuidance('backend').questionAngles).toEqual(expect.arrayContaining(['REST/API design', 'production incidents']));
    expect(getInterviewModeGuidance('data_analyst').questionAngles).toEqual(expect.arrayContaining(['SQL queries', 'business metrics']));
    expect(getInterviewModeGuidance('ai_ml').questionAngles).toEqual(expect.arrayContaining(['model selection', 'model deployment']));
    expect(getInterviewModeGuidance('qa').questionAngles).toEqual(expect.arrayContaining(['test case design', 'regression testing']));
    expect(getInterviewModeGuidance('hr_behavioral').questionAngles).toEqual(expect.arrayContaining(['conflict handling', 'career goals']));
  });

  it('chooses easier clarification for weak answers', () => {
    const decision = decideAdaptiveFollowUp({
      evaluation: {
        score: 25,
        feedback: '',
        communicationScore: 20,
        technicalScore: 20,
        behavioralScore: 20,
        nextAction: 'reduce_difficulty',
        missingConcepts: ['index trade-offs'],
      },
      lastQuestion: { question: 'Explain indexes.', expectedSignals: [], difficulty: 'medium', topic: 'SQL indexes' },
      position: 2,
      total: 10,
    });

    expect(decision.action).toBe('reduce_difficulty');
    expect(decision.followUpIntent).toBe('recover-confidence');
    expect(decision.focus).toBe('the trade-offs and edge cases you handled');
  });

  it('targets the missing part for incomplete answers', () => {
    const decision = decideAdaptiveFollowUp({
      evaluation: {
        score: 58,
        feedback: '',
        communicationScore: 60,
        technicalScore: 55,
        behavioralScore: 40,
        completenessScore: 50,
        nextAction: 'move_topic',
        missingConcepts: ['edge case handling'],
      },
      lastQuestion: { question: 'Explain your API design.', expectedSignals: [], difficulty: 'medium', topic: 'API design' },
      position: 3,
      total: 10,
    });

    expect(decision.action).toBe('clarify');
    expect(decision.followUpIntent).toBe('clarify');
    expect(decision.focus).toContain('edge case handling');
  });

  it('escalates strong answers into deeper challenges', () => {
    const decision = decideAdaptiveFollowUp({
      evaluation: {
        score: 90,
        feedback: '',
        communicationScore: 90,
        technicalScore: 92,
        behavioralScore: 80,
        nextAction: 'ask_deeper',
      },
      lastQuestion: { question: 'Explain caching.', expectedSignals: [], difficulty: 'medium', topic: 'Caching' },
      position: 5,
      total: 10,
    });

    expect(['ask_deeper', 'challenge']).toContain(decision.action);
    expect(['deepen', 'challenge']).toContain(decision.followUpIntent);
    expect(decision.targetDifficulty).not.toBe('easy');
  });

  it('returns comparison fields and a sample perfect answer for skipped answers', async () => {
    const result = await evaluateAnswer('Explain SQL indexes with one practical example.', '(skipped)', {
      expectedSignals: ['index purpose', 'query performance', 'trade-offs'],
      roleDomain: 'Backend Engineering',
      targetCompany: 'Oracle',
      difficulty: 'medium',
      questionType: 'technical',
      topic: 'SQL',
    });

    expect(result.score).toBe(0);
    expect(result.samplePerfectAnswer).toContain('SQL');
    expect(result.feedback).toMatch(/Correct|Missing|Improve|ideal answer/i);
    expect(result.missingConcepts).toEqual(expect.arrayContaining(['index purpose', 'query performance', 'trade-offs']));
    expect(result.dynamicFeedback?.areasToImprove.length).toBeGreaterThan(0);
    expect(result.dynamicFeedback?.interviewReadiness).toContain('Not interview-ready');
  });
});
