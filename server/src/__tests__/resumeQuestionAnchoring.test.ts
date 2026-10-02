import {
  isDateOnlyResumeEntity,
  questionContainsDateAnchor,
  rewriteDateAnchoredQuestion,
  sanitizeDateAnchoredQuestionText,
  sanitizeResumeEntityTopic,
  stripResumeDateMetadata,
} from '../services/resumeQuestionAnchoring.utils';
import {
  analyzeResumeForInterview,
  buildInterviewQuestionSet,
  buildInterviewRoadmap,
} from '../services/companyQuestions.service';

describe('resumeQuestionAnchoring.utils', () => {
  it('strips month-year ranges from resume entity labels', () => {
    expect(stripResumeDateMetadata('Software Intern at Acme Corp Jan 2024 - Mar 2025')).toBe(
      'Software Intern at Acme Corp',
    );
    expect(stripResumeDateMetadata('Dec 2024 - Feb 2025')).toBe('');
  });

  it('detects date-only resume lines', () => {
    expect(isDateOnlyResumeEntity('Jan 2024 - Present')).toBe(true);
    expect(isDateOnlyResumeEntity('2023 - 2024')).toBe(true);
    expect(isDateOnlyResumeEntity('Software Intern at Acme Corp Jan 2024 - Mar 2025')).toBe(false);
  });

  it('sanitizes topics and drops date-only entities', () => {
    expect(sanitizeResumeEntityTopic('Blood Donation Platform')).toBe('Blood Donation Platform');
    expect(sanitizeResumeEntityTopic('Jan 2024 - Feb 2025')).toBeNull();
  });

  it('detects date anchors in question text', () => {
    expect(
      questionContainsDateAnchor(
        'In December 2024, what skills did you learn during your internship at Acme?',
      ),
    ).toBe(true);
    expect(questionContainsDateAnchor('During your internship at Acme, what did you learn?')).toBe(false);
  });

  it('rewrites date-anchored questions to entity-based phrasing', () => {
    expect(
      rewriteDateAnchoredQuestion(
        'During your internship in Dec 2024 - Feb 2025, what did you learn?',
        'Acme Corp',
      ),
    ).toBe('During your internship at Acme Corp, what did you learn?');

    expect(
      rewriteDateAnchoredQuestion(
        'In 2023, what technologies did you use in Blood Donation Platform?',
        'Blood Donation Platform',
      ),
    ).toBe('What technologies did you use in Blood Donation Platform?');
  });

  it('discards questions that cannot be rewritten cleanly', () => {
    expect(
      sanitizeDateAnchoredQuestionText({
        question: 'In 2024, what did you do?',
      }),
    ).toBeNull();
  });
});

describe('resume question set date anchoring', () => {
  const datedResume = [
    'Sai Padmaja Kuncham',
    'Internships',
    'Software Development Intern at TechNova Solutions Dec 2024 - Feb 2025',
    'Projects',
    'Blood Donation Platform – Full Stack (MERN)',
    'Technical Skills',
    'React.js, Node.js, MongoDB, Git',
  ].join('\n');

  it('does not emit date-anchored internship questions', () => {
    const profile = analyzeResumeForInterview({
      resumeText: datedResume,
      resumeSkills: ['React', 'Node.js'],
      roleDomain: 'SDE',
      targetCompany: 'Accenture',
    });

    expect(profile.internships.join(' ')).not.toMatch(/\b2024\b|\b2025\b|\bdec\b/i);
    expect(profile.internships.some((item) => /TechNova/i.test(item))).toBe(true);

    const roadmap = buildInterviewRoadmap({
      resumeText: datedResume,
      resumeSkills: ['React', 'Node.js'],
      roleDomain: 'SDE',
      roleLevel: 'Fresher',
      duration: 30,
      complexity: 'Beginner',
      targetCompany: 'Accenture',
    });

    const questions = buildInterviewQuestionSet({
      duration: 30,
      targetCompany: 'Accenture',
      generatedQuestions: [],
      interviewRoadmap: roadmap,
    });

    const joined = questions.map((q) => q.question).join('\n');
    expect(joined).not.toMatch(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i);
    expect(joined).not.toMatch(/\b(?:19|20)\d{2}\b/);
    expect(joined).toMatch(/TechNova|Blood Donation/i);
  });
});
