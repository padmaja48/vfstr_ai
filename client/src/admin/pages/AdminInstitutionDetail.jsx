import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  FileUp,
  GraduationCap,
  Mic2,
  Pencil,
  Target,
  Trash2,
  Users,
} from 'lucide-react';
import {
  Bar,
  BarChart,
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
import { EmptyState } from '../components/shared/EmptyState';
import { PageSkeleton } from '../components/shared/PageSkeleton';
import { AdminQueryError } from '../components/shared/PendingBackendState';
import { AdminDialog } from '../components/shared/AdminDialog';
import { InstitutionArchiveDialog } from '../components/shared/InstitutionArchiveDialog';
import { ImportResultsPanel } from '../components/shared/ImportResultsPanel';
import { DownloadReportButton } from '../components/shared/DownloadReportButton';
import { institutionInitials } from '@/admin/lib/institutionCatalog';
import { useAdminInstitutionsDerived } from '../hooks';
import { useReportDownload } from '../hooks/useReportDownload';
import { buildWeeklyActivity } from '@/admin/lib/aggregates';
import { buildInstitutionReport } from '@/admin/lib/institutionReport';
import { downloadInstitutionPdf } from '@/admin/lib/reportPdf';
import { adminInstitutionsService } from '../services/adminApi';
import { useToast } from '../../context/ToastContext';
import { getScoreTone } from '@/admin/lib/getScoreColor';
import { readLastImport, saveLastImport, buildStudentImportPayload } from '../lib/parseImportFile';
import {
  ADMIN_CHART,
  adminChartAxisTick,
  adminChartGridStroke,
  adminChartTooltipStyle,
} from '@/admin/lib/adminCharts';

const readinessClass = (level) => {
  if (level === 'Ready') return 'ready';
  if (level === 'Intermediate') return 'intermediate';
  return 'beginner';
};

const avg = (nums) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0);

const parseCsv = (text) => {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(',').map((c) => c.trim());
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = cells[i] ?? '';
    });
    return obj;
  });
  return { headers, rows };
};

