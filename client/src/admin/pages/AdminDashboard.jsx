import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  GraduationCap,
  Users,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PageHeader } from '../components/shared/PageHeader';
import { StatCard } from '../components/shared/StatCard';
import { EmptyState } from '../components/shared/EmptyState';
import { AdminQueryError } from '../components/shared/PendingBackendState';
import { useAdminDashboard } from '../hooks';
import { adminAnalyticsService } from '../services/adminApi';
import { getScoreTone } from '@/admin/lib/getScoreColor';
import {
  ADMIN_CHART,
  adminChartAxisTick,
  adminChartGridStroke,
  adminChartTooltipStyle,
  getScoreBucketFill,
} from '@/admin/lib/adminCharts';

const RANGES = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: 'all', label: 'All time' },
];

const formatDate = (iso) =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

const statusLabel = (status) => String(status || '').charAt(0).toUpperCase() + String(status || '').slice(1);

const ChartCard = ({ title, subtitle, children }) => (
  <section className="admin-card admin-chart-card">
    <div className="admin-chart-card-head">
      <h3>{title}</h3>
      {subtitle ? <p>{subtitle}</p> : null}
    </div>
    <div className="admin-chart-body">{children}</div>
  </section>
);

const DashboardSkeleton = () => (
  <div className="admin-page admin-dashboard" aria-busy="true" aria-label="Loading dashboard">
    <div className="admin-skel admin-skel--header" />
    <div className="admin-stat-row admin-stat-row--2">
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="admin-skel admin-skel--stat" />
      ))}
    </div>
    <div className="admin-stat-row admin-stat-row--5">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={`score-${i}`} className="admin-skel admin-skel--stat" />
      ))}
    </div>
    <div className="admin-charts-row">
      <div className="admin-skel admin-skel--chart" />
      <div className="admin-skel admin-skel--chart" />
    </div>
    <div className="admin-charts-row">
      <div className="admin-skel admin-skel--chart" />
      <div className="admin-skel admin-skel--chart" />
    </div>
    <div className="admin-skel admin-skel--table" />
  </div>
);

