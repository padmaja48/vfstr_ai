import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  ChevronDown,
  Download,
  Mic2,
  Search,
  TrendingDown,
  TrendingUp,
  Minus,
  Users,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PageHeader } from '../components/shared/PageHeader';
import { StatCard } from '../components/shared/StatCard';
import { DataTable } from '../components/shared/DataTable';
import { SkillRadarChart, toSkillRadarData } from '../components/shared/SkillRadarChart';
import { FluentReadinessGauge } from '../components/shared/FluentReadinessGauge';
import { PageSkeleton } from '../components/shared/PageSkeleton';
import { EmptyState } from '../components/shared/EmptyState';
import { AdminQueryError } from '../components/shared/PendingBackendState';
import { DownloadReportButton } from '../components/shared/DownloadReportButton';
import {
  useAdminAnalytics,
  useAdminInstitutionsDerived,
  useAdminInterviews,
  useAdminUsers,
} from '../hooks';
import { adminAnalyticsService } from '../services/adminApi';
import { useReportDownload } from '../hooks/useReportDownload';
import { buildCompanyPerformance, buildStudentScoreTrend } from '@/admin/lib/aggregates';
import { buildStudentReport } from '@/admin/lib/institutionReport';
import { downloadStudentPdf } from '@/admin/lib/reportPdf';
import { institutionInitials } from '@/admin/lib/institutionCatalog';
import { skillsFromScores } from '@/admin/lib/mappers';
import { getScoreColor, getScoreTone } from '@/admin/lib/getScoreColor';
import { isSuperAdmin, isInstitutionAdmin, getAssignedInstitutions } from '@/admin/lib/adminAuth';
import { InstitutionScopeFilter } from '../components/shared/InstitutionScope';
import {
  buildCombinedComparison,
  buildInstitutionReport,
} from '@/admin/lib/institutionReport';
import { downloadCombinedInstitutionsPdf } from '@/admin/lib/reportPdf';
import { AuthContext } from '@/context/AuthContext';
import {
  ADMIN_CHART,
  adminChartAxisTick,
  adminChartGridStroke,
  adminChartTooltipStyle,
} from '@/admin/lib/adminCharts';

const TABS = [
  { id: 'student', label: 'Student-wise' },
  { id: 'company', label: 'Company-wise' },
  { id: 'institution', label: 'Institution-wise' },
];

