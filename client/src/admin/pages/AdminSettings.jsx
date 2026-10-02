import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { PageHeader } from '../components/shared/PageHeader';

import { DataTable } from '../components/shared/DataTable';

import { PageSkeleton } from '../components/shared/PageSkeleton';

import { AdminQueryError, PendingBackendState } from '../components/shared/PendingBackendState';

import { useAdminUsers, useAdminInstitutionCatalog } from '../hooks';

import { adminSettingsService, adminUsersService } from '../services/adminApi';

import { AdminDialog } from '../components/shared/AdminDialog';

import { InstitutionMultiSelect } from '../components/shared/InstitutionScope';

import { useToast } from '../../context/ToastContext';

import { passwordFromUsername, usernameFromEmail } from '../lib/parseImportFile';

import api from '../../services/api';



const ADMIN_ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin (college-scoped)' },
  { value: 'superAdmin', label: 'Super Admin' },
];

const TABS = [
  { id: 'accounts', label: 'Admin Accounts' },
  { id: 'roles', label: 'Roles & Permissions' },
  { id: 'health', label: 'System Health' },
  { id: 'platform', label: 'Platform Config' },
];



const formatTimestamp = (value) => {

  if (!value) return '—';

  return new Date(value).toLocaleString();

};



const SystemHealthPanel = () => {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/health');
      setHealth(res.data);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Could not load system health.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <PageSkeleton rows={4} />;
  if (error) return <AdminQueryError error={error} onRetry={load} />;

  const warnings = Array.isArray(health?.warnings) ? health.warnings : [];
  const capabilities = health?.capabilities || {};

  return (
    <div className="admin-settings-health">
      <section className="admin-card">
        <div className="admin-row-actions" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <h3>Service status</h3>
            <p className="admin-muted">Live health from the API — no secrets are shown.</p>
          </div>
          <button type="button" className="admin-btn admin-btn--ghost" onClick={load}>Refresh</button>
        </div>
        <p>
          <strong>Overall:</strong>{' '}
          <span className={`admin-pill admin-pill--${health?.status === 'ok' ? 'ready' : 'beginner'}`}>
            {health?.status || 'unknown'}
          </span>
        </p>
        <p><strong>MongoDB:</strong> {health?.mongodb || '—'}</p>
        <p><strong>Node:</strong> {health?.node || '—'}</p>
        <p><strong>LLM:</strong> {capabilities.llm ? 'Available' : 'Unavailable'}</p>
        <p><strong>TTS:</strong> {capabilities.tts ? 'Available' : 'Unavailable'}</p>
        <p><strong>STT:</strong> {capabilities.stt ? 'Available' : 'Unavailable'}</p>
        {warnings.length ? (
          <ul className="admin-health-warnings">
            {warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        ) : (
          <p className="admin-muted">No warnings.</p>
        )}
      </section>
    </div>
  );
};




export const AdminSettings = () => {
  const toast = useToast();
  const [tab, setTab] = useState('accounts');
  const { platformAdmins, loading, error, refetch } = useAdminUsers({ scope: 'admins' });
  const { catalog, refetch: refetchCatalog } = useAdminInstitutionCatalog();
  const catalogInstitutions = useMemo(
    () => [...catalog].map((row) => ({ id: String(row.id), name: row.name })).sort((a, b) => a.name.localeCompare(b.name)),
    [catalog],
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [adminForm, setAdminForm] = useState({
    email: '',
    username: '',
    password: '',
    role: 'admin',
    assignedInstitutionIds: [],
  });

  useEffect(() => {
    if (createOpen || editOpen) {
      refetchCatalog?.();
    }
  }, [createOpen, editOpen, refetchCatalog]);

  const resetForm = () => setAdminForm({
    email: '',
    username: '',
    password: '',
    role: 'admin',
    assignedInstitutionIds: [],
  });

  const submitAdmin = async () => {
    if (!adminForm.email.trim() || !adminForm.username.trim()) {
      toast.error('Email and username are required.');
      return;
    }
    if (!editTarget && !adminForm.password) {
      toast.error('Password is required for new accounts.');
      return;
    }
    if (adminForm.role === 'admin' && !adminForm.assignedInstitutionIds.length) {
      toast.error('Select at least one college for Admin accounts.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        email: adminForm.email.trim().toLowerCase(),
        username: adminForm.username.trim().toLowerCase(),
        role: adminForm.role,
        name: adminForm.username.trim(),
      };
      if (adminForm.password) payload.password = adminForm.password;
      if (adminForm.role === 'admin') {
        payload.assignedInstitutionIds = adminForm.assignedInstitutionIds;
      }
      if (editTarget) {
        await adminUsersService.update(editTarget.id, payload);
        toast.success('Admin updated.');
        setEditOpen(false);
      } else {
        await adminUsersService.create(payload);
        toast.success('Admin created.');
        setCreateOpen(false);
      }
      setEditTarget(null);
      resetForm();
      await refetch();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Could not save admin.');
    } finally {
      setSaving(false);
    }
  };

  const openEditAdmin = (row) => {
    setEditTarget(row);
    const assigned = row.assignedInstitutionIds || row.raw?.assignedInstitutionIds || [];
    setAdminForm({
      email: row.email || '',
      username: row.raw?.username || usernameFromEmail(row.email),
      password: passwordFromUsername(row.raw?.username || 'admin'),
      role: row.raw?.role === 'superAdmin' ? 'superAdmin' : 'admin',
      assignedInstitutionIds: assigned.map((id) => String(id)),
    });
    setEditOpen(true);
  };

  const columns = useMemo(() => [
    { id: 'name', header: 'Name', sortable: true },
    { id: 'email', header: 'Email', sortable: true },
    { id: 'institutionName', header: 'Assigned colleges', sortable: true },
    { id: 'roleScope', header: 'Role', sortable: true },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => (
        <span className="admin-pill admin-pill-status--active">{row.status}</span>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (row) => (
        <button type="button" className="admin-btn admin-btn--ghost" onClick={() => openEditAdmin(row)}>
          Edit assignments
        </button>
      ),
    },
  ], []);



  if (loading && tab === 'accounts') return <PageSkeleton />;

  if (error && tab === 'accounts') {

    return (

      <div className="admin-page">

        <PageHeader title="Settings" description="Admin accounts and VFSTR.AI configuration." />

        <AdminQueryError error={error} onRetry={refetch} />

      </div>

    );

  }



  return (

    <div className="admin-page admin-settings-page">

      <PageHeader
        title="Settings"
        description="Create and manage Super Admin and college-scoped Admin accounts."
        actions={tab === 'accounts' ? (
          <button type="button" className="admin-btn admin-btn--primary" onClick={() => { resetForm(); setCreateOpen(true); }}>
            Create admin
          </button>
        ) : null}
      />



      <div className="admin-tabs" role="tablist">

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



      {tab === 'accounts' && (
        <>
          {!catalogInstitutions.length ? (
            <div className="admin-card admin-settings-college-hint" role="status">
              <p>
                <strong>No colleges yet.</strong> Create colleges on the Institutions page before assigning them to Admin accounts.
              </p>
              <Link to="/admin/institutions" className="admin-btn admin-btn--primary admin-btn--sm">
                Go to Institutions → Add college
              </Link>
            </div>
          ) : null}
          <div className="admin-card admin-table-card">
            <DataTable
              columns={columns}
              rows={platformAdmins}
              emptyMessage="No admin accounts found."
            />
          </div>
        </>
      )}



      {tab === 'roles' && (

        <PendingBackendState

          title="Pending backend support"

          description="A roles & permissions matrix API does not exist yet. Runtime auth uses the User.role enum only."

          feature="Roles & Permissions"

        />

      )}



      {tab === 'health' && <SystemHealthPanel />}



      {tab === 'platform' && (

        <div className="admin-settings-platform">

          <section className="admin-card">

            <h3>Brand (local UI only)</h3>

            <p className="admin-muted">

              Theme colors are fixed in the admin CSS (mist + cobalt). Primary accent reference:{' '}

              <code>#2563EB</code>

            </p>

          </section>

          <PendingBackendState

            title="Pending backend support"

            description="Platform name, retention policy, logo upload, and integration API-key vault endpoints are not available yet."

            feature="Platform config / integrations"

          />

        </div>

      )}

      <AdminDialog
        wide
        open={createOpen || editOpen}
        title={editTarget ? 'Edit admin account' : 'Create admin account'}
        description="Super Admins have platform-wide access. Admins are scoped to selected colleges only."
        onClose={() => { setCreateOpen(false); setEditOpen(false); setEditTarget(null); }}
        footer={(
          <>
            <button type="button" className="admin-btn admin-btn--ghost" onClick={() => { setCreateOpen(false); setEditOpen(false); setEditTarget(null); }}>Cancel</button>
            <button type="button" className="admin-btn admin-btn--primary" disabled={saving} onClick={submitAdmin}>
              {saving ? 'Saving…' : editTarget ? 'Save changes' : 'Create admin'}
            </button>
          </>
        )}
      >
        <div className="admin-form-grid">
          <label>
            <span>Email</span>
            <input type="email" value={adminForm.email} onChange={(e) => setAdminForm((p) => ({ ...p, email: e.target.value }))} />
          </label>
          <label>
            <span>Username</span>
            <input type="text" value={adminForm.username} onChange={(e) => setAdminForm((p) => ({ ...p, username: e.target.value.toLowerCase() }))} />
          </label>
          <label>
            <span>Password</span>
            <input type="text" value={adminForm.password} onChange={(e) => setAdminForm((p) => ({ ...p, password: e.target.value }))} />
          </label>
          <label>
            <span>Role</span>
            <select value={adminForm.role} onChange={(e) => setAdminForm((p) => ({ ...p, role: e.target.value }))}>
              {ADMIN_ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </label>
          {adminForm.role === 'admin' ? (
            <InstitutionMultiSelect
              institutions={catalogInstitutions}
              value={adminForm.assignedInstitutionIds}
              onChange={(ids) => setAdminForm((p) => ({ ...p, assignedInstitutionIds: ids }))}
            />
          ) : null}
        </div>
      </AdminDialog>

    </div>

  );

};



export default AdminSettings;


