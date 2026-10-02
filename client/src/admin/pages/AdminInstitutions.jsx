import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileUp, Mic2, Plus, Search, Trash2, Users } from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';
import { EmptyState } from '../components/shared/EmptyState';
import { PageSkeleton } from '../components/shared/PageSkeleton';
import { AdminQueryError } from '../components/shared/PendingBackendState';
import { AdminDialog } from '../components/shared/AdminDialog';
import { InstitutionArchiveDialog } from '../components/shared/InstitutionArchiveDialog';
import { ImportResultsPanel } from '../components/shared/ImportResultsPanel';
import { DownloadReportButton } from '../components/shared/DownloadReportButton';
import { useAdminInstitutionsDerived } from '../hooks';
import { useReportDownload } from '../hooks/useReportDownload';
import { institutionInitials } from '@/admin/lib/institutionCatalog';
import { getScoreTone } from '@/admin/lib/getScoreColor';
import {
  buildCombinedComparison,
  buildInstitutionReport,
} from '@/admin/lib/institutionReport';
import { downloadCombinedInstitutionsPdf } from '@/admin/lib/reportPdf';
import { adminInstitutionsService } from '../services/adminApi';
import { useToast } from '../../context/ToastContext';
import { readLastImport, saveLastImport, buildStudentImportPayload } from '../lib/parseImportFile';

const emptyForm = {
  name: '',
  contactEmail: '',
};

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