const downloadText = (filename, text) => {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const TrendIcon = ({ delta }) => {
  if (delta > 0) return <TrendingUp size={14} />;
  if (delta < 0) return <TrendingDown size={14} />;
  return <Minus size={14} />;
};

export const AdminPerformance = () => {
  const { user: authUser } = useContext(AuthContext);
  const superAdmin = isSuperAdmin(authUser);
  const collegeAdmin = isInstitutionAdmin(authUser);
  const assignedInstitutions = useMemo(() => getAssignedInstitutions(authUser), [authUser]);
  const [collegeScope, setCollegeScope] = useState('all');
  const [tab, setTab] = useState('student');
  const [studentQuery, setStudentQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [expandedInst, setExpandedInst] = useState(null);
  const [instAnalyticsMap, setInstAnalyticsMap] = useState({});
  const [instAnalyticsLoading, setInstAnalyticsLoading] = useState(null);

  const usersQ = useAdminUsers();
  const interviewsQ = useAdminInterviews();
  const institutionsQ = useAdminInstitutionsDerived();
  const summaryAnalyticsQ = useAdminAnalytics();
  const { generating, runReport } = useReportDownload();

  const students = usersQ.students;
  const interviews = interviewsQ.interviews;
  const institutions = institutionsQ.institutions;
  const summaryMetrics = summaryAnalyticsQ.metrics;

  const [selectedStudentId, setSelectedStudentId] = useState('');

  const effectiveStudentId = selectedStudentId || students[0]?.id || '';

  const selectedStudent = useMemo(
    () => students.find((s) => s.id === effectiveStudentId) || null,
    [students, effectiveStudentId],
  );

  const studentOptions = useMemo(() => {
    const q = studentQuery.trim().toLowerCase();
    return students
      .filter((s) => !q || s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q))
      .slice(0, 12);
  }, [students, studentQuery]);

  const studentInterviews = useMemo(
    () => interviews.filter((i) => i.studentId === effectiveStudentId),
    [interviews, effectiveStudentId],
  );

  const radarData = useMemo(() => {
    const latest = studentInterviews.find((i) => i.scores && (i.scores.technical != null || i.scores.communication != null));
    const breakdown = skillsFromScores(latest?.scores || {}, selectedStudent?.averageScore);
    return toSkillRadarData(breakdown, selectedStudent?.averageScore);
  }, [studentInterviews, selectedStudent]);

  const readiness = Math.round(
    skillsFromScores(
      studentInterviews[0]?.scores || {},
      selectedStudent?.averageScore || 0,
    ).overall,
  );

  const trend = useMemo(
    () => buildStudentScoreTrend(interviews, effectiveStudentId),
    [interviews, effectiveStudentId],
  );

  const companyRows = useMemo(() => buildCompanyPerformance(interviews), [interviews]);

  const institutionRows = useMemo(() => institutions.map((inst) => {
    const analytics = instAnalyticsMap[inst.id];
    const scoped = students.filter((s) => (s.institution || 'Unassigned') === inst.name);
    return {
      ...inst,
      students: scoped,
      analytics,
      studentCount: analytics?.totals?.students ?? inst.studentCount,
      interviewCount: analytics?.totals?.interviews ?? inst.interviewCount,
      placementReadinessPct: analytics?.scores?.readinessScore ?? inst.placementReadinessPct,
      avgScore: analytics?.scores?.average ?? 0,
    };
  }), [institutions, students, instAnalyticsMap]);

  const visibleInstitutionRows = useMemo(() => {
    if (!collegeAdmin || collegeScope === 'all') return institutionRows;
    return institutionRows.filter((row) => String(row.id) === collegeScope);
  }, [institutionRows, collegeAdmin, collegeScope]);

  const loadInstitutionAnalytics = useCallback(async (inst) => {
    if (!inst?.id || instAnalyticsMap[inst.id]) return;
    setInstAnalyticsLoading(inst.id);
    try {
      const params = inst.id && inst.id !== inst.name
        ? { institutionId: inst.id }
        : { institution: inst.name };
      const data = await adminAnalyticsService.institutionAnalytics(params);
      setInstAnalyticsMap((prev) => ({ ...prev, [inst.id]: data }));
    } catch {
      // Row expand still shows student list; analytics panel stays empty on failure.
    } finally {
      setInstAnalyticsLoading(null);
    }
  }, [instAnalyticsMap]);

  useEffect(() => {
    if (tab !== 'institution') return;
    if (!superAdmin && institutions.length === 1) {
      loadInstitutionAnalytics(institutions[0]);
      return;
    }
    if (expandedInst) {
      const inst = institutions.find((i) => i.id === expandedInst);
      if (inst) loadInstitutionAnalytics(inst);
    }
  }, [tab, expandedInst, institutions, superAdmin, loadInstitutionAnalytics]);

  const loading = usersQ.loading || interviewsQ.loading || summaryAnalyticsQ.loading;
  const error = usersQ.error || interviewsQ.error || summaryAnalyticsQ.error;

  const exportCsv = () => {
    if (tab === 'company') {
      const lines = ['company,interviewCount,averageScore,topType', ...companyRows.map((r) =>
        `"${r.company}",${r.interviewCount},${r.averageScore},${r.topType}`)];
      downloadText('company-performance.csv', lines.join('\n'));
      return;
    }
    if (tab === 'institution') {
      const lines = ['institution,students,interviews,readiness,avgScore', ...institutionRows.map((r) =>
        `"${r.name}",${r.studentCount},${r.interviewCount},${r.placementReadinessPct},${r.avgScore}`)];
      downloadText('institution-performance.csv', lines.join('\n'));
      return;
    }
    const lines = ['name,email,institution,averageScore,interviews', ...students.map((s) =>
      `"${s.name}","${s.email}","${s.institution || ''}",${s.averageScore},${s.totalInterviews}`)];
    downloadText('student-performance.csv', lines.join('\n'));
  };

  const downloadStudentReport = () => runReport(() => {
    if (!selectedStudent) {
      const err = new Error('Select a student before downloading a report.');
      err.code = 'REPORT_MISSING_DATA';
      throw err;
    }
    const report = buildStudentReport(selectedStudent, interviews);
    if (!report.summary.totalInterviews && !(Number(selectedStudent.averageScore) > 0)) {
      const err = new Error(`${selectedStudent.name} has no interview or score data to report yet.`);
      err.code = 'REPORT_MISSING_DATA';
      throw err;
    }
    downloadStudentPdf(report);
  }, { successMessage: `Performance report for ${selectedStudent?.name || 'student'} downloaded.` });

  const downloadCombinedAssigned = () => runReport(() => {
    const scopedInstitutions = collegeScope === 'all'
      ? institutionRows
      : institutionRows.filter((row) => String(row.id) === collegeScope);
    if (!scopedInstitutions.length) {
      const err = new Error('No assigned colleges available for a combined report.');
      err.code = 'REPORT_MISSING_DATA';
      throw err;
    }
    const reports = scopedInstitutions.map((inst) => {
      const scopedStudents = students.filter((s) => (s.institution || 'Unassigned') === inst.name);
      const scopedInterviews = interviews.filter((iv) => {
        const name = iv.institution
          || students.find((s) => s.id === iv.studentId)?.institution
          || 'Unassigned';
        return name === inst.name;
      });
      return buildInstitutionReport(inst, scopedStudents, scopedInterviews);
    });
    downloadCombinedInstitutionsPdf(reports, buildCombinedComparison(reports));
  }, { successMessage: 'Combined colleges report downloaded.' });

  if (loading) return <PageSkeleton variant="cards" />;
  if (error) {
    return (
      <div className="admin-page">
        <PageHeader title="Performance" description="VFSTR.AI breakdowns across students, companies, and institutions." />
        <AdminQueryError
          error={error}
          onRetry={() => {
            usersQ.refetch();
            interviewsQ.refetch();
            summaryAnalyticsQ.refetch();
          }}
        />
      </div>
    );
  }

  return (
    <div className="admin-page admin-performance-page">
      <PageHeader
        title="Performance"
        description="Summary metrics from admin analytics APIs; student and company views use live interview data."
        actions={(
          <>
            {tab === 'student' ? (
              <DownloadReportButton
                label="Download Report"
                loadingLabel="Generating PDF…"
                loading={generating}
                disabled={!selectedStudent}
                onClick={downloadStudentReport}
              />
            ) : null}
            {tab === 'institution' && collegeAdmin && institutionRows.length > 0 ? (
              <DownloadReportButton
                label="Combined colleges PDF"
                loadingLabel="Generating PDF…"
                loading={generating}
                onClick={downloadCombinedAssigned}
              />
            ) : null}
            <button type="button" className="admin-btn admin-btn--ghost" onClick={exportCsv}>
              <Download size={15} />
              Export CSV
            </button>
          </>
        )}
      />

      {collegeAdmin && assignedInstitutions.length > 1 ? (
        <div className="admin-card admin-filter-bar" style={{ marginBottom: '1rem' }}>
          <InstitutionScopeFilter
            institutions={assignedInstitutions}
            value={collegeScope}
            onChange={setCollegeScope}
          />
        </div>
      ) : null}

      <div className="admin-stat-row admin-stat-row--6">
        <StatCard title="Students" icon={Users} value={summaryMetrics.totalStudents} />
        <StatCard title="Interviews" icon={Mic2} value={summaryMetrics.totalInterviews} />
        <StatCard title="Completed" icon={Mic2} value={summaryMetrics.completedInterviews} />
        <StatCard title="Readiness" icon={Building2} value={`${summaryMetrics.readiness}%`} />
        <StatCard title="Avg Score" icon={TrendingUp} value={summaryMetrics.averageScore} />
        <StatCard title="Tech / Comm" icon={TrendingUp} value={`${summaryMetrics.technicalAverage} / ${summaryMetrics.communicationAverage}`} />
      </div>

      <div className="admin-tabs" role="tablist" aria-label="Performance views">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`admin-tab${tab === item.id ? ' is-active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'student' && (
        <div className="admin-perf-student">
          <div className="admin-card admin-perf-picker-card">
            <div className="admin-perf-picker-row">
              <label className="admin-perf-picker-label">
                <span>Student</span>
                <button
                  type="button"
                  className="admin-picker-btn"
                  aria-expanded={pickerOpen}
                  onClick={() => setPickerOpen((v) => !v)}
                >
                  <span className="admin-picker-btn-copy">
                    <strong>{selectedStudent?.name || 'Select student'}</strong>
                    {selectedStudent?.email ? <em>{selectedStudent.email}</em> : null}
                  </span>
                  <ChevronDown size={16} className={pickerOpen ? 'is-open' : ''} />
                </button>
              </label>
              {selectedStudent ? (
                <div className="admin-perf-picker-stats">
                  <span>
                    Avg
                    {' '}
                    <strong style={{ color: getScoreColor(selectedStudent.averageScore) }}>
                      {Number(selectedStudent.averageScore).toFixed(1)}
                    </strong>
                  </span>
                  <span>{selectedStudent.totalInterviews} interviews</span>
                  <span>{selectedStudent.institution || 'No institution'}</span>
                </div>
              ) : null}
            </div>
            {pickerOpen && (
              <div className="admin-picker-menu" role="listbox">
                <div className="admin-search admin-picker-search">
                  <Search size={14} />
                  <input
                    value={studentQuery}
                    onChange={(e) => setStudentQuery(e.target.value)}
                    placeholder="Search students…"
                    autoFocus
                  />
                </div>
                {studentOptions.length === 0 ? (
                  <EmptyState compact title="No students" description="Register users to see performance." />
                ) : studentOptions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="option"
                    aria-selected={s.id === effectiveStudentId}
                    className={`admin-picker-item${s.id === effectiveStudentId ? ' is-active' : ''}`}
                    onClick={() => {
                      setSelectedStudentId(s.id);
                      setPickerOpen(false);
                    }}
                  >
                    <strong>{s.name}</strong>
                    <span>{s.email}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {!selectedStudent ? (
            <EmptyState title="No students yet" description="Performance views need at least one registered user." />
          ) : (
            <div className="admin-perf-grid">
              <section className="admin-card admin-perf-panel">
                <div className="admin-chart-card-head">
                  <h3>Skill radar</h3>
                  <p>From latest scored interview breakdown</p>
                </div>
                <SkillRadarChart data={radarData} height={280} />
              </section>
              <section className="admin-card admin-perf-panel admin-perf-gauge">
                <div className="admin-chart-card-head">
                  <h3>Interview readiness</h3>
                  <p>Overall readiness signal</p>
                </div>
                <FluentReadinessGauge score={readiness} size={200} />
                <p className="admin-muted admin-perf-gauge-meta">
                  Avg score {Number(selectedStudent.averageScore).toFixed(1)}
                  {' · '}
                  {selectedStudent.totalInterviews} sessions
                </p>
              </section>
              <section className="admin-card admin-perf-panel admin-perf-span">
                <div className="admin-chart-card-head">
                  <h3>Score trend</h3>
                  <p>Completed interview scores over time</p>
                </div>
                {trend.length === 0 ? (
                  <EmptyState compact title="No completed interviews" description="Trend appears after scored sessions." />
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={trend}>
                      <CartesianGrid stroke={adminChartGridStroke} strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={adminChartAxisTick} />
                      <YAxis domain={[0, 100]} tick={adminChartAxisTick} />
                      <Tooltip contentStyle={adminChartTooltipStyle} />
                      <Line type="monotone" dataKey="score" stroke={ADMIN_CHART.primary} strokeWidth={2.5} dot />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </section>
            </div>
          )}
        </div>
      )}

      {tab === 'company' && (
        <div className="admin-card admin-table-card">
          <DataTable
            columns={[
              { id: 'company', header: 'Company', sortable: true },
              { id: 'interviewCount', header: 'Interviews', sortable: true },
              {
                id: 'averageScore',
                header: 'Avg score',
                sortable: true,
                cell: (row) => (
                  <span className={`admin-score-badge admin-score-badge--${getScoreTone(row.averageScore)}`}>
                    {row.averageScore}
                  </span>
                ),
              },
              { id: 'topType', header: 'Top type', sortable: true },
            ]}
            rows={companyRows}
            emptyMessage="No company interview data yet."
          />
        </div>
      )}

      {tab === 'institution' && (
        <div className="admin-inst-perf-list">
          {visibleInstitutionRows.length === 0 ? (
            <EmptyState
              title="No institution data"
              description="Add campuses on Institutions, or wait for users to set an institution on their profile."
            />
          ) : visibleInstitutionRows.map((inst) => {
            const open = expandedInst === inst.id;
            const readinessPct = Number(inst.placementReadinessPct) || 0;
            const delta = Math.round(readinessPct - 50);
            const tone = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
            const analytics = inst.analytics;
            return (
              <section
                key={inst.id}
                className={`admin-card admin-inst-perf-card${open ? ' is-open' : ''}`}
              >
                <button
                  type="button"
                  className="admin-inst-perf-head"
                  aria-expanded={open}
                  onClick={() => setExpandedInst(open ? null : inst.id)}
                >
                  <span className="admin-inst-perf-avatar" aria-hidden="true">
                    {institutionInitials(inst.name)}
                  </span>
                  <div className="admin-inst-perf-identity">
                    <strong className="admin-inst-perf-name">{inst.name}</strong>
                    <div className="admin-inst-perf-stats">
                      <span><Users size={13} /> {inst.studentCount} students</span>
                      <span><Mic2 size={13} /> {inst.interviewCount} interviews</span>
                    </div>
                  </div>
                  <div className="admin-inst-perf-meta">
                    <div className="admin-inst-perf-readiness">
                      <em>Readiness</em>
                      <strong style={{ color: getScoreColor(readinessPct) }}>
                        {readinessPct}%
                      </strong>
                      <div className="admin-rank-track admin-inst-perf-track" aria-hidden="true">
                        <div
                          className="admin-rank-fill"
                          style={{ width: `${Math.min(100, Math.max(0, readinessPct))}%` }}
                        />
                      </div>
                    </div>
                    <span className={`admin-trend admin-trend--${tone}`}>
                      <TrendIcon delta={delta} />
                      {delta > 0 ? '+' : ''}{delta} vs baseline
                    </span>
                    <ChevronDown
                      size={18}
                      className={`admin-expand-chevron${open ? ' is-open' : ''}`}
                    />
                  </div>
                </button>
                {open && (
                  <div className="admin-inst-perf-body">
                    {instAnalyticsLoading === inst.id ? (
                      <p className="admin-muted">Loading analytics…</p>
                    ) : analytics ? (
                      <div className="admin-inst-perf-analytics">
                        <p className="admin-muted">
                          Highest {analytics.scores.highest} · Lowest {analytics.scores.lowest} · Avg {analytics.scores.average}
                          {' · '}
                          Scheduled {analytics.totals.scheduledInterviews} · Cancelled {analytics.totals.cancelledInterviews} · Terminated {analytics.totals.terminatedInterviews}
                        </p>
                      </div>
                    ) : null}
                    <DataTable
                      columns={[
                        { id: 'name', header: 'Student', sortable: true },
                        {
                          id: 'averageScore',
                          header: 'Avg',
                          sortable: true,
                          cell: (row) => (
                            <span className={`admin-score-badge admin-score-badge--${getScoreTone(row.averageScore)}`}>
                              {Number(row.averageScore).toFixed(1)}
                            </span>
                          ),
                        },
                        { id: 'totalInterviews', header: 'Interviews', sortable: true },
                      ]}
                      rows={inst.students}
                      emptyMessage="No students linked to this institution."
                    />
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AdminPerformance;
