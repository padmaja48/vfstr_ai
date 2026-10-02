import React, { useEffect, useMemo, useState, useContext } from 'react';
import { Link } from 'react-router-dom';
import { Eye, FileUp, Pencil, Plus, Power, Trash2, UserX, Download, KeyRound } from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';
import { DataTable } from '../components/shared/DataTable';
import { AdminDialog, AdminSheet } from '../components/shared/AdminDialog';
import { SkillRadarChart, toSkillRadarData } from '../components/shared/SkillRadarChart';
import { FluentReadinessGauge } from '../components/shared/FluentReadinessGauge';
import { PageSkeleton } from '../components/shared/PageSkeleton';
import { EmptyState } from '../components/shared/EmptyState';
import { AdminQueryError } from '../components/shared/PendingBackendState';
import { ImportResultsPanel } from '../components/shared/ImportResultsPanel';
import {
  useAdminUserAnalytics,
  useAdminUsers,
  useAdminInterviews,
  useAdminResumes,
  useAdminInstitutionCatalog,
} from '../hooks';
import { adminAnalyticsService, adminUsersService } from '../services/adminApi';
import { useToast } from '../../context/ToastContext';
import { AuthContext } from '../../context/AuthContext';
import { isSuperAdmin, isInstitutionAdmin, getAssignedInstitutions } from '../lib/adminAuth';
import { InstitutionMultiSelect, InstitutionScopeFilter } from '../components/shared/InstitutionScope';
import { getScoreColor, getScoreTone } from '@/admin/lib/getScoreColor';
import {
  extractEmailsFromRows,
  parseSpreadsheetFile,
  passwordFromUsername,
  readLastImport,
  saveLastImport,
  usernameFromEmail,
} from '../lib/parseImportFile';

const readinessClass = (level) => {
  if (level === 'Ready') return 'ready';
  if (level === 'Intermediate') return 'intermediate';
  return 'beginner';
};

const accountStatusLabel = (status) => ({
  active: 'Active',
  pending_setup: 'Pending Setup',
  deactivated: 'Deactivated',
}[status] || status);

const ROLE_OPTIONS = [
  { value: 'student', label: 'Student' },
  { value: 'admin', label: 'Admin (college-scoped)' },
  { value: 'superAdmin', label: 'Super Admin' },
];

const emptyCreateForm = () => ({
  email: '',
  username: '',
  password: '',
  role: 'student',
  assignedInstitutionIds: [],
});

const emptyEditForm = () => ({
  email: '',
  username: '',
  institution: '',
  role: 'student',
  password: '',
  resetPassword: false,
  assignedInstitutionIds: [],
});

