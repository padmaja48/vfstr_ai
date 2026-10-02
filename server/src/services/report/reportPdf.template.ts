import type { CleanReportData } from './report.types';

export type ScoreBand = 'needs' | 'developing' | 'proficient' | 'strong';

export const scoreBand = (score: number): { label: string; band: ScoreBand } => {
  if (score >= 85) return { label: 'Strong', band: 'strong' };
  if (score >= 70) return { label: 'Proficient', band: 'proficient' };
  if (score >= 40) return { label: 'Developing', band: 'developing' };
  return { label: 'Needs Work', band: 'needs' };
};

export const hiringBand = (signal: string): 'hire' | 'borderline' | 'nohire' => {
  const s = String(signal || '').toLowerCase();
  if (/no hire|needs practice|reject/.test(s)) return 'nohire';
  if (/borderline|needs focused/.test(s)) return 'borderline';
  return 'hire';
};

const esc = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const escPre = (value: unknown) => esc(value);

export const buildReportHtml = (data: CleanReportData, logoDataUri?: string): string => {
  const logo = logoDataUri
    ? `<img src="${logoDataUri}" alt="ProGrow" class="logo" />`
    : `<div class="logo-text">ProGrow</div>`;

  const sectionRows = data.sectionReadiness.map((row) => {
    const band = scoreBand(row.score);
    return `<tr>
      <td>${esc(row.category)}</td>
      <td class="num">${row.score}</td>
      <td><span class="pill pill--${band.band}">${esc(band.label)}</span></td>
      <td class="muted">${esc(row.measures)}</td>
    </tr>`;
  }).join('');

  const strengths = data.strengths.map((s) => `<li class="ok">✓ ${esc(s)}</li>`).join('');
  const improvements = data.areasToImprove.map((s) => `<li class="warn">! ${esc(s)}</li>`).join('');
  const practice = data.practiceNext.map((s, i) => `<li>${i + 1}. ${esc(s)}</li>`).join('');

  const questionCards = data.questions.map((q) => {
    const answerBlock = q.isCode
      ? `<pre class="answer-code">${escPre(q.candidateAnswer)}</pre>`
      : `<blockquote class="answer-quote">${esc(q.candidateAnswer)}</blockquote>`;

    return `<article class="q-card">
      <header class="q-head">
        <span class="q-num">QUESTION ${q.number} — ${q.score}/100</span>
      </header>
      <div class="q-body">
        <h4>Question</h4>
        <p>${esc(q.questionText)}</p>
        <h4>Candidate's Answer</h4>
        ${answerBlock}
        ${q.suggestedImprovedAnswer
          ? `<div class="improved-box">
        <h5>Suggested Improved Answer</h5>
        <p>${esc(q.suggestedImprovedAnswer)}</p>
      </div>`
          : ''}
        ${q.conceptsToRevise.length
          ? `<p class="concepts"><strong>Concepts to Revise</strong> ${esc(q.conceptsToRevise.join(', '))}</p>`
          : ''}
      </div>
    </article>`;
  }).join('');

  const hiringChance = data.summary.overallScore;
  const snapshotExplanation = String(data.hiringSignalNote || data.summary.recommendationNote || '')
    .replace(/\s+/g, ' ')
    .trim();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Interview Feedback Report — ${esc(data.candidate.name)}</title>
<style>
  @page { size: A4; margin: 18mm 14mm 20mm; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    color: #1f2a27;
    font-size: 10.5pt;
    line-height: 1.5;
    margin: 0;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .header-bar, .footer-bar { display: none; }
  .title-block { text-align: center; margin: 0 0 20px; padding-bottom: 16px; border-bottom: 2px solid #0d4f4a; }
  .title-block h1 { margin: 0; font-size: 22pt; color: #0d4f4a; font-weight: 700; }
  .title-block h2 { margin: 6px 0 14px; font-size: 14pt; font-weight: 500; color: #334155; }
  .info-bar {
    display: flex; flex-wrap: wrap; justify-content: center; gap: 8px 24px;
    font-size: 9.5pt; color: #475569;
  }
  .info-bar strong { color: #1f2a27; }
  section { margin-bottom: 22px; page-break-inside: avoid; }
  section h3 {
    font-size: 12pt; color: #0d4f4a; margin: 0 0 10px;
    border-left: 4px solid #0d9488; padding-left: 10px;
  }
  .verdict-box {
    background: #ecfdf5; border: 1px solid #99f6e4; border-radius: 10px;
    padding: 14px 16px; margin-bottom: 14px;
  }
  .verdict-box strong { display: block; font-size: 12pt; color: #0f766e; margin-bottom: 4px; }
  .hiring-chance-value { margin: 0; font-size: 18pt; font-weight: 700; color: #0d4f4a; }
  .verdict-note { margin: 6px 0 0; font-size: 9.5pt; color: #475569; }
  .stat-row {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 10px;
  }
  .stat {
    background: #faf7f0; border: 1px solid #e7dfcc; border-radius: 10px;
    padding: 12px; text-align: center;
  }
  .stat span { display: block; font-size: 8.5pt; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }
  .stat strong { font-size: 18pt; color: #0d4f4a; }
  .email-line { font-size: 9.5pt; color: #64748b; text-align: center; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  th, td { border: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; vertical-align: top; }
  th { background: #0d4f4a; color: #fff; font-weight: 600; }
  tr:nth-child(even) td { background: #f8fafc; }
  td.num { text-align: center; font-weight: 700; width: 56px; }
  .muted { color: #64748b; font-size: 9pt; }
  .pill {
    display: inline-block; padding: 2px 8px; border-radius: 999px;
    font-size: 8.5pt; font-weight: 600;
  }
  .pill--needs { background: #fee2e2; color: #b91c1c; }
  .pill--developing { background: #fef3c7; color: #b45309; }
  .pill--proficient { background: #ccfbf1; color: #0f766e; }
  .pill--strong { background: #dcfce7; color: #15803d; }
  ul { margin: 0; padding-left: 0; list-style: none; }
  li.ok { color: #166534; margin-bottom: 6px; }
  li.warn { color: #c2410c; margin-bottom: 6px; }
  ol { margin: 0; padding-left: 20px; }
  ol li { margin-bottom: 6px; }
  .hire-box {
    border-radius: 10px; padding: 12px 14px; margin-bottom: 12px;
  }
  .hire-box--hire { background: #ecfdf5; border: 1px solid #6ee7b7; }
  .hire-box--borderline { background: #fffbeb; border: 1px solid #fcd34d; }
  .hire-box--nohire { background: #fef2f2; border: 1px solid #fca5a5; }
  .hire-box strong { display: block; font-size: 11pt; margin-bottom: 4px; }
  .dash li::before { content: "– "; color: #0d9488; }
  .dash li { margin-bottom: 4px; color: #334155; }
  .trend { display: flex; align-items: center; gap: 12px; margin: 10px 0; }
  .trend-box {
    background: #f1f5f9; border-radius: 8px; padding: 10px 16px; text-align: center; min-width: 90px;
  }
  .trend-box span { display: block; font-size: 8pt; color: #64748b; }
  .trend-box strong { font-size: 16pt; }
  .trend-box--current { background: #ccfbf1; }
  .trend-delta { font-weight: 700; color: #0d9488; }
  .diff-line span { margin-right: 8px; }
  .disclaimer { font-size: 8.5pt; color: #94a3b8; font-style: italic; margin-top: 16px; }
  .q-card {
    border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;
    margin-bottom: 18px; page-break-inside: avoid;
  }
  .q-head {
    background: #0d4f4a; color: #fff; display: flex; align-items: center; gap: 12px;
    padding: 10px 14px; font-size: 9pt;
  }
  .q-num { font-weight: 700; letter-spacing: 0.06em; flex: 1; }
  .q-diff { font-style: italic; opacity: 0.9; }
  .q-score { background: rgba(255,255,255,0.15) !important; color: #fff !important; }
  .q-body { padding: 14px 16px; }
  .q-body h4 { margin: 12px 0 6px; font-size: 9.5pt; color: #0d4f4a; text-transform: uppercase; letter-spacing: 0.04em; }
  .q-body h4:first-child { margin-top: 0; }
  .q-body h5 { margin: 0 0 4px; font-size: 9pt; color: #475569; }
  .answer-quote {
    margin: 0; padding: 10px 14px; background: #f8fafc; border-left: 3px solid #cbd5e1;
    font-style: italic; color: #334155; border-radius: 0 8px 8px 0;
  }
  .answer-code {
    margin: 0; padding: 10px 12px; background: #1e293b; color: #e2e8f0;
    font-family: Consolas, 'Courier New', monospace; font-size: 8.5pt;
    border-radius: 8px; white-space: pre-wrap; word-break: break-word;
  }
  .feedback-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 12px 0; }
  .fb { border-radius: 8px; padding: 10px 12px; font-size: 9.5pt; }
  .fb--ok { background: #f0fdf4; border: 1px solid #bbf7d0; }
  .fb--miss { background: #fff7ed; border: 1px solid #fed7aa; }
  .concepts { font-size: 9.5pt; margin: 8px 0; }
  .improved-box {
    background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 10px;
    padding: 12px 14px; margin-top: 10px;
  }
  .logo { height: 28px; width: auto; }
  .logo-text { font-weight: 700; color: #0d4f4a; }
</style>
</head>
<body>
  <div class="title-block">
    <h1>Interview Feedback Report</h1>
    <h2>${esc(data.candidate.name)}</h2>
    <div class="info-bar">
      <span><strong>Role:</strong> ${esc(data.candidate.role)}</span>
      <span><strong>Date:</strong> ${esc(data.candidate.date)}</span>
      <span><strong>Duration:</strong> ${data.candidate.durationMinutes || '—'} min</span>
    </div>
  </div>

  <section>
    <h3>1. Snapshot</h3>
    <div class="verdict-box">
      <strong>Hiring Chance</strong>
      <p class="hiring-chance-value">${hiringChance}%</p>
      ${snapshotExplanation ? `<p class="verdict-note">${esc(snapshotExplanation)}</p>` : ''}
    </div>
    <div class="stat-row">
      <div class="stat"><span>Overall Score</span><strong>${data.summary.overallScore}</strong></div>
      <div class="stat"><span>Type · Level</span><strong style="font-size:11pt">${esc(data.summary.type)} · ${esc(data.summary.level)}</strong></div>
      <div class="stat"><span>Questions Answered</span><strong>${data.summary.questionsAnswered}/${data.summary.questionsTotal}</strong></div>
    </div>
    ${data.candidate.email ? `<p class="email-line">${esc(data.candidate.email)}</p>` : ''}
  </section>

  <section>
    <h3>2. Section Readiness</h3>
    <table>
      <thead><tr><th>Category</th><th>Score</th><th>Rating</th><th>What it measures</th></tr></thead>
      <tbody>${sectionRows || '<tr><td colspan="4" class="muted">No section scores recorded.</td></tr>'}</tbody>
    </table>
  </section>

  <section>
    <h3>3. Strengths</h3>
    <ul>${strengths}</ul>
  </section>

  <section>
    <h3>4. Areas to Improve</h3>
    <ul>${improvements}</ul>
  </section>

  <section>
    <h3>5. What to Practice Next</h3>
    <ol>${practice}</ol>
  </section>

  <section>
    <h3>6. Question-by-Question Review</h3>
    ${questionCards || '<p class="muted">No questions were evaluated.</p>'}
    <p class="disclaimer">Scores reflect evaluated answers only. This report is generated from AI-assisted analysis and should be used alongside human judgment.</p>
  </section>
</body>
</html>`;
};

export default buildReportHtml;
