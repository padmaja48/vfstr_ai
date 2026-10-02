import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  Flag,
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getScoreTone } from '@/admin/lib/getScoreColor';
import { ADMIN_COLORS } from '@/admin/lib/adminAuth';
import {
  ADMIN_CHART,
  adminChartAxisTick,
  adminChartGridStroke,
  adminChartTooltipStyle,
} from '@/admin/lib/adminCharts';
import { skillsFromScores } from '@/admin/lib/mappers';
import { EmptyState } from '../components/shared/EmptyState';
import { AdminQueryError } from '../components/shared/PendingBackendState';
import { PageSkeleton } from '../components/shared/PageSkeleton';
import { useAdminInterview } from '../hooks';

const formatDate = (iso) =>
  new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const integrityReasonLabel = (reason = '') => {
  const value = String(reason).replace(/^integrity_violation:/, '').replace(/_/g, ' ');
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Integrity policy violation';
};

const formatIncidentDuration = (durationMs = 0) => {
  const seconds = Math.max(0, Math.round(Number(durationMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

const buildTranscript = (interview) => {
  const turns = [];
  const questions = interview.questions?.length
    ? interview.questions
    : (interview.questionsAsked || []).map((q) => ({ question: q }));

  questions.forEach((q, idx) => {
    const text = typeof q === 'string' ? q : q.question;
    if (!text) return;
    turns.push({
      id: `${interview.id}-ai-${idx}`,
      speaker: 'ai',
      label: 'VFSTR.AI Interviewer',
      text,
    });
    const answer = (typeof q === 'object' && q.userAnswer)
      || interview.transcriptExcerpt
      || null;
    if (answer) {
      turns.push({
        id: `${interview.id}-st-${idx}`,
        speaker: 'student',
        label: interview.studentName.split(' ')[0] || 'Student',
        text: answer,
      });
    }
  });

  return turns;
};

const exportInterviewPdf = (row, flagged, report) => {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 48;
  let y = margin;
  const add = (text, opts = {}) => {
    const size = opts.size || 11;
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(String(text || '—'), 500);
    if (y + lines.length * size * 1.35 > 780) {
      doc.addPage();
      y = margin;
    }
    doc.text(lines, margin, y);
    y += lines.length * (size * 1.35) + (opts.gap || 8);
  };

  doc.setFillColor(ADMIN_COLORS.tealAccent);
  doc.rect(0, 0, 595, 78, 'F');
  doc.setTextColor('#ffffff');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('VFSTR.AI Interview Detail Export', margin, 42);
  doc.setTextColor('#111827');
  y = 106;

  add(`${row.studentName} · ${row.targetCompany}`, { size: 14, bold: true });
  add(`Type ${row.type} · Score ${row.score}/100 · ${row.duration} min · ${row.status}${flagged ? ' · FLAGGED' : ''}`);
  add(`Date: ${row.date ? formatDate(row.date) : '—'}`);
  if (report?.hiringRecommendation) {
    add(`Hiring recommendation: ${report.hiringRecommendation}`);
  }
  add('Questions', { size: 13, bold: true, gap: 10 });
  (row.questionsAsked || []).forEach((q, i) => add(`${i + 1}. ${q}`));
  add('Transcript excerpt', { size: 13, bold: true, gap: 10 });
  add(row.transcriptExcerpt || report?.transcriptSummary);
  add('Strengths', { size: 13, bold: true, gap: 10 });
  (row.aiFeedback?.strengths?.length ? row.aiFeedback.strengths : report?.strengths || ['None recorded'])
    .forEach((s) => add(`✓ ${s}`));
  add('Areas for improvement', { size: 13, bold: true, gap: 10 });
  (row.aiFeedback?.improvements?.length ? row.aiFeedback.improvements : report?.improvements || ['None recorded'])
    .forEach((s) => add(`→ ${s}`));
  doc.save(`VFSTR_AI_${String(row.studentName).replace(/\s+/g, '-')}-${row.id}-detail.pdf`);
};

export const AdminInterviewDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useAdminInterview(id);
  const base = data?.interview;
  const report = data?.report;
  const [flagged, setFlagged] = useState(false);

  const transcript = useMemo(
    () => (base ? buildTranscript(base) : []),
    [base],
  );

  const scoreBars = useMemo(() => {
    if (!base) return [];
    if (report) {
      return [
        { label: 'Technical', value: Number(report.technicalScore) || 0 },
        { label: 'Problem Solving', value: Number(report.domainExpertiseScore ?? report.technicalScore) || 0 },
        { label: 'Communication', value: Number(report.communicationScore) || 0 },
        { label: 'Confidence', value: Number(report.confidenceScore ?? report.behavioralScore) || 0 },
        { label: 'Relevance', value: Number(report.behavioralScore) || 0 },
      ];
    }
    const skills = skillsFromScores(base.scores, base.score);
    return [
      { label: 'Technical', value: skills.technical },
      { label: 'Problem Solving', value: skills.problemSolving },
      { label: 'Communication', value: skills.communication },
      { label: 'Confidence', value: skills.confidence },
      { label: 'Relevance', value: skills.answerRelevance },
    ];
  }, [base, report]);

  if (loading) return <PageSkeleton variant="form" />;
  if (error) {
    return (
      <div className="admin-page">
        <AdminQueryError error={error} onRetry={refetch} title="Could not load interview" />
      </div>
    );
  }
  if (!base) {
    return (
      <div className="admin-page">
        <EmptyState
          title="Interview not found"
          description={`No interview matches id “${id}”.`}
          action={(
            <button type="button" className="admin-btn admin-btn--primary" onClick={() => navigate('/admin/interviews')}>
              Back to interviews
            </button>
          )}
        />
      </div>
    );
  }

  const strengths = base.aiFeedback?.strengths?.length
    ? base.aiFeedback.strengths
    : (report?.strengths || []);
  const improvements = base.aiFeedback?.improvements?.length
    ? base.aiFeedback.improvements
    : (report?.improvements || report?.areasForImprovement || []);
  const isFlagged = flagged || base.status === 'flagged';
  const isTerminated = base.status === 'terminated' || base.rawStatus === 'Terminated';
  const violations = base.violations || [];
  const faceIncidents = base.faceIncidents || [];
  const totalPlanned = base.totalPlannedQuestions || report?.totalPlannedQuestions || (base.questions || []).length;
  const questionsAttempted = base.questionsAttempted
    ?? report?.questionsAttempted
    ?? (base.questionsAsked || []).length;
  const endedEarly = report?.endedEarly || isTerminated || questionsAttempted < totalPlanned;
  const questionNumber = Math.min(
    Math.max(1, Number(base.terminationQuestionIndex ?? base.currentQuestionIndex ?? 0) + 1),
    Math.max(1, totalPlanned),
  );

  return (
    <div className="admin-page admin-interview-detail">
      <div className="admin-detail-top">
        <button
          type="button"
          className="admin-btn admin-btn--ghost"
          onClick={() => navigate('/admin/interviews')}
        >
          <ArrowLeft size={15} />
          Back
        </button>
        <div className="admin-detail-actions">
          <button
            type="button"
            className={`admin-btn${isFlagged ? ' admin-btn--danger' : ' admin-btn--ghost'}`}
            onClick={() => setFlagged((v) => !v)}
          >
            <Flag size={15} />
            {isFlagged ? 'Flagged for review' : 'Flag for review'}
          </button>
          <button
            type="button"
            className="admin-btn admin-btn--primary"
            onClick={() => exportInterviewPdf(base, isFlagged, report)}
          >
            <Download size={15} />
            Export as PDF
          </button>
        </div>
      </div>

      <header className="admin-card admin-detail-header">
        <div>
          <p className="admin-page-eyebrow">Interview detail</p>
          <h1>{base.studentName}</h1>
          <p className="admin-page-desc">
            {base.targetCompany} · {base.type} · {base.date ? formatDate(base.date) : '—'}
          </p>
        </div>
        <div className="admin-detail-header-stats">
          <div>
            <span>Score</span>
            <strong className={`admin-score-badge admin-score-badge--${getScoreTone(base.score)}`}>
              {base.score}
            </strong>
          </div>
          <div>
            <span>Duration</span>
            <strong>{base.duration}m</strong>
          </div>
          <div>
            <span>Status</span>
            <strong className={`admin-status-badge admin-status-badge--${isFlagged ? 'flagged' : base.status}`}>
              {isFlagged ? 'flagged' : base.status}
            </strong>
          </div>
        </div>
      </header>

      {endedEarly && (
        <section className="admin-card admin-early-end-card">
          <div className="admin-integrity-summary admin-integrity-summary--warn">
            <strong>
              {report?.sessionNote
                || `Interview ended early — ${questionsAttempted} of ${totalPlanned} questions completed.`}
            </strong>
            {report?.scoreConfidenceNote ? <span>{report.scoreConfidenceNote}</span> : null}
          </div>
        </section>
      )}

      {(isTerminated || violations.length > 0 || faceIncidents.length > 0) && (
        <section className="admin-card admin-integrity-card">
          <div className="admin-chart-card-head">
            <h3>Interview integrity</h3>
            <p>Recorded from the live interview session</p>
          </div>
          {isTerminated && (
            <div className="admin-integrity-summary admin-integrity-summary--danger">
              <strong>Terminated: {integrityReasonLabel(base.terminationReason)}</strong>
              <span>
                Terminated at question {questionNumber} of {totalPlanned}
                {base.terminatedAt ? ` · ${formatDate(base.terminatedAt)}` : ''}
              </span>
            </div>
          )}
          {violations.length > 0 && (
            <div className="admin-integrity-block">
              <h4>Fullscreen / tab and other violation log</h4>
              <ul className="admin-integrity-list">
                {violations.map((item, index) => (
                  <li key={`${item.timestamp}-${item.type}-${index}`}>
                    <strong>{integrityReasonLabel(item.type)}</strong>
                    <span>{item.timestamp ? formatDate(item.timestamp) : '—'}{item.description ? ` · ${item.description}` : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {faceIncidents.length > 0 && (
            <div className="admin-integrity-block">
              <h4>Face-detection incidents</h4>
              <ul className="admin-integrity-list">
                {faceIncidents.map((item, index) => (
                  <li key={`${item.startedAt}-${item.type}-${index}`}>
                    <strong>{item.type === 'multiple_faces' ? 'Multiple faces' : 'Face not detected'}</strong>
                    <span>{item.startedAt ? formatDate(item.startedAt) : '—'} · {formatIncidentDuration(item.durationMs)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <div className="admin-detail-grid">
        <div className="admin-detail-left">
          <section className="admin-card admin-transcript-card">
            <div className="admin-chart-card-head">
              <h3>Transcript</h3>
              <p>Q&A from stored interview answers</p>
            </div>
            <div className="admin-transcript">
              {transcript.length === 0 ? (
                <EmptyState compact title="No transcript yet" description="Answers will appear here once the candidate responds." />
              ) : transcript.map((turn) => (
                <div
                  key={turn.id}
                  className={`admin-bubble admin-bubble--${turn.speaker}`}
                >
                  <span>{turn.label}</span>
                  <p>{turn.text}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="admin-card admin-questions-card">
            <div className="admin-chart-card-head">
              <h3>Questions asked</h3>
              <p>
                {questionsAttempted} of {totalPlanned} questions completed
              </p>
            </div>
            {(base.questionsAsked || []).length === 0 ? (
              <EmptyState compact title="No questions stored" description="Questions appear after the interview starts." />
            ) : (
              <ol className="admin-question-list">
                {base.questionsAsked.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <div className="admin-detail-right">
          <section className="admin-card admin-feedback-side">
            <div className="admin-chart-card-head">
              <h3>AI Feedback</h3>
              <p>Strengths and improvement areas</p>
            </div>
            <div className="admin-feedback-block">
              <h4><CheckCircle2 size={15} /> Strengths</h4>
              <ul>
                {(strengths.length ? strengths : ['No strengths recorded for this session.']).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="admin-feedback-block admin-feedback-block--improve">
              <h4><AlertTriangle size={15} /> Areas for improvement</h4>
              <ul>
                {(improvements.length ? improvements : ['No improvement notes recorded.']).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </section>

          <section className="admin-card admin-scorebreak-card">
            <div className="admin-chart-card-head">
              <h3>Score breakdown</h3>
              <p>{report ? 'From linked interview report' : 'From interview score fields'}</p>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={scoreBars} layout="vertical" margin={{ left: 8, right: 12 }}>
                <CartesianGrid stroke={adminChartGridStroke} strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tick={adminChartAxisTick} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="label" width={110} tick={adminChartAxisTick} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={adminChartTooltipStyle} />
                <Bar dataKey="value" name="Score" fill={ADMIN_CHART.primary} radius={[0, 8, 8, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </section>

          <p className="admin-muted">
            Student profile:{' '}
            <Link className="admin-text-link" to="/admin/users">{base.studentName}</Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default AdminInterviewDetail;
