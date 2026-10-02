import React, { useCallback, useContext, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Download, ExternalLink, UserX } from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';
import { PageSkeleton } from '../components/shared/PageSkeleton';
import { AdminDialog } from '../components/shared/AdminDialog';
import { AdminQueryError } from '../components/shared/PendingBackendState';
import { ScoreRing } from '../components/shared/ScoreRing';
import { SkillRadarChart, toSkillRadarData } from '../components/shared/SkillRadarChart';
import { FluentReadinessGauge } from '../components/shared/FluentReadinessGauge';
import { adminAnalyticsService } from '../services/adminApi';
import { mapInterview } from '../lib/mappers';
import { useReportDownload } from '../hooks/useReportDownload';
import { downloadCandidate360Pdf } from '../lib/reportPdf';
import { getScoreColor } from '../lib/getScoreColor';
import { AuthContext } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

export const AdminCandidate360 = () => {
  const { id } = useParams();
  const toast = useToast();
  const { user: authUser } = useContext(AuthContext);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [terminateOpen, setTerminateOpen] = useState(false);
  const [terminateReason, setTerminateReason] = useState('');
  const [terminating, setTerminating] = useState(false);
  const { downloading, runDownload } = useReportDownload();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await adminAnalyticsService.getCandidate360(id);
      setData(payload);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <PageSkeleton rows={8} />;
  if (error) return <AdminQueryError error={error} onRetry={load} title="Could not load 360° report" />;
  if (!data?.user) return <AdminQueryError error={new Error('Not found')} onRetry={load} title="Candidate not found" />;

  const { user, interviews, aggregates, terminationHistory } = data;
  const mappedInterviews = (interviews || []).map(mapInterview);
  const radar = toSkillRadarData({
    technical: aggregates.technicalAverage,
    communication: aggregates.communicationAverage,
    problemSolving: aggregates.technicalAverage,
    confidence: aggregates.averageScore,
    answerRelevance: aggregates.averageScore,
    overall: aggregates.readinessScore,
  });

  const handlePdf = () => runDownload(
    () => downloadCandidate360Pdf({ user, aggregates, interviews: mappedInterviews, terminationHistory }),
    '360° report downloaded',
  );

  const confirmTerminate = async () => {
    const reason = terminateReason.trim();
    if (reason.length < 3) {
      toast.error('A termination reason is required (at least 3 characters).');
      return;
    }
    setTerminating(true);
    try {
      const result = await adminAnalyticsService.terminateStudent(id, { reason });
      toast.success('Student terminated.', { className: 'app-toast--teal' });
      setTerminateOpen(false);
      setTerminateReason('');
      setData((prev) => (prev ? {
        ...prev,
        user: { ...prev.user, isActive: false },
        terminationHistory: result.terminationHistory || prev.terminationHistory,
      } : prev));
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Could not terminate student.');
    } finally {
      setTerminating(false);
    }
  };

  const canTerminate = authUser && user?.isActive !== false;

  return (
    <div className="admin-page admin-candidate-360">
      <PageHeader
        title={`360° Report — ${user.name}`}
        subtitle={[user.email, user.institution, user.batch, user.branch].filter(Boolean).join(' · ')}
        actions={(
          <>
            <Link to="/admin/users" className="admin-btn admin-btn--ghost">
              <ArrowLeft size={16} /> Back to students
            </Link>
            {canTerminate ? (
              <button type="button" className="admin-btn admin-btn--danger" onClick={() => setTerminateOpen(true)}>
                <UserX size={16} /> Terminate
              </button>
            ) : null}
            <button type="button" className="admin-btn admin-btn--primary" disabled={downloading} onClick={handlePdf}>
              <Download size={16} /> Export PDF
            </button>
          </>
        )}
      />

      <div className="admin-360-grid">
        <section className="admin-card admin-360-summary">
          <FluentReadinessGauge score={aggregates.readinessScore} label="Interview readiness" />
          <div className="admin-360-scores">
            <ScoreRing score={aggregates.averageScore} label="Avg score" size={88} />
            <ScoreRing score={aggregates.technicalAverage} label="Technical" size={72} />
            <ScoreRing score={aggregates.communicationAverage} label="Communication" size={72} />
          </div>
          <ul className="admin-360-stats">
            <li><strong>{aggregates.totalInterviews}</strong> total interviews</li>
            <li><strong>{aggregates.completedInterviews}</strong> completed</li>
          </ul>
        </section>

        <section className="admin-card">
          <h3>Performance profile</h3>
          <SkillRadarChart data={radar} />
        </section>

        <section className="admin-card admin-360-feedback">
          <h3>AI feedback (recent)</h3>
          <div className="admin-360-feedback-cols">
            <div>
              <h4>Strengths</h4>
              <ul>{(aggregates.strengths || []).map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
            <div>
              <h4>Weaknesses</h4>
              <ul>{(aggregates.weaknesses || []).map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
            <div>
              <h4>Improvements</h4>
              <ul>{(aggregates.improvements || []).map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
          </div>
        </section>

        <section className="admin-card admin-360-history">
          <h3>Interview history</h3>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Company</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Score</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {mappedInterviews.map((iv) => (
                  <tr key={iv.id}>
                    <td>{iv.date ? new Date(iv.date).toLocaleDateString() : '—'}</td>
                    <td>{iv.targetCompany}</td>
                    <td>{iv.type}</td>
                    <td>{iv.status}</td>
                    <td style={{ color: getScoreColor(iv.score) }}>{iv.score || '—'}</td>
                    <td>
                      <Link to={`/admin/interviews/${iv.id}`} className="admin-link-inline">
                        <ExternalLink size={14} /> Detail
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {terminationHistory?.length > 0 && (
          <section className="admin-card">
            <h3>Termination history</h3>
            <ul className="admin-360-terminations">
              {terminationHistory.map((ev, i) => (
                <li key={i}>
                  <strong>{new Date(ev.terminatedAt).toLocaleString()}</strong>
                  <span>{ev.reason}</span>
                  {ev.reasonType ? <em>{ev.reasonType}</em> : null}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <AdminDialog
        open={terminateOpen}
        title="Terminate student account?"
        description={`This deactivates ${user.name} and records a termination event. A reason is required.`}
        onClose={() => {
          setTerminateOpen(false);
          setTerminateReason('');
        }}
        footer={(
          <>
            <button type="button" className="admin-btn admin-btn--ghost" onClick={() => setTerminateOpen(false)}>Cancel</button>
            <button
              type="button"
              className="admin-btn admin-btn--danger"
              disabled={terminating || terminateReason.trim().length < 3}
              onClick={confirmTerminate}
            >
              {terminating ? 'Terminating…' : 'Terminate student'}
            </button>
          </>
        )}
      >
        <label>
          <span>Reason</span>
          <textarea
            rows={4}
            value={terminateReason}
            onChange={(e) => setTerminateReason(e.target.value)}
            placeholder="Describe why this student is being terminated…"
            required
          />
        </label>
      </AdminDialog>
    </div>
  );
};

export default AdminCandidate360;
