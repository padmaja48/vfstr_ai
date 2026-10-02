import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import Module from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const filePath = path.join(__dirname, '../src/lib/resumePreview.js');
let code = fs.readFileSync(filePath, 'utf8');
code = code.replace(/export const /g, 'const ');
code += '\nmodule.exports = { extractResumePreview, extractSkillsFromResumeText };\n';

const require = createRequire(import.meta.url);
const m = new Module(filePath);
m.filename = filePath;
m.paths = Module._nodeModulePaths(path.dirname(filePath));
m._compile(code, filePath);
const { extractResumePreview } = m.exports;

const screenshotResume = `
Sai Padmaja
Projects
Food Ordering System- MERN Stack
Book Management System- MERN Stack
PDF Knowledge Chatbot- Hugging Face & Streamlit
Technologies
Programming Languages: C, C++, Python, Java (OOPs), SQL
WebTechnologies: HTML, CSS, JavaScript, React.js, Node.js, Express.js, MongoDB
Dec 2024
Food
Technical Skills
Python, Java, C, C++, JavaScript, SQL, HTML, CSS, React, Node.js, Git, MongoDB
Experience
SURE TRUST- Remote
Workshop Participant, GENAI- Generative AI Workshop
Jan 2025- Present
Generative AI applications
Learned key practices for data preparation, model training, and evaluation
Certifications
Awarded Elite-Gold (Top 1%) certificate in Learning Analytics Tools by NPTEL.
Completed "Problem Solving through Programming in C/C++"- NPTEL.
Completed "Programming, Data Structures, and Algorithms using Python"- NPTEL.
Certified by Bytexl in Full Stack Web Development (MERN Stack).
`;

const glued = `Projects Food Ordering System- MERN Stack Book Management System- MERN Stack PDF Knowledge Chatbot- Hugging Face & Streamlit Technologies Programming Languages: C, C++, Python, Java (OOPs), SQL WebTechnologies: HTML, CSS, JavaScript, React.js Experience SURE TRUST- Remote Workshop Participant, GENAI Workshop Certifications Elite-Gold certificate in Learning Analytics Tools by NPTEL Certified by Bytexl in Full Stack Web Development (MERN Stack)`;

const samplePath = path.join(__dirname, '_sample-resume.txt');
const prizeEducationResume = `
Sai Padmaja
Education
B.Tech Computer Science at Vignan University
Experience
Software Developer Intern at Example Labs
Achievements
Secured 1st place in Code Bingo during the department fest at Vignan University
Won 2nd place in inter-school chess competition at KKR Gowtham School
Workshop Participation
Workshop Participant, GENAI– Generative AI Workshop
Certifications
Elite-Gold certificate in Learning Analytics Tools by NPTEL
`;

const cases = [
  ['screenshot', screenshotResume],
  ['glued', glued],
  ['prizeEducation', prizeEducationResume],
];
if (fs.existsSync(samplePath)) {
  cases.push(['fullPaste', fs.readFileSync(samplePath, 'utf8')]);
}

let failed = false;
for (const [label, text] of cases) {
  const preview = extractResumePreview({ rawText: text, analysis: { skills: [] } });
  const skillLeak = preview.projects.some((p) =>
    /programming languages|web\s*technologies|webtechnologies|^technologies$|html,\s*css|c,\s*c\+\+|javascript,\s*react/i.test(p),
  );
  console.log(label, JSON.stringify({
    skillsCount: preview.skills.length,
    skillsSample: preview.skills.slice(0, 10),
    projects: preview.projects,
    internships: preview.internships,
    certifications: preview.certifications,
    skillLeak,
  }, null, 2));

  if (skillLeak) {
    console.error('VERIFY_FAILED skill leak', label);
    failed = true;
  }
  if (label === 'screenshot') {
    if (preview.projects.length < 3 || preview.projects.length > 4) {
      console.error('VERIFY_FAILED project count', preview.projects.length);
      failed = true;
    }
    if (!preview.projects.some((p) => /food ordering/i.test(p))) {
      console.error('VERIFY_FAILED missing food ordering');
      failed = true;
    }
    if (preview.internships.length < 1) {
      console.error('VERIFY_FAILED missing internship');
      failed = true;
    }
    if (preview.certifications.length < 3) {
      console.error('VERIFY_FAILED cert count', preview.certifications.length);
      failed = true;
    }
    if (preview.skills.length < 8) {
      console.error('VERIFY_FAILED skills count', preview.skills.length);
      failed = true;
    }
    if (preview.internships.some((i) => /workshop participant|1st place|2nd place|won\s/i.test(i))) {
      console.error('VERIFY_FAILED prize/workshop leaked into internships', preview.internships);
      failed = true;
    }
  }
  if (label === 'prizeEducation') {
    if (preview.internships.some((i) => /1st place|2nd place|won\s|b\.?\s*tech|university|workshop/i.test(i))) {
      console.error('VERIFY_FAILED prize/education/workshop in experience', preview.internships);
      failed = true;
    }
    if (!preview.internships.some((i) => /software developer intern|example labs/i.test(i))) {
      console.error('VERIFY_FAILED missing real internship', preview.internships);
      failed = true;
    }
    if (!preview.certifications.some((c) => /1st place|code bingo/i.test(c))) {
      console.error('VERIFY_FAILED prizes not moved to certifications', preview.certifications);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log('VERIFY_OK');