export const AdminInstitutions = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const { institutions, catalog, students, interviews, loading, error, refetch } = useAdminInstitutionsDerived();
  const { generating, runReport } = useReportDownload();
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importInstitutionId, setImportInstitutionId] = useState('');
  const [importStep, setImportStep] = useState('form');
  const [importPreview, setImportPreview] = useState({ headers: [], rows: [] });
  const [importResult, setImportResult] = useState(() => readLastImport());
  const [importing, setImporting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const catalogOptions = useMemo(
    () => (catalog.length
      ? catalog
      : institutions.filter((i) => i.catalogId || i.fromCatalog).map((i) => ({
        id: i.catalogId || i.id,
        name: i.name,
      }))),
    [catalog, institutions],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return institutions.filter((row) => {
      if (!q) return true;
      return (
        row.name.toLowerCase().includes(q)
        || String(row.contactEmail || '').toLowerCase().includes(q)
      );
    });
  }, [institutions, search]);

  const downloadCombined = () => runReport(() => {
    if (!institutions.length) {
      const err = new Error('No institutions available to include in a combined report.');
      err.code = 'REPORT_MISSING_DATA';
      throw err;
    }

    const reports = institutions.map((inst) => {
      const scopedStudents = students.filter((s) => (s.institution || 'Unassigned') === inst.name);
      const scopedInterviews = interviews.filter((iv) => {
        const name = iv.institution
          || students.find((s) => s.id === iv.studentId)?.institution
          || 'Unassigned';
        return name === inst.name;
      });
      return buildInstitutionReport(inst, scopedStudents, scopedInterviews);
    });

    const comparison = buildCombinedComparison(reports);
    downloadCombinedInstitutionsPdf(reports, comparison);
  }, { successMessage: 'Combined institutions report downloaded.' });

  const submitCreate = async () => {
    if (!form.name.trim()) {
      toast.error('Institution name is required.');
      return;
    }
    setSaving(true);
    try {
      const created = await adminInstitutionsService.create({
        name: form.name.trim(),
        contactEmail: form.contactEmail.trim(),
      });
      toast.success(`${created.name} added.`, { className: 'app-toast--teal' });
      setCreateOpen(false);
      setForm(emptyForm);
      await refetch();
      navigate(`/admin/institutions/${encodeURIComponent(created.id)}`);
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Could not create institution.');
    } finally {
      setSaving(false);
    }
  };

  const selectedImportInstitution = useMemo(
    () => catalogOptions.find((inst) => String(inst.id) === String(importInstitutionId)) || null,
    [catalogOptions, importInstitutionId],
  );

  const openDeleteDialog = (row, event) => {
    event?.stopPropagation?.();
    event?.preventDefault?.();
    if (!row.catalogId) return;
    setDeleteTarget(row);
  };

  const closeDeleteDialog = () => {
    setDeleteTarget(null);
  };

  const onCsvFile = async (file) => {
    if (!file) return;
    if (!importInstitutionId) {
      toast.error('Select an institution before uploading.');
      return;
    }
    const text = await file.text();
    setImportPreview(parseCsv(text));
  };

  const submitImport = async () => {
    if (!importInstitutionId) {
      toast.error('Select an institution first.');
      return;
    }
    const studentsPayload = importPreview.rows.map((row) => buildStudentImportPayload(row));

    if (!studentsPayload.length) {
      toast.error('CSV needs name and email columns with at least one data row.');
      return;
    }

    setImporting(true);
    try {
      const result = await adminInstitutionsService.bulkImportStudents(
        importInstitutionId,
        studentsPayload,
      );
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

  if (loading) return <PageSkeleton variant="cards" />;
  if (error) {
    return (
      <div className="admin-page">
        <PageHeader title="Institutions" description="Campus rollups from live user profiles." />
        <AdminQueryError error={error} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="admin-page admin-institutions-page">
      <PageHeader
        title="Institutions"
        description="Add campuses, import students by institution, and review live readiness rollups."
        actions={(
          <>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={() => {
                setImportInstitutionId('');
                setImportStep('form');
                setImportPreview({ headers: [], rows: [] });
                setImportOpen(true);
              }}
              disabled={!catalogOptions.length}
              title={catalogOptions.length ? undefined : 'Add an institution before importing students'}
            >
              <FileUp size={15} />
              Bulk import students
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--primary"
              onClick={() => setCreateOpen(true)}
            >
              <Plus size={15} />
              Add institution
            </button>
            <DownloadReportButton
              label="Download Combined Report"
              loadingLabel="Generating combined PDF…"
              loading={generating}
              disabled={!institutions.length}
              onClick={downloadCombined}
              variant="ghost"
            />
          </>
        )}
      />

      <div className="admin-filter-bar admin-card">
        <label className="admin-filter-field admin-filter-field--grow">
          <span>Search</span>
          <div className="admin-search">
            <Search size={16} />
            <input
              type="search"
              placeholder="Institution name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </label>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No institutions yet"
          description="Add an institution to start importing students and tracking campus performance."
          action={(
            <button type="button" className="admin-btn admin-btn--primary" onClick={() => setCreateOpen(true)}>
              <Plus size={15} />
              Add institution
            </button>
          )}
        />
      ) : (
        <div className="admin-inst-grid">
          {filtered.map((row) => (
            <div
              key={row.id}
              className="admin-inst-card admin-card"
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/admin/institutions/${encodeURIComponent(row.catalogId || row.id)}`)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  navigate(`/admin/institutions/${encodeURIComponent(row.catalogId || row.id)}`);
                }
              }}
            >
              <div className="admin-inst-card-top">
                <span className="admin-inst-avatar">{institutionInitials(row.name)}</span>
                {row.catalogId ? (
                  <button
                    type="button"
                    className="admin-icon-btn admin-icon-btn--danger admin-inst-card-delete"
                    title={`Archive ${row.name}`}
                    aria-label={`Archive ${row.name}`}
                    onClick={(event) => openDeleteDialog(row, event)}
                  >
                    <Trash2 size={15} />
                  </button>
                ) : null}
              </div>
              <h3>{row.name}</h3>
              {row.contactEmail ? <p className="admin-muted">{row.contactEmail}</p> : null}
              <div className="admin-inst-stats">
                <span><Users size={14} /> {row.studentCount} students</span>
                <span><Mic2 size={14} /> {row.interviewCount} interviews</span>
              </div>
              <div className="admin-inst-score">
                <span>Readiness</span>
                <strong className={`admin-score-badge admin-score-badge--${getScoreTone(row.placementReadinessPct)}`}>
                  {row.placementReadinessPct}%
                </strong>
              </div>
            </div>
          ))}
        </div>
      )}

      <AdminDialog
        open={createOpen}
        title="Add institution"
        description="Creates a campus record. Students imported for this institution will get User.institution set to this name."
        onClose={() => setCreateOpen(false)}
        footer={(
          <>
            <button type="button" className="admin-btn admin-btn--ghost" onClick={() => setCreateOpen(false)}>Cancel</button>
            <button type="button" className="admin-btn admin-btn--primary" disabled={saving} onClick={submitCreate}>
              {saving ? 'Saving…' : 'Create institution'}
            </button>
          </>
        )}
      >
        <div className="admin-form-grid">
          <label>
            <span>Name</span>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. IIIT Sri City"
            />
          </label>
          <label>
            <span>Contact email</span>
            <input
              type="email"
              value={form.contactEmail}
              onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
              placeholder="placement@campus.edu"
            />
          </label>
        </div>
      </AdminDialog>

      <AdminDialog
        open={importOpen}
        title="Bulk import students"
         description="Select an institution, then upload CSV with name and email columns. Institution column is not required."
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
              disabled={importing || !importInstitutionId || importPreview.rows.length === 0}
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
              {importPreview.rows.length === 1 ? '' : 's'} into{' '}
              <strong>{selectedImportInstitution?.name || 'the selected institution'}</strong>.
            </p>
          </div>
        ) : (
          <>
        <div className="admin-form-grid">
          <label>
            <span>Institution *</span>
            <select
              value={importInstitutionId}
              onChange={(e) => {
                setImportInstitutionId(e.target.value);
                setImportPreview({ headers: [], rows: [] });
              }}
            >
              <option value="">Select institution…</option>
              {catalogOptions.map((inst) => (
                <option key={inst.id} value={inst.id}>{inst.name}</option>
              ))}
            </select>
          </label>
        </div>
        {!importInstitutionId ? (
          <p className="admin-import-warning" role="alert">Select an institution before uploading.</p>
        ) : null}
        <label className={`admin-dropzone${importInstitutionId ? '' : ' is-disabled'}`}>
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={!importInstitutionId}
            onChange={(e) => onCsvFile(e.target.files?.[0])}
          />
          <strong>{importInstitutionId ? 'Drag & drop CSV' : 'Upload disabled'}</strong>
           <span>{importInstitutionId ? 'Columns: name, email' : 'Select an institution above first'}</span>
        </label>
        {importPreview.rows.length > 0 && (
          <div className="admin-import-preview">
            <p>Preview ({Math.min(importPreview.rows.length, 8)} of {importPreview.rows.length})</p>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    {importPreview.headers.map((h) => <th key={h}>{h}</th>)}
                  </tr>
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

      <InstitutionArchiveDialog
        target={deleteTarget}
        onClose={closeDeleteDialog}
        onArchived={refetch}
      />
    </div>
  );
};

export default AdminInstitutions;
