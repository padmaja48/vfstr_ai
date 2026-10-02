import React, { useState, useEffect, useContext, useMemo } from 'react';
import { AuthContext } from '../context/AuthContext';
import { userAPI, interviewAPI } from '../services/api';
import { InterviewFlowSteps } from './interview/InterviewFlowSteps';
import '../styles/Dashboard.css';

const ROLE_COLORS = [
  '#1e3a8a',
  '#3b82f6',
  '#2563eb',
  '#60a5fa',
  '#115e59',
  '#93c5fd',
  '#0b1b3d',
  '#bfdbfe',
];

const polarToCartesian = (cx, cy, r, angleDeg) => {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
};

const describeArc = (cx, cy, r, startAngle, endAngle) => {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y} Z`;
};

const RolePieChart = ({ segments }) => {
  const total = segments.reduce((sum, s) => sum + s.count, 0);

  if (!total) {
    return (
      <div className="role-pie-empty">
        <p>No interview data yet. Start a session to see role breakdown.</p>
      </div>
    );
  }

  let angle = 0;
  const slices = segments.map((seg, i) => {
    const sweep = (seg.count / total) * 360;
    const start = angle;
    const end = angle + sweep;
    angle = end;
    const path =
      sweep >= 359.99
        ? `M ${90} ${90} m 0 -72 a 72 72 0 1 1 0 144 a 72 72 0 1 1 0 -144`
        : describeArc(90, 90, 72, start, end);
    return { ...seg, path, color: ROLE_COLORS[i % ROLE_COLORS.length] };
  });

  return (
    <div className="role-pie">
      <div className="role-pie-chart-wrap">
        <svg viewBox="0 0 180 180" className="role-pie-svg" aria-hidden="true">
          {slices.map((slice) => (
            <path key={slice.role} d={slice.path} fill={slice.color} stroke="var(--surface)" strokeWidth="2" />
          ))}
          <circle cx="90" cy="90" r="42" fill="var(--surface)" />
          <text x="90" y="86" textAnchor="middle" className="role-pie-center-val">
            {total}
          </text>
          <text x="90" y="104" textAnchor="middle" className="role-pie-center-label">
            INTERVIEWS
          </text>
        </svg>
      </div>
      <ul className="role-pie-legend">
        {slices.map((slice) => (
          <li key={slice.role}>
            <span className="role-pie-swatch" style={{ background: slice.color }} />
            <div className="role-pie-legend-meta">
              <strong>{slice.role}</strong>
              <span>
                {slice.count} interview{slice.count === 1 ? '' : 's'}
                {slice.highestScore != null ? ` · best ${Math.round(slice.highestScore)}%` : ''}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

const formatFirstName = (name = '') => {
  const first = name.trim().split(/\s+/).filter(Boolean)[0] || 'there';
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
};

const formatDisplayName = (name = '') =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ') || 'Candidate';

const formatHistoryDate = (value) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const Dashboard = ({ setCurrentView }) => {
  const { user } = useContext(AuthContext);
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [interviews, setInterviews] = useState([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [roleFilter, setRoleFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const HISTORY_PAGE_SIZE = 5;

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const [response, ivRes] = await Promise.all([
          userAPI.getDashboard(),
          interviewAPI.getUserInterviews().catch(() => ({ data: [] })),
        ]);
        setDashboardData(response.data);
        setInterviews(ivRes.data || []);
      } catch (err) {
        console.error('Failed to fetch dashboard:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboard();
  }, []);

  const roleSegments = useMemo(() => {
    const byRole = new Map();
    interviews.forEach((iv) => {
      const role = iv.roleDomain || iv.targetRole || 'Other';
      const existing = byRole.get(role) || { role, count: 0, highestScore: null };
      existing.count += 1;
      const score = Number(iv.totalScore);
      if (Number.isFinite(score) && score > 0) {
        existing.highestScore =
          existing.highestScore == null ? score : Math.max(existing.highestScore, score);
      }
      byRole.set(role, existing);
    });
    return Array.from(byRole.values()).sort((a, b) => b.count - a.count);
  }, [interviews]);

  const roleOptions = useMemo(() => {
    const roles = new Set();
    interviews.forEach((iv) => {
      const role = String(iv.roleDomain || '').trim();
      if (role) roles.add(role);
    });
    return Array.from(roles).sort((a, b) => a.localeCompare(b));
  }, [interviews]);

  const toDateKey = (value) => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const filteredInterviews = useMemo(() => {
    return interviews.filter((iv) => {
      const role = String(iv.roleDomain || '').trim() || 'Other';
      if (roleFilter !== 'all' && role !== roleFilter) return false;
      const key = toDateKey(iv.completedAt || iv.createdAt);
      if (dateFrom && (!key || key < dateFrom)) return false;
      if (dateTo && (!key || key > dateTo)) return false;
      return true;
    });
  }, [interviews, roleFilter, dateFrom, dateTo]);

  useEffect(() => {
    setHistoryPage(1);
  }, [roleFilter, dateFrom, dateTo]);

  if (loading) return <div className="loading">Loading...</div>;

  const { user: userData, totals = {} } = dashboardData || {};
  const displayUser = userData || user || {};
  const scoredInterviews = interviews.filter((iv) => Number(iv.totalScore) > 0);
  const highestScore = scoredInterviews.length
    ? Math.max(...scoredInterviews.map((iv) => Number(iv.totalScore || 0)))
    : 0;
  const formatScore = (score) => Number(score || 0).toFixed(1);
  const firstName = formatFirstName(displayUser.name);
  const candidateFullName = formatDisplayName(displayUser.name);
  const interviewCount = totals.interviews || interviews.length || 0;
  const historyTotalPages = Math.max(1, Math.ceil(filteredInterviews.length / HISTORY_PAGE_SIZE));
  const currentHistoryPage = Math.min(historyPage, historyTotalPages);
  const historyStart = (currentHistoryPage - 1) * HISTORY_PAGE_SIZE;
  const pagedInterviews = filteredInterviews.slice(historyStart, historyStart + HISTORY_PAGE_SIZE);
  const hasHistoryFilters = roleFilter !== 'all' || dateFrom || dateTo;

  const clearHistoryFilters = () => {
    setRoleFilter('all');
    setDateFrom('');
    setDateTo('');
  };

  const scoreTone = (score) => {
    if (score == null || score === '') return 'muted';
    const n = Number(score);
    if (n >= 80) return 'good';
    if (n >= 60) return 'ok';
    return 'low';
  };

  return (
    <div className="dashboard dashboard--pro">
      <section className="db-command">
        <div className="db-command-copy">
          <p className="db-eyebrow">Candidate workspace</p>
          <h1>Welcome, {firstName}</h1>
          <p className="db-lede">
            Prepare with a timed VFSTR.AI mock interview, then review your scored feedback and practice plan.
          </p>
        </div>
        <div className="db-command-actions">
          <button type="button" className="db-btn db-btn--primary" onClick={() => setCurrentView?.('interview')}>
            Start interview
          </button>
          <button type="button" className="db-btn db-btn--ghost" onClick={() => setCurrentView?.('results')}>
            View reports
          </button>
        </div>
      </section>

      <section className="db-kpi-bar" aria-label="Interview summary">
        <div className="db-kpi">
          <span className="db-kpi-label">Sessions</span>
          <strong className="db-kpi-value">{interviewCount}</strong>
          <span className="db-kpi-note">Total interviews</span>
        </div>
        <div className="db-kpi">
          <span className="db-kpi-label">Peak score</span>
          <strong className="db-kpi-value">{formatScore(highestScore)}</strong>
          <span className="db-kpi-note">
            {scoredInterviews.length ? 'Best completed interview' : 'Awaiting first score'}
          </span>
        </div>
        <div className="db-kpi db-kpi--path">
          <span className="db-kpi-label">Interview path</span>
          <InterviewFlowSteps activeIndex={0} compact className="db-path-flow" />
        </div>
      </section>

      <section className="db-workspace">
        <aside className="db-workspace-side">
          <header className="db-panel-head">
            <h2>Role distribution</h2>
            <p>Practice volume by target role</p>
          </header>
          <div className="db-panel-body">
            <RolePieChart segments={roleSegments} />
          </div>
        </aside>

        <div className="db-workspace-main">
          <header className="db-panel-head db-panel-head--row">
            <div>
              <h2>Interview history</h2>
              <p>Recent sessions and scores</p>
            </div>
            {interviews.length > 0 ? (
              <span className="db-panel-count">{filteredInterviews.length} shown</span>
            ) : null}
          </header>

          {interviews.length === 0 ? (
            <div className="db-empty">
              <strong>No interviews recorded</strong>
              <p>Start a mock interview to populate your history and role analytics.</p>
              <button type="button" className="db-btn db-btn--primary" onClick={() => setCurrentView?.('interview')}>
                Begin first interview
              </button>
            </div>
          ) : (
            <div className="db-history-body">
              <div className="db-history-filters">
                <label className="db-history-filter">
                  <span>Role</span>
                  <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
                    <option value="all">All roles</option>
                    {roleOptions.map((role) => (
                      <option key={role} value={role}>{role}</option>
                    ))}
                  </select>
                </label>
                <label className="db-history-filter">
                  <span>From</span>
                  <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </label>
                <label className="db-history-filter">
                  <span>To</span>
                  <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </label>
                {hasHistoryFilters && (
                  <button type="button" className="db-history-clear" onClick={clearHistoryFilters}>
                    Clear
                  </button>
                )}
              </div>

              {filteredInterviews.length === 0 ? (
                <div className="db-empty db-empty--compact">No interviews match these filters.</div>
              ) : (
                <div className="db-table-wrap">
                  <table className="db-pro-table">
                    <thead>
                      <tr>
                        <th>Candidate</th>
                        <th>Date</th>
                        <th>Role</th>
                        <th>Type</th>
                        <th>Duration</th>
                        <th className="db-col-score">Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedInterviews.map((iv) => {
                        const score = iv.totalScore ? Math.round(iv.totalScore) : null;
                        return (
                          <tr key={iv._id}>
                            <td className="db-history-name" title={candidateFullName}>{candidateFullName}</td>
                            <td>{formatHistoryDate(iv.completedAt || iv.createdAt)}</td>
                            <td><span className="db-history-pill">{iv.roleDomain || '—'}</span></td>
                            <td>{iv.interviewType || iv.interviewStyle || '—'}</td>
                            <td>{iv.duration ? `${iv.duration} min` : '—'}</td>
                            <td className="db-col-score">
                              <span className={`db-history-score db-history-score--${scoreTone(score)}`}>
                                {score != null ? `${score}%` : '—'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {filteredInterviews.length > HISTORY_PAGE_SIZE && (
                <div className="db-history-pagination">
                  <span className="db-history-page-info">
                    Showing {historyStart + 1}–{Math.min(historyStart + HISTORY_PAGE_SIZE, filteredInterviews.length)} of {filteredInterviews.length}
                  </span>
                  <div className="db-history-page-controls">
                    <button
                      type="button"
                      className="db-history-page-btn"
                      disabled={currentHistoryPage <= 1}
                      onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                    >
                      Previous
                    </button>
                    <span className="db-history-page-count">
                      Page {currentHistoryPage} of {historyTotalPages}
                    </span>
                    <button
                      type="button"
                      className="db-history-page-btn"
                      disabled={currentHistoryPage >= historyTotalPages}
                      onClick={() => setHistoryPage((p) => Math.min(historyTotalPages, p + 1))}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
