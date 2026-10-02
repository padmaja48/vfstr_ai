import {
  analyzeResumeForInterview,
  buildInterviewQuestionSet,
  buildInterviewRoadmap,
} from '../services/companyQuestions.service';
import { decideAdaptiveFollowUp, evaluateAnswer } from '../services/ai.service';
import {
  detectLikelySpeechArtifacts,
  sanitizeGroundedFeedbackText,
} from '../services/interviewReport.utils';

const padmajaResume = [
  'Sai Padmaja Kuncham',
  'Technical Skills',
  'Programming Languages: C, C++, Python, Java, JavaScript, SQL',
  'Frontend Technologies: HTML5, CSS3, JavaScript, React.js',
  'Backend Technologies: Node.js, Express.js, RESTful APIs',
  'Databases: MongoDB, MySQL',
  'Developer Tools & Platforms: Git, GitHub, VS Code, Google Colab, Jupyter Notebook, Render, Vercel',
  'Projects',
  'PDF Knowledge Chatbot– NLP & Generative AI',
  'Blood Donation Platform– Full Stack (MERN)',
  'Certifications & Training',
  'SQL (Intermediate)– HackerRank Certified',
  'Python Essentials 1 & 2– Cisco Networking Academy',
].join('\n');

describe('questioning quality guards', () => {
  it('does not treat Developer Tools catalog lines as internship employers', () => {
    const profile = analyzeResumeForInterview({
      resumeText: padmajaResume,
      resumeSkills: ['Python', 'React', 'Node.js', 'SQL', 'Git'],
      roleDomain: 'SDE',
      targetCompany: 'Accenture',
    });

    const experiencePool = [...profile.internships, ...profile.workExperience];
    expect(experiencePool.join(' ')).not.toMatch(/Developer Tools/i);
    expect(experiencePool.join(' ')).not.toMatch(/\bGitHub\b/);

    const roadmap = buildInterviewRoadmap({
      resumeText: padmajaResume,
      resumeSkills: ['Python', 'React', 'Node.js', 'SQL'],
      roleDomain: 'SDE',
      roleLevel: 'Fresher',
      duration: 15,
      complexity: 'Beginner',
      targetCompany: 'Accenture',
    });

    const questions = buildInterviewQuestionSet({
      duration: 15,
      targetCompany: 'Accenture',
      generatedQuestions: [],
      interviewRoadmap: roadmap,
    });

    expect(questions.some((q) => /at Developer Tools/i.test(q.question))).toBe(false);
  });

  it('uses concrete coding prompts instead of vague skill-topic builds', () => {
    const roadmap = buildInterviewRoadmap({
      resumeText: padmajaResume,
      resumeSkills: ['Python', 'React', 'Git', 'SQL'],
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

    expect(
      questions.some((q) =>
        /What would you build or analyze, what cases would you check/i.test(q.question),
      ),
    ).toBe(false);

    expect(
      questions.some((q) =>
        /\b(write a function|given an array|palindrome|two numbers that add up|linked list|non-repeating)\b/i.test(
          q.question,
        ),
      ),
    ).toBe(true);
  });

  it('diversifies project questions across distinct resume projects', () => {
    const roadmap = buildInterviewRoadmap({
      resumeText: padmajaResume,
      resumeSkills: ['Python', 'React', 'Node.js'],
      roleDomain: 'SDE',
      roleLevel: 'Fresher',
      duration: 30,
      complexity: 'Intermediate',
      targetCompany: 'Accenture',
    });

    const questions = buildInterviewQuestionSet({
      duration: 30,
      targetCompany: 'Accenture',
      generatedQuestions: [],
      interviewRoadmap: roadmap,
    });

    const projectAsks = questions.filter((q) => /^Projects:/i.test(q.resumeReference || ''));
    const mentionsChatbot = projectAsks.some((q) => /PDF Knowledge|Chatbot/i.test(q.question));
    const mentionsDonation = projectAsks.some((q) => /Blood Donation/i.test(q.question));
    expect(mentionsChatbot || mentionsDonation).toBe(true);
    // With 2+ projects and depth >= 2, both should appear before heavy re-drilling.
    if (projectAsks.length >= 2) {
      expect(mentionsChatbot && mentionsDonation).toBe(true);
    }
  });

  it('keeps SQL cert questions as plain technical asks', () => {
    const roadmap = buildInterviewRoadmap({
      resumeText: padmajaResume,
      resumeSkills: ['SQL'],
      roleDomain: 'SDE',
      roleLevel: 'Fresher',
      duration: 15,
      complexity: 'Beginner',
      targetCompany: 'Accenture',
    });
    const questions = buildInterviewQuestionSet({
      duration: 15,
      targetCompany: 'Accenture',
      generatedQuestions: [],
      interviewRoadmap: roadmap,
    });
    const sqlAsk = questions.find((q) => /second highest salary/i.test(q.question));
    if (sqlAsk) {
      expect(sqlAsk.question).not.toMatch(/^Since you have a /i);
    }
  });

  it('builds coding/career ideal fallbacks without forcing PDF chatbot', async () => {
    const coding = await evaluateAnswer(
      'Write a function in Python that checks if a given string is a palindrome, considering case sensitivity and non-alphanumeric characters.',
      '(skipped)',
      {
        resumeProjects: ['PDF Knowledge Chatbot– NLP & Generative AI', 'Blood Donation Platform– Full Stack (MERN)'],
        resumeSkills: ['Python', 'React', 'Node.js'],
        expectedSignals: ['edge cases', 'time complexity'],
        questionType: 'technical',
        topic: 'Coding / Problem Solving: Python',
      },
    );

    expect(coding.score).toBe(0);
    expect(coding.nextAction).toBe('move_topic');
    expect(coding.idealAnswer).not.toMatch(/PDF Knowledge Chatbot/i);
    expect(coding.samplePerfectAnswer).not.toMatch(/PDF Knowledge Chatbot/i);
    expect(coding.idealAnswer).toMatch(/edge cases|complexity|pseudocode|approach/i);

    const career = await evaluateAnswer(
      'I noticed your resume includes full-stack development as well as AI/ML. Why did you decide to pursue a Software Development Engineering role, and how do those interests connect?',
      '(skipped)',
      {
        resumeProjects: ['PDF Knowledge Chatbot– NLP & Generative AI'],
        resumeSkills: ['Python', 'React'],
        questionType: 'behavioural',
      },
    );
    expect(career.idealAnswer).not.toMatch(/name "PDF Knowledge Chatbot/i);
    expect(career.idealAnswer).toMatch(/role|full-stack|AI\/ML|interests/i);
  });

  it('moves on after skips instead of sticky recovery coaching', () => {
    const decision = decideAdaptiveFollowUp({
      evaluation: {
        score: 0,
        feedback: 'No answer was provided.',
        missingSignals: ['No answer was provided'],
        nextAction: 'move_topic',
      } as any,
      lastQuestion: {
        question: 'Write a function in Python that checks if a given string is a palindrome.',
        topic: 'Coding / Problem Solving: Python',
        expectedSignals: ['edge cases', 'time complexity'],
      },
      position: 8,
      total: 10,
      transcript: [],
      resumeProjects: ['PDF Knowledge Chatbot– NLP & Generative AI', 'Blood Donation Platform– Full Stack (MERN)'],
    });

    expect(decision.action).toBe('move_topic');
    expect(decision.followUpIntent).toBe('recover-confidence');
    expect(decision.focus).toMatch(/fundamentals|second-project|easier/i);
  });

  it('flags common ASR glitches like Riya/Gate and strips invented JWT/caching', () => {
    const hints = detectLikelySpeechArtifacts(
      'coming to the front and we used Riya and Gate kid have been for deploy',
      'Blood Donation Platform React Git',
    );
    expect(hints.some((h) => /React/i.test(h.likelyMeant))).toBe(true);
    expect(hints.some((h) => /Git/i.test(h.likelyMeant))).toBe(true);

    const cleaned = sanitizeGroundedFeedbackText(
      'We used JWT and a caching mechanism with spaCy for the platform.',
      {
        projects: ['Blood Donation Platform– Full Stack (MERN)'],
        skills: ['React', 'Node.js', 'MongoDB'],
        answer: 'we used React and Node',
        question: 'Explain the architecture',
      },
    );
    expect(cleaned).not.toMatch(/\bJWT\b/i);
    expect(cleaned).not.toMatch(/caching mechanism/i);
    expect(cleaned).not.toMatch(/spaCy/i);
    expect(cleaned).not.toMatch(/a technique from your stack/i);
  });
});
