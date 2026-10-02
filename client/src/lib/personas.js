const DICEBEAR_BASE = 'https://api.dicebear.com/7.x/personas/svg';

const avatarUrl = (seed, options = '') =>
  `${DICEBEAR_BASE}?seed=${seed}&size=400&${options}`;

export const PERSONAS = [
  {
    id: 'us-indian',
    name: 'Priya Sharma',
    title: 'Engineering Manager',
    company: 'Technical Depth',
    focus: 'Technical depth',
    voiceStyle: 'professional_female',
    speechPace: 0.96,
    questionPauseMs: 700,
    personality:
      'Analytical and thorough. Probes technical depth. Asks detailed follow-up questions. Rewards structured thinking.',
    avatarUrl: avatarUrl(
      'PriyaSharma2024',
      'backgroundColor=ffd5dc,ffdfbf&hair=longHair&skinColor=brown',
    ),
    avatarFallbackInitial: 'PS',
    avatarBg: '#ffd5dc',
    intro: "Hi, I'm Priya Sharma. I'm looking forward to our technical discussion today. Let's start with a quick introduction.",
    closing: "Thanks for walking me through your experience. You showed solid fundamentals — keep sharpening one concrete project story with metrics. Good luck with your interviews.",
  },
  {
    id: 'us-australian',
    name: 'Ananya Rao',
    title: 'Product Director',
    company: 'Communication Clarity',
    focus: 'Communication clarity',
    voiceStyle: 'neutral',
    speechPace: 0.98,
    questionPauseMs: 850,
    personality:
      'Relaxed but sharp. Tests cultural fit and communication clarity. Conversational style but digs into motivations.',
    avatarUrl: avatarUrl(
      'AnanyaRao2024',
      'backgroundColor=d1f4e0,c0aede&hair=longHair&skinColor=brown',
    ),
    avatarFallbackInitial: 'AR',
    avatarBg: '#d1f4e0',
    intro: "Hi, I'm Ananya Rao. Let's keep this focused and conversational. I'll start with a short intro from you.",
    closing: "Appreciate your time today. One growth area to practice: tighter, outcome-led answers. Thanks again — you're done.",
  },
  {
    id: 'ru-russian',
    name: 'Rahul Menon',
    title: 'Principal Engineer',
    company: 'System Design',
    focus: 'System design',
    voiceStyle: 'professional_male',
    speechPace: 0.92,
    questionPauseMs: 950,
    personality:
      'Precise and methodical. Focuses on algorithmic thinking, system design, and problem-solving depth. Expects rigorous, well-reasoned answers with clear logical structure.',
    avatarUrl: avatarUrl(
      'RahulMenon2024',
      'backgroundColor=c0d8f4,dce8f8&hair=shortHair&skinColor=brown',
    ),
    avatarFallbackInitial: 'RM',
    avatarBg: '#c0d8f4',
    intro: "Hello, I am Rahul Menon. I will focus on clear technical reasoning. Please begin with a brief introduction.",
    closing: "That concludes our session. Your strongest answers were structured; keep improving depth on trade-offs. Thank you.",
  },
];