export const AdminDashboard = () => {
  const [range, setRange] = useState('30d');
  const [comparison, setComparison] = useState([]);
  const {
    loading,
    error,
    refetch,
    metrics,
    activityData,
    scoreData,
    weaknessData,
    recentInterviews,
    topInstitutions,
    isSuperAdmin,
  } = useAdminDashboard(range);

  useEffect(() => {
    if (!isSuperAdmin) return undefined;
    let cancelled = false;
    adminAnalyticsService.institutionComparison()
      .then((payload) => {
        if (!cancelled) setComparison(payload?.institutions || []);
      })
      .catch(() => {
        if (!cancelled) setComparison([]);
      });
    return () => { cancelled = true; };
  }, [isSuperAdmin]);

  if (loading) return <DashboardSkeleton />;
  if (error) {
    return (
      <div className="admin-page admin-dashboard">
        <PageHeader title="Dashboard" description="Overview of VFSTR.AI across your institutions" />
        <AdminQueryError error={error} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="admin-page admin-dashboard">
      <PageHeader
        title="Dashboard"
        description={isSuperAdmin
          ? 'Platform-wide metrics across all institutions'
          : 'Metrics for your assigned college(s) only'}
        actions={(
          <div className="admin-range-filter" role="group" aria-label="Date range">
            {RANGES.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`admin-range-btn${range === item.id ? ' is-active' : ''}`}
                onClick={() => setRange(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      />

      <div className="admin-stat-row admin-stat-row--2">
        <StatCard title="Total Students" icon={Users} value={metrics.totalStudents} />
        <StatCard title="Total Interviews" icon={Activity} value={metrics.totalInterviews} />
      </div>

      <div className="admin-stat-row admin-stat-row--5">
        <StatCard title="Highest Score" icon={GraduationCap} value={metrics.highestScore} />
        <StatCard title="Lowest Score" icon={GraduationCap} value={metrics.lowestScore} />
        <StatCard title="Avg Score" icon={GraduationCap} value={metrics.averageScore} />
        <StatCard title="Technical Avg" icon={GraduationCap} value={metrics.technicalAverage} />
        <StatCard title="Communication Avg" icon={GraduationCap} value={metrics.communicationAverage} />
      </div>

      <div className="admin-charts-row">
        <ChartCard title="Interview Activity" subtitle={`Weekly volume · filter: ${range}`}>
          {activityData.every((d) => d.interviewCount === 0) ? (
            <EmptyState compact title="No interview activity yet" description="Charts will populate as sessions are created." />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={activityData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="adminActivityFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={ADMIN_CHART.primary} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={ADMIN_CHART.primary} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={adminChartGridStroke} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="weekLabel" tick={adminChartAxisTick} axisLine={false} tickLine={false} />
                <YAxis tick={adminChartAxisTick} axisLine={false} tickLine={false} width={32} />
                <Tooltip contentStyle={adminChartTooltipStyle} />
                <Area type="monotone" dataKey="interviewCount" name="Interviews" stroke={ADMIN_CHART.primary} strokeWidth={2.5} fill="url(#adminActivityFill)" />
                <Area type="monotone" dataKey="completedCount" name="Completed" stroke={ADMIN_CHART.secondary} strokeWidth={2} fill="transparent" strokeDasharray="5 4" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Score Distribution" subtitle="Completed sessions by score bucket">
          {scoreData.every((d) => d.count === 0) ? (
            <EmptyState compact title="No completed scores yet" description="Distribution appears after interviews finish." />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={scoreData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={adminChartGridStroke} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={adminChartAxisTick} axisLine={false} tickLine={false} />
                <YAxis tick={adminChartAxisTick} axisLine={false} tickLine={false} width={32} />
                <Tooltip contentStyle={adminChartTooltipStyle} />
                <Bar dataKey="count" name="Interviews" radius={[8, 8, 4, 4]}>
                  {scoreData.map((bucket) => (
                    <Cell key={bucket.label} fill={getScoreBucketFill(bucket.min)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      <div className="admin-charts-row">
        <ChartCard title="Most Common Weaknesses" subtitle="From AI feedback across recent sessions">
          {weaknessData.length === 0 ? (
            <EmptyState compact title="No weakness themes yet" description="Improvement themes appear from completed interview feedback." />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart layout="vertical" data={weaknessData} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid stroke={adminChartGridStroke} strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={adminChartAxisTick} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="label" width={150} tick={adminChartAxisTick} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value, _name, item) => [value, item?.payload?.fullLabel || 'Count']} contentStyle={adminChartTooltipStyle} />
                <Bar dataKey="count" name="Mentions" fill={ADMIN_CHART.primary} radius={[0, 8, 8, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {isSuperAdmin ? (
        <section className="admin-card admin-chart-card">
          <div className="admin-chart-card-head">
            <h3>Top Institutions by readiness</h3>
            <p>Derived from institution analytics · plan tiers pending backend</p>
          </div>
          {topInstitutions.length === 0 ? (
            <EmptyState compact title="No institutions yet" description="Institutions appear when users set an institution on their profile." />
          ) : (
            <ol className="admin-rank-list">
              {topInstitutions.map((inst, index) => (
                <li key={inst.id}>
                  <div className="admin-rank-meta">
                    <span className="admin-rank-index">{index + 1}</span>
                    <div>
                      <strong>{inst.name}</strong>
                      <em>{inst.studentCount} students · {inst.interviewCount} interviews</em>
                    </div>
                    <span className="admin-rank-pct">{inst.placementReadinessPct}%</span>
                  </div>
                  <div className="admin-rank-track" aria-hidden="true">
                    <div className="admin-rank-fill" style={{ width: `${inst.placementReadinessPct}%` }} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
        ) : null}
      </div>

      {isSuperAdmin && comparison.length > 0 ? (
        <section className="admin-card admin-table-card">
          <div className="admin-table-card-head">
            <div>
              <h3>Institution comparison</h3>
              <p>Students, interviews, completion rate, and average scores by campus</p>
            </div>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Institution</th>
                  <th>Students</th>
                  <th>Interviews</th>
                  <th>Completed</th>
                  <th>Avg score</th>
                  <th>Readiness</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((row) => (
                  <tr key={row.institutionId}>
                    <td><strong>{row.institutionName}</strong></td>
                    <td>{row.totals?.students ?? '—'}</td>
                    <td>{row.totals?.interviews ?? '—'}</td>
                    <td>{row.totals?.completedInterviews ?? '—'}</td>
                    <td>{row.scores?.average ?? '—'}</td>
                    <td>{row.scores?.readinessScore ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="admin-card admin-table-card">
        <div className="admin-table-card-head">
          <div>
            <h3>Recent Interviews</h3>
            <p>{isSuperAdmin ? 'Latest 8 sessions across the platform' : 'Latest 8 sessions in your college(s)'}</p>
          </div>
          <Link to="/admin/interviews" className="admin-text-link">View all</Link>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Company</th>
                <th>Type</th>
                <th>Score</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {recentInterviews.length === 0 ? (
                <tr>
                  <td colSpan={6} className="admin-dt-empty">No interviews yet.</td>
                </tr>
              ) : recentInterviews.map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.studentName}</strong></td>
                  <td>{row.targetCompany}</td>
                  <td>{row.type}</td>
                  <td>
                    <span className={`admin-score-badge admin-score-badge--${getScoreTone(row.score)}`}>
                      {row.score}
                    </span>
                  </td>
                  <td>
                    <span className={`admin-status-badge admin-status-badge--${row.status}`}>
                      {statusLabel(row.status)}
                    </span>
                  </td>
                  <td className="admin-table-muted">{row.date ? formatDate(row.date) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default AdminDashboard;