export const AdminInstitutionDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const decodedId = decodeURIComponent(id || '');
  const toast = useToast();
  const { institutions, students, interviews, loading, error, refetch } = useAdminInstitutionsDerived();
  const { generating, runReport } = useReportDownload();
  const [importOpen, setImportOpen] = useState(false);
  const [importStep, setImportStep] = useState('form');
  const [importPreview, setImportPreview] = useState({ headers: [], rows: [] });
  const [importResult, setImportResult] = useState(() => readLastImport());
  const [importing, setImporting] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', contactEmail: '' });
  const [savingEdit, setSavingEdit] = useState(false);

  const institution = useMemo(
    () => institutions.find((row) =>
      row.id === decodedId
      || row.id === id
      || row.catalogId === decodedId
      || row.catalogId === id
      || row.name === decodedId) || null,
    [institutions, decodedId, id],
  );

  const catalogId = institution?.catalogId || (institution?.fromCatalog ? institution.id : null);

  const scopedStudents = useMemo(() => {
    if (!institution) return [];
    return students.filter((s) => (s.institution || 'Unassigned') === institution.name);
  }, [students, institution]);

  const scopedInterviews = useMemo(() => {
    if (!institution) return [];
    return interviews.filter((iv) => {
      const name = iv.institution || students.find((s) => s.id === iv.studentId)?.institution || 'Unassigned';
      return name === institution.name;
    });
  }, [interviews, students, institution]);

  const downloadReport = () => runReport(() => {
    if (!institution) {
      const err = new Error('Institution not found.');
      err.code = 'REPORT_MISSING_DATA';
      throw err;
    }
    if (!scopedStudents.length && !scopedInterviews.length) {
      const err = new Error(`No students or interviews found for ${institution.name}.`);
      err.code = 'REPORT_MISSING_DATA';
      throw err;
    }
    const report = buildInstitutionReport(institution, scopedStudents, scopedInterviews);
    downloadInstitutionPdf(report);
  }, { successMessage: `Report for ${institution?.name || 'institution'} downloaded.` });

  const submitImport = async () => {
    if (!catalogId) {
      toast.error('Save this campus with “Add institution” before importing students.');
      return;
    }
    const studentsPayload = importPreview.rows.map((row) => buildStudentImportPayload(row));

    if (!studentsPayload.length) {
      toast.error('CSV needs name and email columns with at least one data row.');
      return;
    }

    setImporting(true);
    try {
      const result = await adminInstitutionsService.bulkImportStudents(catalogId, studentsPayload);
       toast.success(
         `Imported ${result.createdCount} student${result.createdCount === 1 ? '' : 's'}`
         + (result.skippedCount ? ` · ${result.skippedCount} skipped` : '')
         + (result.failedCount ? ` · ${result.failedCount} failed` : '')
         + (result.emailFailureCount ? ` · ${result.emailFailureCount} email${result.emailFailureCount === 1 ? '' : 's'} not sent` : '')
         + ' · password = <username>@PV2913',
        { className: 'app-toast--teal', duration: 8000 },
      );
      setImportResult(result);
      saveLastImport(result);
      setImportStep('form');
      await refetch();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Bulk import failed.');
    } finally {
      setImporting(false);
    }
  };

  const onCsvFile = async (file) => {
    if (!file) return;
    const text = await file.text();
    setImportPreview(parseCsv(text));
  };

  const openEdit = () => {
    if (!catalogId) return;
    setEditForm({
      name: institution?.name || '',
      contactEmail: institution?.contactEmail || '',
    });
    setEditOpen(true);
  };

  const submitEdit = async () => {
    if (!catalogId || !editForm.name.trim()) {
      toast.error('Institution name is required.');
      return;
    }
    setSavingEdit(true);
    try {
      await adminInstitutionsService.update(catalogId, {
        name: editForm.name.trim(),
        contactEmail: editForm.contactEmail.trim(),
      });
      toast.success('Institution updated.', { className: 'app-toast--teal' });
      setEditOpen(false);
      await refetch();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Could not update institution.');
    } finally {
      setSavingEdit(false);
    }
  };

  const cohortBars = useMemo(() => {
    const byYear = new Map();
    scopedStudents.forEach((s) => {
      const key = String(s.batchYear || 'Unknown');
      if (!byYear.has(key)) byYear.set(key, []);
      byYear.get(key).push(s.averageScore);
    });
    return [...byYear.entries()]
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .map(([cohort, scores]) => ({
        cohort,
        avgScore: Math.round(avg(scores) * 10) / 10,
        students: scores.length,
      }));
  }, [scopedStudents]);

  const readinessTrend = useMemo(
    () => buildWeeklyActivity(scopedInterviews, 6).map((w) => ({
      label: w.weekLabel,
      interviews: w.interviewCount,
      completed: w.completedCount,
    })),
    [scopedInterviews],
  );

  if (loading) return <PageSkeleton variant="cards" />;
  if (error) {
    return (
      <div className="admin-page">
        <AdminQueryError error={error} onRetry={refetch} />
      </div>
    );
  }

  if (!institution) {
    return (
      <div className="admin-page">
        <EmptyState
          title="Institution not found"
          description="No derived institution matches this id."
          action={(
            <Link to="/admin/institutions" className="admin-btn admin-btn--primary">
              Back to institutions
            </Link>
          )}
        />
      </div>
    );
  }

  return (
    <div className="admin-page admin-institution-detail">
      <div className="admin-detail-top">
        <Link to="/admin/institutions" className="admin-text-link admin-back-link">
          <ArrowLeft size={16} />
          Back
        </Link>
      </div>

      <PageHeader
        title={(
          <span className="admin-inst-title">
            <span className="admin-inst-avatar">{institutionInitials(institution.name)}</span>
            {institution.name}
          </span>
        )}
        description={institution.contactEmail || 'No contact email'}
        actions={(
          <>
            {catalogId ? (
              <button type="button" className="admin-btn admin-btn--ghost" onClick={openEdit}>
                <Pencil size={15} />
                Edit institution
              </button>
            ) : null}
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              disabled={!catalogId}
              title={catalogId ? undefined : 'Only catalog institutions support bulk import'}
              onClick={() => {
                setImportPreview({ headers: [], rows: [] });
                setImportOpen(true);
              }}
            >
              <FileUp size={15} />
              Import students
            </button>
            <DownloadReportButton
              label="Download Report"
              loadingLabel="Generating PDF…"
              loading={generating}
              onClick={downloadReport}
            />
            {catalogId ? (
              <button
                type="button"
                className="admin-btn admin-btn--danger"
                onClick={() => setArchiveTarget({ catalogId, id: catalogId, name: institution.name })}
              >
                <Trash2 size={15} />
                Archive institution
              </button>
            ) : null}
          </>
        )}
      />

      {!catalogId ? (
        <EmptyState
          compact
          title="Derived campus only"
          description="This name came from student profiles. Use Add institution on the list page (same name) to enable bulk import and contact/plan fields."
        />
      ) : null}
      <div className="admin-stat-row admin-stat-row--4">
        <StatCard title="Students" icon={Users} value={institution.studentCount} />
        <StatCard title="Interviews" icon={Mic2} value={scopedInterviews.length} />
        <StatCard title="Avg score" icon={Target} value={institution.averageScore} />
        <StatCard title="Readiness" icon={GraduationCap} value={`${institution.placementReadinessPct}%`} />
      </div>

      <div className="admin-charts-row">
        <section className="admin-card admin-chart-card">
          <div className="admin-chart-card-head">
            <h3>Join-year cohorts</h3>
            <p>Average score by profile join year</p>
          </div>
          {cohortBars.length === 0 ? (
            <EmptyState compact title="No cohort data" description="Students linked to this institution will appear here." />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={cohortBars}>
                <CartesianGrid stroke={adminChartGridStroke} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="cohort" tick={adminChartAxisTick} />
                <YAxis tick={adminChartAxisTick} />
                <Tooltip contentStyle={adminChartTooltipStyle} />
                <Bar dataKey="avgScore" name="Avg score" fill={ADMIN_CHART.primary} radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </section>

        <section className="admin-card admin-chart-card">
          <div className="admin-chart-card-head">
            <h3>Interview volume</h3>
            <p>Recent weekly activity for this institution</p>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={readinessTrend}>
              <CartesianGrid stroke={adminChartGridStroke} strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={adminChartAxisTick} />
              <YAxis tick={adminChartAxisTick} />
              <Tooltip contentStyle={adminChartTooltipStyle} />
              <Line type="monotone" dataKey="interviews" name="Interviews" stroke={ADMIN_CHART.primary} strokeWidth={2.5} />
              <Line type="monotone" dataKey="completed" name="Completed" stroke={ADMIN_CHART.secondary} strokeWidth={2} strokeDasharray="5 4" />
            </LineChart>
          </ResponsiveContainer>
        </section>
      </div>

      <section className="admin-card admin-table-card">
        <div className="admin-table-card-head">
          <div>
            <h3>Students</h3>
            <span className="admin-muted">{scopedStudents.length} enrolled</span>
          </div>
        </div>
        <DataTable
          columns={[
            { id: 'name', header: 'Name', sortable: true },
            { id: 'email', header: 'Email', sortable: true },
            {
              id: 'readinessLevel',
              header: 'Readiness',
              sortable: true,
              cell: (row) => (
                <span className={`admin-pill admin-pill--${readinessClass(row.readinessLevel)}`}>
                  {row.readinessLevel}
                </span>
              ),
            },
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
          rows={scopedStudents}
          emptyMessage="No students linked to this institution."
        />
      </section>

      <AdminDialog
        open={importOpen}
        title={`Import students · ${institution.name}`}
         description="CSV columns: name, email, rollNumber (optional — used as username when present). Password = &lt;username&gt;@PV2913."
        onClose={() => {
          setImportOpen(false);
          setImportStep('form');
        }}
        wide
        footer={importStep === 'confirm' ? (
          <>
            <button type="button" className="admin-btn admin-btn--ghost" onClick={() => setImportStep('form')} disabled={importing}>
              Back
            </button>
            <button type="button" className="admin-btn admin-btn--primary" disabled={importing} onClick={submitImport}>
              {importing ? 'Importing…' : 'Confirm import'}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="admin-btn admin-btn--ghost" onClick={() => { setImportOpen(false); setImportStep('form'); }}>
              Close
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--primary"
              disabled={importing || importPreview.rows.length === 0}
              onClick={() => setImportStep('confirm')}
            >
              Review import ({importPreview.rows.length || 0})
            </button>
          </>
        )}
      >
        {importStep === 'confirm' ? (
          <div className="admin-import-confirm">
            <p className="admin-import-warning" role="alert">
              You&apos;re about to import <strong>{importPreview.rows.length}</strong> student
              {importPreview.rows.length === 1 ? '' : 's'} into <strong>{institution.name}</strong>.
            </p>
          </div>
        ) : (
          <>
        <label className="admin-dropzone">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => onCsvFile(e.target.files?.[0])}
          />
          <strong>Drag & drop CSV</strong>
           <span>name, email — generated username and password: &lt;username&gt;@PV2913</span>
        </label>
        {importPreview.rows.length > 0 && (
          <div className="admin-import-preview">
            <p>Preview ({Math.min(importPreview.rows.length, 8)} of {importPreview.rows.length})</p>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>{importPreview.headers.map((h) => <th key={h}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {importPreview.rows.slice(0, 8).map((row, idx) => (
                    <tr key={idx}>
                      {importPreview.headers.map((h) => <td key={h}>{row[h]}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <ImportResultsPanel result={importResult} filename="VFSTR_AI_institution_credentials.csv" />
          </>
        )}
      </AdminDialog>

      <AdminDialog
        open={editOpen}
        title="Edit institution"
        description="Update the campus name or contact email."
        onClose={() => setEditOpen(false)}
        footer={(
          <>
            <button type="button" className="admin-btn admin-btn--ghost" onClick={() => setEditOpen(false)}>Cancel</button>
            <button type="button" className="admin-btn admin-btn--primary" disabled={savingEdit} onClick={submitEdit}>
              {savingEdit ? 'Saving…' : 'Save changes'}
            </button>
          </>
        )}
      >
        <div className="admin-form-grid">
          <label>
            <span>Name</span>
            <input
              type="text"
              value={editForm.name}
              onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))}
            />
          </label>
          <label>
            <span>Contact email</span>
            <input
              type="email"
              value={editForm.contactEmail}
              onChange={(e) => setEditForm((p) => ({ ...p, contactEmail: e.target.value }))}
            />
          </label>
        </div>
      </AdminDialog>

      <InstitutionArchiveDialog
        target={archiveTarget}
        onClose={() => setArchiveTarget(null)}
        onArchived={async () => {
          await refetch();
          navigate('/admin/institutions');
        }}
      />
    </div>
  );
};

export default AdminInstitutionDetail;