export const AdminUsers = () => {
  const toast = useToast();
  const { user: authUser } = useContext(AuthContext);
  const superAdmin = isSuperAdmin(authUser);
  const collegeAdmin = isInstitutionAdmin(authUser);
  const canBulkImport = superAdmin;
  const assignedInstitutions = useMemo(() => getAssignedInstitutions(authUser), [authUser]);
  const [collegeScope, setCollegeScope] = useState('all');
  const [tab, setTab] = useState('students');
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkAction, setBulkAction] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const { interviews } = useAdminInterviews();
  const { resumes } = useAdminResumes();
  const { catalog } = useAdminInstitutionCatalog();

  const [search, setSearch] = useState('');
  const [institutionFilter, setInstitutionFilter] = useState('all');
  const [batchFilter, setBatchFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [readinessFilter, setReadinessFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const catalogInstitutions = useMemo(
    () => [...catalog]
      .map((row) => ({ id: String(row.id), name: row.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [catalog],
  );

  const institutionIdFilter = useMemo(() => {
    if (collegeAdmin && collegeScope !== 'all') return collegeScope;
    if (institutionFilter === 'all') return undefined;
    const match = catalogInstitutions.find((row) => row.name === institutionFilter);
    return match?.id;
  }, [collegeAdmin, collegeScope, institutionFilter, catalogInstitutions]);

  const {
    students,
    platformAdmins,
    loading,
    error,
    refetch,
    pagination,
  } = useAdminUsers({
    paginated: true,
    page,
    limit: 8,
    search: tab === 'students' ? search : '',
    status: tab === 'students' ? statusFilter : 'all',
    scope: tab === 'students' ? 'non_admin' : 'admins',
    institution: institutionIdFilter ? 'all' : (tab === 'students' ? institutionFilter : 'all'),
    institutionId: institutionIdFilter,
    batch: batchFilter || undefined,
    branch: branchFilter || undefined,
  });

  const [selectedStudent, setSelectedStudent] = useState(null);
  const [drawerTab, setDrawerTab] = useState('overview');

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [creating, setCreating] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importRole, setImportRole] = useState('student');
  const [importInstitutionId, setImportInstitutionId] = useState('');
  const [importStep, setImportStep] = useState('form');
  const [importPreview, setImportPreview] = useState({ headers: [], rows: [], emails: [] });
  const [importResult, setImportResult] = useState(() => readLastImport());
  const [importing, setImporting] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [savingEdit, setSavingEdit] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [statusTarget, setStatusTarget] = useState(null);
  const [savingStatus, setSavingStatus] = useState(false);
  const [terminateTarget, setTerminateTarget] = useState(null);
  const [terminateReason, setTerminateReason] = useState('');
  const [terminating, setTerminating] = useState(false);
  const [resetPasswordTarget, setResetPasswordTarget] = useState(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [resettingPassword, setResettingPassword] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);

  const analytics = useAdminUserAnalytics(selectedStudent?.id);

  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [search, statusFilter, institutionFilter, readinessFilter, batchFilter, branchFilter]);

  const effectiveImportInstitutionId = importInstitutionId;

  const selectedImportInstitution = useMemo(() => (
    catalogInstitutions.find((row) => row.id === effectiveImportInstitutionId) || null
  ), [catalogInstitutions, effectiveImportInstitutionId]);

  const canSelectImportInstitution = Boolean(effectiveImportInstitutionId);

  const institutions = useMemo(() => {
    if (collegeAdmin && assignedInstitutions.length) {
      return assignedInstitutions.map((i) => i.name).sort((a, b) => a.localeCompare(b));
    }
    const fromStudents = students.map((s) => s.institution).filter(Boolean);
    const fromCatalog = catalog.map((c) => c.name);
    return [...new Set([...fromCatalog, ...fromStudents])].sort((a, b) => a.localeCompare(b));
  }, [students, catalog, collegeAdmin, assignedInstitutions]);

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students.filter((s) => {
      if (institutionFilter !== 'all' && s.institution !== institutionFilter) return false;
      if (readinessFilter !== 'all' && s.readinessLevel !== readinessFilter) return false;
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q)
        || s.email.toLowerCase().includes(q)
        || String(s.username || '').toLowerCase().includes(q)
      );
    });
  }, [students, search, institutionFilter, readinessFilter, statusFilter]);

  const studentInterviews = useMemo(() => {
    if (!selectedStudent) return [];
    if (analytics.data?.interviewHistory?.length) return analytics.data.interviewHistory;
    return interviews
      .filter((i) => i.studentId === selectedStudent.id)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [selectedStudent, interviews, analytics.data]);

  const studentResumes = useMemo(() => {
    if (!selectedStudent) return [];
    return resumes.filter((r) => r.studentId === selectedStudent.id);
  }, [selectedStudent, resumes]);

  const radarData = useMemo(() => {
    if (analytics.data?.skillBreakdown) {
      return toSkillRadarData(analytics.data.skillBreakdown, selectedStudent?.averageScore);
    }
    return toSkillRadarData(null, selectedStudent?.averageScore);
  }, [analytics.data, selectedStudent]);

  const readinessScore = Math.round(
    analytics.data?.skillBreakdown?.overall
      ?? selectedStudent?.averageScore
      ?? 0,
  );

  const openCreate = () => {
    setCreateForm(emptyCreateForm());
    setCreateOpen(true);
  };

  const onCreateEmailChange = (email) => {
    const next = email.trim().toLowerCase();
    setCreateForm((prev) => ({
      ...prev,
      email: next,
      username: prev.username || (next.includes('@') ? usernameFromEmail(next) : prev.username),
    }));
  };

  const submitCreate = async () => {
    if (!createForm.email.trim() || !createForm.username.trim() || !createForm.password) {
      toast.error('Email, username, and password are required.');
      return;
    }
    if (createForm.role === 'admin' && !createForm.assignedInstitutionIds.length) {
      toast.error('Select at least one college for Admin accounts.');
      return;
    }
    setCreating(true);
    try {
      const payload = {
        email: createForm.email.trim().toLowerCase(),
        username: createForm.username.trim().toLowerCase(),
        password: createForm.password,
        role: createForm.role,
        name: createForm.username.trim(),
      };
      if (createForm.role === 'admin') {
        payload.assignedInstitutionIds = createForm.assignedInstitutionIds;
      }
      await adminUsersService.create(payload);
      toast.success('Account created.', { className: 'app-toast--teal' });
      setCreateOpen(false);
      await refetch();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Could not create account.');
    } finally {
      setCreating(false);
    }
  };

  const openImportDialog = () => {
    setImportRole('student');
    setImportInstitutionId('');
    setImportStep('form');
    setImportPreview({ headers: [], rows: [], emails: [] });
    setImportOpen(true);
  };

  const onImportFile = async (file) => {
    if (!file) return;
    if (!canSelectImportInstitution) {
      toast.error('Select an institution before uploading.');
      return;
    }
    try {
      const parsed = await parseSpreadsheetFile(file);
      const emails = extractEmailsFromRows(parsed.rows);
      setImportPreview({ ...parsed, emails });
      if (!emails.length) {
        toast.error('No email addresses found in the file.');
      }
    } catch {
      toast.error('Could not read that file. Use CSV or Excel (.xlsx).');
    }
  };

  const submitImport = async () => {
    if (!canSelectImportInstitution) {
      toast.error('Select an institution before importing.');
      return;
    }
    if (!importPreview.emails.length) {
      toast.error('Add a CSV/Excel file with at least one email.');
      return;
    }
    setImporting(true);
    try {
      const result = await adminUsersService.bulkImportEmails(importPreview.emails, {
        role: importRole,
        institutionId: effectiveImportInstitutionId,
      });
      toast.success(
        `Imported ${result.createdCount} account${result.createdCount === 1 ? '' : 's'}`
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

  const openEdit = (row, e) => {
    e?.stopPropagation?.();
    setEditTarget(row);
    setEditForm({
      email: row.email || '',
      username: row.username || usernameFromEmail(row.email),
      institution: row.institution || row.raw?.institution || '',
      role: row.role || 'student',
      password: '',
      resetPassword: false,
      assignedInstitutionIds: row.raw?.assignedInstitutionIds || row.assignedInstitutionIds || [],
    });
    setEditOpen(true);
  };

  const submitEdit = async () => {
    if (!editTarget) return;
    if (!editForm.username.trim()) {
      toast.error('Username is required.');
      return;
    }
    if (editForm.resetPassword && (!editForm.password || editForm.password.length < 8)) {
      toast.error('New password must be at least 8 characters.');
      return;
    }
    if (editForm.role === 'admin' && !editForm.assignedInstitutionIds.length) {
      toast.error('Select at least one college for Admin accounts.');
      return;
    }
    setSavingEdit(true);
    try {
      const payload = {
        email: editForm.email.trim().toLowerCase(),
        username: editForm.username.trim().toLowerCase(),
        institution: editForm.institution.trim(),
        role: editForm.role,
      };
      if (editForm.role === 'admin') {
        payload.assignedInstitutionIds = editForm.assignedInstitutionIds;
      }
      if (editForm.resetPassword) {
        payload.password = editForm.password;
      }
      await adminUsersService.update(editTarget.id, payload);
      toast.success('User updated.', { className: 'app-toast--teal' });
      setEditOpen(false);
      setEditTarget(null);
      if (selectedStudent?.id === editTarget.id) {
        setSelectedStudent(null);
      }
      await refetch();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Could not update user.');
    } finally {
      setSavingEdit(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await adminUsersService.remove(deleteTarget.id);
      toast.success('User account deleted.');
      if (selectedStudent?.id === deleteTarget.id) setSelectedStudent(null);
      setDeleteTarget(null);
      await refetch();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Could not delete user.');
    } finally {
      setDeleting(false);
    }
  };

  const confirmStatusChange = async () => {
    if (!statusTarget) return;
    const reactivating = statusTarget.status === 'deactivated';
    setSavingStatus(true);
    try {
      if (reactivating && collegeAdmin) {
        await adminAnalyticsService.reactivateStudent(statusTarget.id);
      } else {
        await adminUsersService.update(statusTarget.id, { isActive: reactivating });
      }
      toast.success(reactivating ? 'User reactivated.' : 'User deactivated.', { className: 'app-toast--teal' });
      setStatusTarget(null);
      await refetch();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Could not change account status.');
    } finally {
      setSavingStatus(false);
    }
  };

  const confirmResetPassword = async () => {
    if (!resetPasswordTarget) return;
    if (!resetPasswordValue || resetPasswordValue.length < 8) {
      toast.error('Password must be at least 8 characters.');
      return;
    }
    setResettingPassword(true);
    try {
      await adminAnalyticsService.resetStudentPassword(resetPasswordTarget.id, resetPasswordValue);
      toast.success('Student password reset.', { className: 'app-toast--teal' });
      setResetPasswordTarget(null);
      setResetPasswordValue('');
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Could not reset password.');
    } finally {
      setResettingPassword(false);
    }
  };

  const exportStudentsCsv = async () => {
    setExportingCsv(true);
    try {
      const blob = await adminAnalyticsService.exportStudentsCsv({
        institutionId: institutionIdFilter,
        batch: batchFilter || undefined,
        branch: branchFilter || undefined,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'students-export.csv';
      link.click();
      URL.revokeObjectURL(url);
      toast.success('Student export downloaded.', { className: 'app-toast--teal' });
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Could not export students.');
    } finally {
      setExportingCsv(false);
    }
  };

  const openTerminate = (row, e) => {
    e?.stopPropagation?.();
    setTerminateTarget(row);
    setTerminateReason('');
  };

  const confirmTerminate = async () => {
    if (!terminateTarget) return;
    const reason = terminateReason.trim();
    if (reason.length < 3) {
      toast.error('A termination reason is required (at least 3 characters).');
      return;
    }
    setTerminating(true);
    try {
      await adminAnalyticsService.terminateStudent(terminateTarget.id, { reason });
      toast.success(`${terminateTarget.name || 'Student'} terminated.`, { className: 'app-toast--teal' });
      if (selectedStudent?.id === terminateTarget.id) {
        setSelectedStudent((prev) => (prev ? { ...prev, status: 'deactivated' } : prev));
      }
      setTerminateTarget(null);
      setTerminateReason('');
      await refetch();
    } catch (err) {
      const message = err?.response?.data?.message || err?.message || 'Could not terminate student.';
      toast.error(message);
    } finally {
      setTerminating(false);
    }
  };

  const confirmBulkAction = async () => {
    if (!bulkAction || !selectedIds.size) return;
    setBulkBusy(true);
    try {
      const ids = [...selectedIds];
      if (bulkAction === 'delete') await adminUsersService.bulkRemove(ids);
      else await adminUsersService.bulkDeactivate(ids);
      toast.success(
        bulkAction === 'delete' ? 'Selected accounts deleted.' : 'Selected accounts deactivated.',
        { className: 'app-toast--teal' },
      );
      setBulkAction(null);
      setSelectedIds(new Set());
      await refetch();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Bulk action failed.');
    } finally {
      setBulkBusy(false);
    }
  };

  const studentColumns = [
    {
      id: 'name',
      header: 'Name',
      sortable: true,
      accessor: (row) => row.name,
      cell: (row) => (
        <div className="admin-user-cell">
          <strong>{row.name}</strong>
          <span>{row.email}</span>
        </div>
      ),
    },
    {
      id: 'username',
      header: 'Username',
      sortable: true,
      accessor: (row) => row.username || '—',
      cell: (row) => row.username || '—',
    },
    {
      id: 'institution',
      header: 'Institution',
      sortable: true,
      accessor: (row) => row.institution || '—',
      cell: (row) => row.institution || '—',
    },
    {
      id: 'role',
      header: 'Role',
      sortable: true,
      cell: (row) => row.role || 'student',
    },
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
      id: 'totalInterviews',
      header: 'Interviews',
      sortable: true,
    },
    {
      id: 'averageScore',
      header: 'Avg Score',
      sortable: true,
      cell: (row) => (
        <span className={`admin-score-badge admin-score-badge--${getScoreTone(row.averageScore)}`}>
          {Number(row.averageScore).toFixed(1)}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      sortable: true,
      cell: (row) => (
        <span className={`admin-pill admin-pill-status--${row.status}`}>
          {accountStatusLabel(row.status)}
        </span>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (row) => (
        <div className="admin-row-actions">
          <button
            type="button"
            className="admin-icon-btn"
            title="Quick view"
            onClick={(e) => {
              e.stopPropagation();
              setDrawerTab('overview');
              setSelectedStudent(row);
            }}
          >
            <Eye size={15} />
          </button>
          {superAdmin ? (
            <>
              <button
                type="button"
                className="admin-icon-btn"
                title="Edit"
                onClick={(e) => openEdit(row, e)}
              >
                <Pencil size={15} />
              </button>
              <button
                type="button"
                className="admin-icon-btn admin-icon-btn--danger"
                title={row.status === 'deactivated' ? 'Reactivate' : 'Deactivate'}
                onClick={(e) => {
                  e.stopPropagation();
                  setStatusTarget(row);
                }}
              >
                <Power size={15} />
              </button>
              <button
                type="button"
                className="admin-icon-btn admin-icon-btn--danger"
                title="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteTarget(row);
                }}
              >
                <Trash2 size={15} />
              </button>
            </>
          ) : null}
        </div>
      ),
    },
  ];

  const adminColumns = [
    { id: 'name', header: 'Name', sortable: true },
    { id: 'institutionName', header: 'Assigned colleges', sortable: true },
    { id: 'email', header: 'Email', sortable: true },
    { id: 'roleScope', header: 'Role scope', sortable: true },
    {
      id: 'actions',
      header: 'Actions',
      cell: (row) => (
        <div className="admin-row-actions">
          <button
            type="button"
            className="admin-icon-btn"
            title="Edit"
            onClick={(e) => openEdit({
              id: row.id,
              username: row.raw?.username || '',
              email: row.email,
              institution: row.institutionName === '—' ? '' : row.institutionName,
              role: row.raw?.role || 'admin',
              name: row.name,
              raw: row.raw,
              assignedInstitutionIds: row.assignedInstitutionIds || row.raw?.assignedInstitutionIds || [],
            }, e)}
          >
            <Pencil size={15} />
          </button>
          <button
            type="button"
            className="admin-icon-btn admin-icon-btn--danger"
            title="Delete"
            onClick={(e) => {
              e.stopPropagation();
              setDeleteTarget({
                id: row.id,
                name: row.name,
                email: row.email,
              });
            }}
          >
            <Trash2 size={15} />
          </button>
        </div>
      ),
    },
  ];

  if (loading) return <PageSkeleton />;
  if (error) {
    return (
      <div className="admin-page admin-users-page">
        <PageHeader title="Users" description="Manage students and VFSTR.AI admins." />
        <AdminQueryError error={error} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="admin-page admin-users-page">
      <PageHeader
        title="Users"
        description={superAdmin
          ? 'Create accounts, bulk-import emails, and manage usernames, passwords, and roles.'
          : 'View and analyze students in your institution.'}
        actions={canBulkImport ? (
          <>
            <button type="button" className="admin-btn admin-btn--ghost" onClick={openImportDialog}>
              <FileUp size={15} />
              Bulk Import
            </button>
            {superAdmin ? (
              <button type="button" className="admin-btn admin-btn--primary" onClick={openCreate}>
                <Plus size={15} />
                Create Account
              </button>
            ) : null}
          </>
        ) : null}
      />

      <div className="admin-tabs" role="tablist" aria-label="User directories">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'students'}
          className={`admin-tab${tab === 'students' ? ' is-active' : ''}`}
          onClick={() => setTab('students')}
        >
          Students
        </button>
        {superAdmin ? (
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'admins'}
            className={`admin-tab${tab === 'admins' ? ' is-active' : ''}`}
            onClick={() => setTab('admins')}
          >
            Platform Admins
          </button>
        ) : null}
      </div>

      {tab === 'students' ? (
        <>
          <div className="admin-filter-bar admin-card">
            <label className="admin-filter-field admin-filter-field--grow">
              <span>Search</span>
              <input
                type="search"
                placeholder="Name, email, or username…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            {superAdmin ? (
              <label className="admin-filter-field">
                <span>Institution</span>
                <select value={institutionFilter} onChange={(e) => setInstitutionFilter(e.target.value)}>
                  <option value="all">All institutions</option>
                  {institutions.map((inst) => (
                    <option key={inst} value={inst}>{inst}</option>
                  ))}
                </select>
              </label>
            ) : (
              <InstitutionScopeFilter
                institutions={assignedInstitutions}
                value={collegeScope}
                onChange={setCollegeScope}
              />
            )}
            <label className="admin-filter-field">
              <span>Readiness</span>
              <select value={readinessFilter} onChange={(e) => setReadinessFilter(e.target.value)}>
                <option value="all">All levels</option>
                <option value="Beginner">Beginner</option>
                <option value="Intermediate">Intermediate</option>
                <option value="Ready">Ready</option>
              </select>
            </label>
            <label className="admin-filter-field">
              <span>Status</span>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                 <option value="pending_setup">Pending Setup</option>
                 <option value="deactivated">Deactivated</option>
              </select>
            </label>
            <label className="admin-filter-field">
              <span>Batch</span>
              <input
                type="text"
                placeholder="Any batch"
                value={batchFilter}
                onChange={(e) => setBatchFilter(e.target.value)}
              />
            </label>
            <label className="admin-filter-field">
              <span>Branch</span>
              <input
                type="text"
                placeholder="Any branch"
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              disabled={exportingCsv}
              onClick={exportStudentsCsv}
            >
              <Download size={14} /> {exportingCsv ? 'Exporting…' : 'Export CSV'}
            </button>
          </div>

          {selectedIds.size > 0 ? (
            <div className="admin-card admin-bulk-actions">
              <strong>{selectedIds.size} account{selectedIds.size === 1 ? '' : 's'} selected</strong>
              <div className="admin-row-actions">
                <button type="button" className="admin-btn admin-btn--ghost" onClick={() => setBulkAction('deactivate')}>
                  <Power size={14} /> Deactivate selected
                </button>
                <button type="button" className="admin-btn admin-btn--danger" onClick={() => setBulkAction('delete')}>
                  <Trash2 size={14} /> Delete selected
                </button>
              </div>
            </div>
          ) : null}

          <div className="admin-card admin-table-card">
            <DataTable
              columns={studentColumns}
              rows={filteredStudents}
              loading={false}
              selectable
              selectedRowIds={selectedIds}
              onSelectionChange={setSelectedIds}
              serverPagination={pagination ? {
                ...pagination,
                onPageChange: setPage,
              } : undefined}
              onRowClick={(row) => {
                setDrawerTab('overview');
                setSelectedStudent(row);
              }}
              emptyMessage="No students match these filters."
            />
          </div>
        </>
      ) : (
        <div className="admin-card admin-table-card">
          {platformAdmins.length === 0 ? (
            <EmptyState
              title="No platform admins found"
              description="Users with role admin or recruiter will appear here. Create one with Create Account."
            />
          ) : (
            <DataTable
              columns={adminColumns}
              rows={platformAdmins}
              loading={false}
              serverPagination={pagination ? {
                ...pagination,
                onPageChange: setPage,
              } : undefined}
              emptyMessage="No platform admins yet."
            />
          )}
        </div>
      )}

      <AdminSheet
        open={Boolean(selectedStudent)}
        onClose={() => setSelectedStudent(null)}
        title={selectedStudent?.name || 'Student'}
        subtitle={selectedStudent ? `${selectedStudent.email} · ${selectedStudent.username || 'no username'} · ${selectedStudent.institution || 'No institution'}` : ''}
      >
        {selectedStudent && (
          <>
            <div className="admin-sheet-profile">
              <div className="admin-user-avatar admin-user-avatar--lg">
                {selectedStudent.name.split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase()}
              </div>
              <div>
                <div className="admin-sheet-badges">
                  <span className={`admin-pill admin-pill--${readinessClass(selectedStudent.readinessLevel)}`}>
                    {selectedStudent.readinessLevel}
                  </span>
                   <span className={`admin-pill admin-pill-status--${selectedStudent.status}`}>
                     {accountStatusLabel(selectedStudent.status)}
                  </span>
                </div>
                <p className="admin-sheet-meta">
                  Role {selectedStudent.role || 'student'} · Joined {selectedStudent.batchYear || '—'} · {selectedStudent.totalInterviews} interviews · avg{' '}
                  <span style={{ color: getScoreColor(selectedStudent.averageScore), fontWeight: 750 }}>
                    {Number(selectedStudent.averageScore).toFixed(1)}
                  </span>
                </p>
                <div className="admin-row-actions" style={{ marginTop: 10 }}>
                  {superAdmin ? (
                    <button type="button" className="admin-btn admin-btn--ghost" onClick={() => openEdit(selectedStudent)}>
                      <Pencil size={14} /> Edit account
                    </button>
                  ) : null}
                  {selectedStudent.status !== 'deactivated' ? (
                    <button
                      type="button"
                      className="admin-btn admin-btn--danger"
                      onClick={() => openTerminate(selectedStudent)}
                    >
                      <UserX size={14} /> Terminate
                    </button>
                  ) : collegeAdmin ? (
                    <button
                      type="button"
                      className="admin-btn admin-btn--primary"
                      onClick={async () => {
                        try {
                          await adminAnalyticsService.reactivateStudent(selectedStudent.id);
                          toast.success('Student reactivated.', { className: 'app-toast--teal' });
                          setSelectedStudent((prev) => (prev ? { ...prev, status: 'active' } : prev));
                          await refetch();
                        } catch (err) {
                          toast.error(err?.response?.data?.message || err?.message || 'Could not reactivate student.');
                        }
                      }}
                    >
                      <Power size={14} /> Reactivate
                    </button>
                  ) : null}
                  {collegeAdmin || superAdmin ? (
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost"
                      onClick={() => {
                        setResetPasswordTarget(selectedStudent);
                        setResetPasswordValue('');
                      }}
                    >
                      <KeyRound size={14} /> Reset password
                    </button>
                  ) : null}
                  {superAdmin ? (
                    <>
                      <button
                        type="button"
                        className="admin-btn admin-btn--ghost"
                        onClick={() => setStatusTarget(selectedStudent)}
                      >
                        <Power size={14} /> {selectedStudent.status === 'deactivated' ? 'Reactivate' : 'Deactivate'}
                      </button>
                      <button
                        type="button"
                        className="admin-btn admin-btn--danger"
                        onClick={() => setDeleteTarget(selectedStudent)}
                      >
                        <Trash2 size={14} /> Delete
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="admin-tabs admin-tabs--sheet" role="tablist">
              {['overview', 'history', 'resumes'].map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  className={`admin-tab${drawerTab === id ? ' is-active' : ''}`}
                  onClick={() => setDrawerTab(id)}
                >
                  {id === 'overview' ? 'Overview' : id === 'history' ? 'Interview History' : 'Resume(s)'}
                </button>
              ))}
            </div>

            {drawerTab === 'overview' && (
              <div className="admin-sheet-section admin-sheet-overview">
                {analytics.loading ? (
                  <p className="admin-muted">Loading analytics…</p>
                ) : (
                  <>
                    <h4>Skill radar</h4>
                    <SkillRadarChart data={radarData} height={260} />
                    <h4>Interview readiness</h4>
                    <FluentReadinessGauge score={readinessScore} size={180} />
                  </>
                )}
              </div>
            )}

            {drawerTab === 'history' && (
              <div className="admin-sheet-section">
                <h4>Interview history</h4>
                {studentInterviews.length === 0 ? (
                  <p className="admin-muted">No interviews recorded for this student.</p>
                ) : (
                  <ul className="admin-mini-list">
                    {studentInterviews.map((iv) => (
                      <li key={iv.id}>
                        <div>
                          <strong>{iv.targetCompany} · {iv.type}</strong>
                          <span>
                            {iv.date
                              ? new Date(iv.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                              : '—'}
                            {' · score '}
                            <span style={{ color: getScoreColor(iv.score), fontWeight: 700 }}>{iv.score}</span>
                          </span>
                        </div>
                        <Link className="admin-text-link" to={`/admin/interviews/${iv.id}`}>Open</Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {drawerTab === 'resumes' && (
              <div className="admin-sheet-section">
                <h4>Resume(s)</h4>
                {studentResumes.length === 0 ? (
                  <p className="admin-muted">No resume uploaded.</p>
                ) : (
                  <ul className="admin-mini-list">
                    {studentResumes.map((r) => (
                      <li key={r.id}>
                        <div>
                          <strong>{r.fileName}</strong>
                          <span>Score {r.resumeScore}</span>
                        </div>
                        <Link className="admin-text-link" to={`/admin/resume-analysis/${r.id}`}>View</Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </AdminSheet>

      <AdminDialog
        open={createOpen}
        title="Create account"
        description="Manually create a user with email, username, and password."
        onClose={() => setCreateOpen(false)}
        footer={(
          <>
            <button type="button" className="admin-btn admin-btn--ghost" onClick={() => setCreateOpen(false)}>Cancel</button>
            <button type="button" className="admin-btn admin-btn--primary" disabled={creating} onClick={submitCreate}>
              {creating ? 'Creating…' : 'Create account'}
            </button>
          </>
        )}
      >
        <div className="admin-form-grid">
          <label>
            <span>Email</span>
            <input
              type="email"
              value={createForm.email}
              onChange={(e) => onCreateEmailChange(e.target.value)}
              placeholder="student@college.edu"
              autoComplete="off"
            />
          </label>
          <label>
            <span>Username</span>
            <input
              type="text"
              value={createForm.username}
              onChange={(e) => setCreateForm((p) => ({ ...p, username: e.target.value.toLowerCase() }))}
              placeholder="student"
              autoComplete="off"
            />
          </label>
          <label>
            <span>Password</span>
            <input
              type="text"
              value={createForm.password}
              onChange={(e) => setCreateForm((p) => ({ ...p, password: e.target.value }))}
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
          </label>
          <label>
            <span>Role</span>
            <select
              value={createForm.role}
              onChange={(e) => setCreateForm((p) => ({ ...p, role: e.target.value }))}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </label>
          {createForm.role === 'admin' ? (
            <InstitutionMultiSelect
              institutions={catalogInstitutions}
              value={createForm.assignedInstitutionIds}
              onChange={(ids) => setCreateForm((p) => ({ ...p, assignedInstitutionIds: ids }))}
            />
          ) : null}
        </div>
      </AdminDialog>

      <AdminDialog
        open={importOpen}
        title="Bulk import emails"
        description="Upload CSV or Excel with emails. Username = part before @. Password = <username>@PV2913."
        onClose={() => {
          setImportOpen(false);
          setImportStep('form');
        }}
        wide
        footer={importStep === 'confirm' ? (
          <>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={() => setImportStep('form')}
              disabled={importing}
            >
              Back
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--primary"
              disabled={importing}
              onClick={submitImport}
            >
              {importing ? 'Importing…' : 'Confirm import'}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={() => {
                setImportOpen(false);
                setImportStep('form');
              }}
            >
              Close
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--primary"
              disabled={
                importing
                || !canSelectImportInstitution
                || importPreview.emails.length === 0
              }
              onClick={() => setImportStep('confirm')}
            >
              Review import ({importPreview.emails.length || 0})
            </button>
          </>
        )}
      >
        {importStep === 'confirm' ? (
          <div className="admin-import-confirm">
            <p className="admin-import-warning" role="alert">
              You&apos;re about to import <strong>{importPreview.emails.length}</strong> student
              {importPreview.emails.length === 1 ? '' : 's'} into{' '}
              <strong>{selectedImportInstitution?.name || 'the selected institution'}</strong>.
            </p>
            <p className="admin-muted">
              Each account will receive a generated username and <code>&lt;username&gt;@PV2913</code> password.
              Welcome emails will be sent when delivery is configured.
            </p>
          </div>
        ) : (
          <>
            <div className="admin-form-grid admin-form-grid--2">
              <label>
                <span>Institution *</span>
                <select
                  value={importInstitutionId}
                  onChange={(e) => {
                    setImportInstitutionId(e.target.value);
                    setImportPreview({ headers: [], rows: [], emails: [] });
                  }}
                  required
                >
                  <option value="">Select institution…</option>
                  {catalogInstitutions.map((inst) => (
                    <option key={inst.id} value={inst.id}>{inst.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Default role</span>
                <select value={importRole} onChange={(e) => setImportRole(e.target.value)}>
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </label>
            </div>
            {!canSelectImportInstitution ? (
              <p className="admin-import-warning" role="alert">
                Select an institution before uploading.
              </p>
            ) : null}
            <label className={`admin-dropzone${canSelectImportInstitution ? '' : ' is-disabled'}`}>
              <input
                type="file"
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                disabled={!canSelectImportInstitution}
                onChange={(e) => onImportFile(e.target.files?.[0])}
              />
              <strong>{canSelectImportInstitution ? 'Drag & drop CSV or Excel' : 'Upload disabled'}</strong>
              <span>
                {canSelectImportInstitution
                  ? 'email column (or a plain list of emails) — institution column not required'
                  : 'Select an institution above first'}
              </span>
            </label>
            {importPreview.emails.length > 0 && (
              <div className="admin-import-preview">
                <p>
                  Preview ({Math.min(importPreview.emails.length, 8)} of {importPreview.emails.length})
                  {' · '}password formula <code>&lt;username&gt;@PV2913</code>
                  {selectedImportInstitution?.name ? (
                    <> · institution: <strong>{selectedImportInstitution.name}</strong></>
                  ) : null}
                </p>
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Email</th>
                        <th>Username</th>
                        <th>Password</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.emails.slice(0, 8).map((email) => {
                        const username = usernameFromEmail(email);
                        return (
                          <tr key={email}>
                            <td>{email}</td>
                            <td>{username}</td>
                            <td>{passwordFromUsername(username)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <ImportResultsPanel result={importResult} filename="VFSTR_AI_user_credentials.csv" />
          </>
        )}
      </AdminDialog>

      <AdminDialog
        open={editOpen}
        title="Edit account"
        description={editTarget ? `Update ${editTarget.email || editTarget.name}` : 'Update username, password, or role.'}
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
            <span>Email</span>
            <input
              type="email"
              value={editForm.email}
              onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))}
              autoComplete="off"
            />
          </label>
          <label>
            <span>Username</span>
            <input
              type="text"
              value={editForm.username}
              onChange={(e) => setEditForm((p) => ({ ...p, username: e.target.value.toLowerCase() }))}
              autoComplete="off"
            />
          </label>
          <label>
            <span>Role</span>
            <select
              value={editForm.role}
              onChange={(e) => setEditForm((p) => ({ ...p, role: e.target.value }))}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </label>
          {editForm.role === 'admin' ? (
            <InstitutionMultiSelect
              institutions={catalogInstitutions}
              value={editForm.assignedInstitutionIds}
              onChange={(ids) => setEditForm((p) => ({ ...p, assignedInstitutionIds: ids }))}
            />
          ) : (
            <label>
              <span>Institution</span>
              <input
                type="text"
                value={editForm.institution}
                onChange={(e) => setEditForm((p) => ({ ...p, institution: e.target.value }))}
                placeholder="College / institution"
              />
            </label>
          )}
          <label className="admin-checkbox-row">
            <input
              type="checkbox"
              checked={editForm.resetPassword}
              onChange={(e) => setEditForm((p) => ({
                ...p,
                resetPassword: e.target.checked,
                password: e.target.checked
                  ? (p.password || passwordFromUsername(p.username || 'user'))
                  : '',
              }))}
            />
            <span>Reset password</span>
          </label>
          {editForm.resetPassword ? (
            <label>
              <span>New password</span>
              <input
                type="text"
                value={editForm.password}
                onChange={(e) => setEditForm((p) => ({ ...p, password: e.target.value }))}
                autoComplete="new-password"
              />
            </label>
          ) : null}
        </div>
      </AdminDialog>

      <AdminDialog
        open={Boolean(deleteTarget)}
        title="Delete user account?"
        description={
          deleteTarget
            ? `This permanently deletes ${deleteTarget.name || 'this user'} (${deleteTarget.email}). This cannot be undone.`
            : 'Confirm deletion.'
        }
        onClose={() => setDeleteTarget(null)}
        footer={(
          <>
            <button type="button" className="admin-btn admin-btn--ghost" onClick={() => setDeleteTarget(null)}>Cancel</button>
            <button type="button" className="admin-btn admin-btn--danger" disabled={deleting} onClick={confirmDelete}>
              {deleting ? 'Deleting…' : 'Delete account'}
            </button>
          </>
        )}
      >
        <p className="admin-muted">Interview and resume history for this user will no longer be linked in the admin directory.</p>
      </AdminDialog>

      <AdminDialog
        open={Boolean(terminateTarget)}
        title="Terminate student account?"
        description={terminateTarget
          ? `This deactivates ${terminateTarget.name || terminateTarget.email} and records a termination event. A reason is required.`
          : 'Confirm termination.'}
        onClose={() => {
          setTerminateTarget(null);
          setTerminateReason('');
        }}
        footer={(
          <>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={() => {
                setTerminateTarget(null);
                setTerminateReason('');
              }}
            >
              Cancel
            </button>
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

      <AdminDialog
        open={Boolean(statusTarget)}
        title={statusTarget?.status === 'deactivated' ? 'Reactivate user account?' : 'Deactivate user account?'}
        description={statusTarget
          ? `${statusTarget.name || statusTarget.email} will be ${statusTarget.status === 'deactivated' ? 'allowed to sign in again' : 'blocked from signing in'}.`
          : 'Confirm account status change.'}
        onClose={() => setStatusTarget(null)}
        footer={(
          <>
            <button type="button" className="admin-btn admin-btn--ghost" onClick={() => setStatusTarget(null)}>Cancel</button>
            <button
              type="button"
              className={`admin-btn ${statusTarget?.status === 'deactivated' ? 'admin-btn--primary' : 'admin-btn--danger'}`}
              disabled={savingStatus}
              onClick={confirmStatusChange}
            >
              {savingStatus ? 'Saving…' : statusTarget?.status === 'deactivated' ? 'Reactivate account' : 'Deactivate account'}
            </button>
          </>
        )}
      >
        <p className="admin-muted">This changes whether the account can authenticate. It does not delete interview or resume history.</p>
      </AdminDialog>

      <AdminDialog
        open={Boolean(resetPasswordTarget)}
        title="Reset student password?"
        description={resetPasswordTarget
          ? `Set a new password for ${resetPasswordTarget.name || resetPasswordTarget.email}. Their active sessions will be signed out.`
          : 'Confirm password reset.'}
        onClose={() => {
          setResetPasswordTarget(null);
          setResetPasswordValue('');
        }}
        footer={(
          <>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={() => {
                setResetPasswordTarget(null);
                setResetPasswordValue('');
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--primary"
              disabled={resettingPassword || resetPasswordValue.length < 8}
              onClick={confirmResetPassword}
            >
              {resettingPassword ? 'Saving…' : 'Reset password'}
            </button>
          </>
        )}
      >
        <label>
          <span>New password (min. 8 characters)</span>
          <input
            type="text"
            value={resetPasswordValue}
            onChange={(e) => setResetPasswordValue(e.target.value)}
            autoComplete="new-password"
            placeholder="Enter new password"
          />
        </label>
      </AdminDialog>

      <AdminDialog
        open={Boolean(bulkAction)}
        title={bulkAction === 'delete' ? 'Delete selected accounts?' : 'Deactivate selected accounts?'}
        description={`This will affect ${selectedIds.size} selected account${selectedIds.size === 1 ? '' : 's'}.`}
        onClose={() => setBulkAction(null)}
        footer={(
          <>
            <button type="button" className="admin-btn admin-btn--ghost" onClick={() => setBulkAction(null)}>Cancel</button>
            <button
              type="button"
              className={`admin-btn ${bulkAction === 'delete' ? 'admin-btn--danger' : 'admin-btn--primary'}`}
              disabled={bulkBusy}
              onClick={confirmBulkAction}
            >
              {bulkBusy ? 'Working…' : bulkAction === 'delete' ? 'Delete selected' : 'Deactivate selected'}
            </button>
          </>
        )}
      >
        <p className="admin-muted">
          {bulkAction === 'delete'
            ? 'Deletion is permanent and cannot be undone.'
            : 'Deactivated accounts will be blocked from signing in but their history will remain.'}
        </p>
      </AdminDialog>
    </div>
  );
};

export default AdminUsers;
