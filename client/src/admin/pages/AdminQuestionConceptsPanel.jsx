import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Pencil, Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { DataTable } from '../components/shared/DataTable';
import { AdminDialog } from '../components/shared/AdminDialog';
import { PageSkeleton } from '../components/shared/PageSkeleton';
import { EmptyState } from '../components/shared/EmptyState';
import { AdminQueryError } from '../components/shared/PendingBackendState';
import { adminQuestionConceptsService } from '../services/adminApi';
import { useToast } from '../../context/ToastContext';
import { isValidConceptId, resolveConceptId } from '../utils/conceptId';

const CATEGORIES = ['Technical', 'Culture', 'Coding', 'Behavioral'];
const TIERS = ['high', 'medium', 'low'];
const STATUSES = ['active', 'pending_review', 'archived', 'discarded'];

const PILOT_RESTORE_EXPECTED = {
  amazon: 28,
  tcs: 28,
  razorpay: 28,
  siemens: 18,
  'pennant-technologies': 9,
};

const emptyForm = () => ({
  companySlug: '',
  category: 'Technical',
  conceptLabel: '',
  tier: 'medium',
});

const truncate = (value, max = 100) => {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

const provisionBadge = (summary) => {
  if (!summary) return null;
  if (summary.provisioned === 'in_range') return 'In range';
  if (summary.provisioned === 'under') return 'Under-provisioned';
  return 'Above range';
};

const provisionShort = (summary) => {
  if (!summary) return '';
  if (summary.provisioned === 'in_range') return 'in range';
  if (summary.provisioned === 'under') return 'under';
  return 'above';
};

export const AdminQuestionConceptsPanel = () => {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [concepts, setConcepts] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [poolSummaries, setPoolSummaries] = useState([]);
  const [page, setPage] = useState(1);

  const [search, setSearch] = useState('');
  const [companySlug, setCompanySlug] = useState('');
  const [poolFilter, setPoolFilter] = useState('all');
  const [category, setCategory] = useState('all');
  const [tier, setTier] = useState('all');
  const [status, setStatus] = useState('active');

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingConceptId, setEditingConceptId] = useState('');
  const [editorForm, setEditorForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const closeEditor = () => {
    setEditorOpen(false);
    setEditingConceptId('');
    setEditorForm(emptyForm());
  };

  const openCreate = () => {
    setEditingConceptId('');
    setEditorForm(emptyForm());
    setEditorOpen(true);
  };

  const openEdit = useCallback((row) => {
    const conceptId = resolveConceptId(row);
    if (!isValidConceptId(conceptId)) {
      toast.error('This concept is missing a valid id. Refresh the page and try again.');
      return;
    }
    setEditingConceptId(conceptId);
    setEditorForm({
      companySlug: row.companySlug || '',
      category: row.category || 'Technical',
      conceptLabel: row.conceptLabel || '',
      tier: row.tier || 'medium',
    });
    setEditorOpen(true);
  }, [toast]);

  const [generateOpen, setGenerateOpen] = useState(false);
  const [generateForm, setGenerateForm] = useState({
    companyLabel: '',
    companySlug: '',
    tier: 'medium',
    roleTopic: '',
    count: 10,
  });
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState([]);
  const [selectedGenerated, setSelectedGenerated] = useState(new Set());
  const [savingGenerated, setSavingGenerated] = useState(false);

  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restorePreview, setRestorePreview] = useState(null);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreApplying, setRestoreApplying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [payload, summariesPayload] = await Promise.all([
        adminQuestionConceptsService.list({
          page,
          limit: 20,
          search: search || undefined,
          companySlug: companySlug || undefined,
          category: category !== 'all' ? category : undefined,
          tier: tier !== 'all' ? tier : undefined,
          status: status !== 'all' ? status : 'all',
        }),
        adminQuestionConceptsService.poolSummaries(),
      ]);
      setConcepts(payload.concepts || []);
      setPagination(payload.pagination || null);
      setPoolSummaries(summariesPayload.summaries || []);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [page, search, companySlug, category, tier, status]);

  useEffect(() => {
    load();
  }, [load]);

  const summaryForSlug = useMemo(() => {
    const map = new Map(poolSummaries.map((item) => [item.companySlug, item]));
    return (slug) => map.get(slug);
  }, [poolSummaries]);

  const sortedSummaries = useMemo(
    () => [...poolSummaries].sort((left, right) => right.activeConceptCount - left.activeConceptCount),
    [poolSummaries],
  );

  const filteredSummaries = useMemo(() => {
    if (poolFilter === 'all') return sortedSummaries;
    return sortedSummaries.filter((item) => item.provisioned === poolFilter);
  }, [poolFilter, sortedSummaries]);

  const totalActiveConcepts = useMemo(
    () => poolSummaries.reduce((sum, item) => sum + item.activeConceptCount, 0),
    [poolSummaries],
  );

  const selectCompany = (slug) => {
    setCompanySlug(slug);
    setPage(1);
  };

  const clearFilters = () => {
    setSearch('');
    setCompanySlug('');
    setPoolFilter('all');
    setCategory('all');
    setTier('all');
    setStatus('active');
    setPage(1);
  };

  const closeRestoreDialog = () => {
    setRestoreOpen(false);
    setRestorePreview(null);
  };

  const openRestoreDialog = async () => {
    setRestoreOpen(true);
    setRestoreLoading(true);
    setRestorePreview(null);
    try {
      const payload = await adminQuestionConceptsService.previewRestoreApprovedPilot();
      setRestorePreview(payload.report || null);
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Could not load restore preview');
      closeRestoreDialog();
    } finally {
      setRestoreLoading(false);
    }
  };

  const applyRestore = async () => {
    setRestoreApplying(true);
    try {
      const payload = await adminQuestionConceptsService.restoreApprovedPilot();
      const report = payload.report;
      const lines = (report?.companies || []).map(
        (row) => `${row.companySlug}: ${row.activeAfter ?? row.restoreCount} active`,
      );
      toast.success(`Pilot sets restored. ${lines.join(' · ')}`);
      closeRestoreDialog();
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Restore failed');
    } finally {
      setRestoreApplying(false);
    }
  };

  const isEditing = Boolean(editingConceptId);

  const submitEditor = async () => {
    if (!editorForm.conceptLabel.trim() || editorForm.conceptLabel.trim().length < 8) {
      toast.error('Concept label must be at least 8 characters.');
      return;
    }
    setSaving(true);
    try {
      if (isEditing) {
        if (!isValidConceptId(editingConceptId)) {
          toast.error('Cannot update: concept id is missing. Refresh and try again.');
          return;
        }
        await adminQuestionConceptsService.update(editingConceptId, {
          conceptLabel: editorForm.conceptLabel.trim(),
          category: editorForm.category,
          tier: editorForm.tier,
        });
        toast.success('Concept updated.', { className: 'app-toast--teal' });
      } else {
        if (!editorForm.companySlug.trim()) {
          toast.error('Company slug is required.');
          return;
        }
        await adminQuestionConceptsService.create({
          companySlug: editorForm.companySlug.trim(),
          category: editorForm.category,
          conceptLabel: editorForm.conceptLabel.trim(),
          tier: editorForm.tier,
        });
        toast.success('Concept created.', { className: 'app-toast--teal' });
      }
      closeEditor();
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Could not save concept.');
    } finally {
      setSaving(false);
    }
  };

  const archiveConcept = useCallback(async (row) => {
    const conceptId = resolveConceptId(row);
    if (!isValidConceptId(conceptId)) {
      toast.error('Cannot archive: concept id is missing.');
      return;
    }
    try {
      await adminQuestionConceptsService.archive(conceptId);
      toast.success('Concept archived.');
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Could not archive concept.');
    }
  }, [load, toast]);

  const deleteConcept = useCallback(async (row) => {
    const conceptId = resolveConceptId(row);
    if (!isValidConceptId(conceptId)) {
      toast.error('Cannot delete: concept id is missing.');
      return;
    }
    const label = (row.conceptLabel || 'this concept').slice(0, 80);
    if (!window.confirm(`Permanently delete "${label}"? This cannot be undone.`)) return;
    try {
      await adminQuestionConceptsService.delete(conceptId);
      toast.success('Concept deleted.');
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Could not delete concept.');
    }
  }, [load, toast]);

  const runGenerate = async () => {
    if (!generateForm.companyLabel.trim() || !generateForm.roleTopic.trim()) {
      toast.error('Company and role/topic are required.');
      return;
    }
    setGenerating(true);
    setGenerated([]);
    setSelectedGenerated(new Set());
    try {
      const payload = await adminQuestionConceptsService.generate({
        companyLabel: generateForm.companyLabel.trim(),
        companySlug: generateForm.companySlug.trim() || undefined,
        tier: generateForm.tier,
        roleTopic: generateForm.roleTopic.trim(),
        count: generateForm.count,
        categories: CATEGORIES,
      });
      setGenerated(payload.concepts || []);
      setSelectedGenerated(new Set((payload.concepts || []).map((_, index) => index)));
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'AI concept generation failed.');
    } finally {
      setGenerating(false);
    }
  };

  const saveGenerated = async () => {
    const selected = generated.filter((_, index) => selectedGenerated.has(index));
    if (!selected.length) {
      toast.error('Select at least one concept to save.');
      return;
    }
    setSavingGenerated(true);
    try {
      const result = await adminQuestionConceptsService.bulkCreate({
        concepts: selected.map((item) => ({
          companySlug: item.companySlug || generateForm.companySlug || generateForm.companyLabel,
          category: item.category,
          conceptLabel: item.conceptLabel,
          tier: item.tier || generateForm.tier,
          createdBy: 'ai',
        })),
      });
      toast.success(`Saved ${result.count || 0} concepts.`, { className: 'app-toast--teal' });
      setGenerateOpen(false);
      setGenerated([]);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Could not save generated concepts.');
    } finally {
      setSavingGenerated(false);
    }
  };

  const columns = useMemo(() => [
    {
      id: 'conceptLabel',
      header: 'Concept',
      cell: (row) => <span title={row.conceptLabel}>{truncate(row.conceptLabel, 120)}</span>,
    },
    {
      id: 'companySlug',
      header: 'Company',
      accessor: (row) => row.companySlug,
    },
    {
      id: 'category',
      header: 'Category',
      cell: (row) => <span className="admin-pill">{row.category}</span>,
    },
    {
      id: 'tier',
      header: 'Tier',
      cell: (row) => <span className="admin-pill admin-pill--muted">{row.tier}</span>,
    },
    {
      id: 'usageCount',
      header: 'Usage',
      sortable: true,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => (
        <span className={`admin-pill admin-pill-status--${row.status === 'active' ? 'active' : 'deactivated'}`}>
          {row.status}
        </span>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (row) => (
        <div className="admin-row-actions">
          <button type="button" className="admin-icon-btn" title="Edit" onClick={() => openEdit(row)}>
            <Pencil size={15} />
          </button>
          {row.status === 'active' ? (
            <button type="button" className="admin-icon-btn" title="Archive" onClick={() => archiveConcept(row)}>
              <Archive size={15} />
            </button>
          ) : null}
          <button type="button" className="admin-icon-btn admin-icon-btn--danger" title="Delete permanently" onClick={() => deleteConcept(row)}>
            <Trash2 size={15} />
          </button>
        </div>
      ),
    },
  ], [openEdit, archiveConcept, deleteConcept]);

  if (loading && !concepts.length) return <PageSkeleton rows={8} />;
  if (error) return <AdminQueryError error={error} onRetry={load} />;

  const hasActiveFilters = Boolean(
    search || companySlug || poolFilter !== 'all' || category !== 'all' || tier !== 'all' || status !== 'active',
  );

  return (
    <div className="admin-question-concepts-panel">
      {poolSummaries.length ? (
        <div className="admin-card admin-qb-pool-summaries">
          <div className="admin-qb-pool-head">
            <div>
              <h3>Company concept pool health</h3>
              <p className="admin-muted">
                {poolSummaries.length} companies · {totalActiveConcepts} active concepts total
              </p>
            </div>
            <div className="admin-qb-pool-head-actions">
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                title="Restore approved Amazon/TCS/Razorpay/Siemens/Pennant concept sets"
                onClick={openRestoreDialog}
              >
                <RotateCcw size={15} /> Restore approved pilot sets
              </button>
              <label className="admin-filter-field admin-filter-field--compact">
                <span>Pool status</span>
                <select value={poolFilter} onChange={(e) => setPoolFilter(e.target.value)} className="admin-input">
                  <option value="all">All companies</option>
                  <option value="under">Under-provisioned</option>
                  <option value="in_range">In range</option>
                  <option value="over">Above range</option>
                </select>
              </label>
            </div>
          </div>
          <div className="admin-qb-pool-grid">
            {filteredSummaries.map((summary) => (
              <button
                key={summary.companySlug}
                type="button"
                className={`admin-qb-pool-card admin-qb-pool-card--${summary.provisioned}${companySlug === summary.companySlug ? ' is-selected' : ''}`}
                onClick={() => selectCompany(companySlug === summary.companySlug ? '' : summary.companySlug)}
              >
                <strong>{summary.companySlug}</strong>
                <span className="admin-qb-pool-count">
                  {summary.activeConceptCount}
                  <em>/ {summary.recommendedMin}–{summary.recommendedMax}</em>
                </span>
                <span className="admin-qb-pool-meta">{provisionBadge(summary)} · {summary.tier} tier</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="admin-card admin-concepts-toolbar">
        <div className="admin-concepts-filters">
          <label className="admin-filter-field admin-filter-field--grow">
            <span>Search</span>
            <input
              type="search"
              placeholder="Search concepts…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="admin-input"
            />
          </label>
          <label className="admin-filter-field">
            <span>Company</span>
            <select
              value={companySlug}
              onChange={(e) => selectCompany(e.target.value)}
              className="admin-input"
            >
              <option value="">All companies</option>
              {sortedSummaries.map((summary) => (
                <option key={summary.companySlug} value={summary.companySlug}>
                  {summary.companySlug} — {summary.activeConceptCount} concepts ({provisionShort(summary)})
                </option>
              ))}
            </select>
          </label>
          <label className="admin-filter-field">
            <span>Category</span>
            <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} className="admin-input">
              <option value="all">All categories</option>
              {CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="admin-filter-field">
            <span>Tier</span>
            <select value={tier} onChange={(e) => { setTier(e.target.value); setPage(1); }} className="admin-input">
              <option value="all">All tiers</option>
              {TIERS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="admin-filter-field">
            <span>Status</span>
            <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="admin-input">
              <option value="all">All statuses</option>
              {STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>
        <div className="admin-concepts-toolbar-actions">
          {hasActiveFilters ? (
            <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={clearFilters}>
              Clear filters
            </button>
          ) : null}
          <button type="button" className="admin-btn admin-btn--ghost" onClick={() => setGenerateOpen(true)}>
            <Sparkles size={15} /> Bulk generate
          </button>
          <button type="button" className="admin-btn admin-btn--primary" onClick={openCreate}>
            <Plus size={15} /> Add concept
          </button>
        </div>
        {companySlug && summaryForSlug(companySlug) ? (
          <p className="admin-concepts-filter-meta">
            Showing concepts for <strong>{companySlug}</strong>
            {' '}· {summaryForSlug(companySlug).activeConceptCount} active in pool
            {' '}· target {summaryForSlug(companySlug).recommendedMin}–{summaryForSlug(companySlug).recommendedMax}
            {' '}({provisionBadge(summaryForSlug(companySlug))})
          </p>
        ) : null}
      </div>

      {concepts.length ? (
        <div className="admin-card admin-table-card">
          <DataTable columns={columns} rows={concepts} emptyMessage="No concepts found." />
          {pagination && pagination.totalPages > 1 ? (
            <div className="admin-pagination">
              <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <span className="admin-muted">
                Page {page} of {pagination.totalPages}
                {pagination.total != null ? ` · ${pagination.total} concepts` : ''}
              </span>
              <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <EmptyState
          title="No concepts yet"
          description="Add short topic labels per company. The AI turns each into a fresh question when students interview."
        />
      )}

      <AdminDialog
        open={editorOpen}
        title={isEditing ? 'Edit concept' : 'Add concept'}
        description="Concept labels are topic areas — not full questions. Wording is generated fresh at interview time."
        onClose={closeEditor}
        footer={(
          <>
            <button type="button" className="admin-btn admin-btn--ghost" onClick={closeEditor}>Cancel</button>
            <button type="button" className="admin-btn admin-btn--primary" disabled={saving} onClick={submitEditor}>
              {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Create concept'}
            </button>
          </>
        )}
      >
        <div className="admin-form-grid">
          <label>
            <span>Company slug</span>
            <input value={editorForm.companySlug} disabled={isEditing} onChange={(e) => setEditorForm((prev) => ({ ...prev, companySlug: e.target.value }))} placeholder="amazon" />
          </label>
          <label>
            <span>Category</span>
            <select value={editorForm.category} onChange={(e) => setEditorForm((prev) => ({ ...prev, category: e.target.value }))}>
              {CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <span>Tier</span>
            <select value={editorForm.tier} onChange={(e) => setEditorForm((prev) => ({ ...prev, tier: e.target.value }))}>
              {TIERS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="admin-form-span">
            <span>Concept label</span>
            <textarea rows={3} value={editorForm.conceptLabel} onChange={(e) => setEditorForm((prev) => ({ ...prev, conceptLabel: e.target.value }))} placeholder="Distributed systems / high-scale read traffic design" />
          </label>
          {editorForm.companySlug && summaryForSlug(editorForm.companySlug.trim().toLowerCase()) ? (
            <p className="admin-form-span admin-qb-pool-hint">
              Pool: {summaryForSlug(editorForm.companySlug.trim().toLowerCase()).activeConceptCount} concepts
              ({summaryForSlug(editorForm.companySlug.trim().toLowerCase()).recommendedMin}–
              {summaryForSlug(editorForm.companySlug.trim().toLowerCase()).recommendedMax} recommended for{' '}
              {summaryForSlug(editorForm.companySlug.trim().toLowerCase()).tier} tier)
            </p>
          ) : null}
        </div>
      </AdminDialog>

      <AdminDialog
        open={generateOpen}
        title="Bulk generate concepts"
        description="AI suggests short topic labels. Nothing is saved until you confirm."
        wide
        onClose={() => setGenerateOpen(false)}
        footer={generated.length ? (
          <>
            <button type="button" className="admin-btn admin-btn--ghost" onClick={() => setGenerateOpen(false)}>Close</button>
            <button type="button" className="admin-btn admin-btn--primary" disabled={savingGenerated} onClick={saveGenerated}>
              {savingGenerated ? 'Saving…' : 'Save selected'}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="admin-btn admin-btn--ghost" onClick={() => setGenerateOpen(false)}>Cancel</button>
            <button type="button" className="admin-btn admin-btn--primary" disabled={generating} onClick={runGenerate}>
              {generating ? 'Generating…' : 'Generate preview'}
            </button>
          </>
        )}
      >
        <div className="admin-form-grid">
          <label>
            <span>Company label</span>
            <input value={generateForm.companyLabel} onChange={(e) => setGenerateForm((prev) => ({ ...prev, companyLabel: e.target.value }))} />
          </label>
          <label>
            <span>Company slug (optional)</span>
            <input value={generateForm.companySlug} onChange={(e) => setGenerateForm((prev) => ({ ...prev, companySlug: e.target.value }))} />
          </label>
          <label>
            <span>Tier</span>
            <select value={generateForm.tier} onChange={(e) => setGenerateForm((prev) => ({ ...prev, tier: e.target.value }))}>
              {TIERS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="admin-form-span">
            <span>Role / topic</span>
            <input value={generateForm.roleTopic} onChange={(e) => setGenerateForm((prev) => ({ ...prev, roleTopic: e.target.value }))} />
          </label>
          <label className="admin-form-span">
            <span>Count ({generateForm.count})</span>
            <input type="range" min={5} max={30} value={generateForm.count} onChange={(e) => setGenerateForm((prev) => ({ ...prev, count: Number(e.target.value) }))} />
          </label>
        </div>
        {generated.length ? (
          <div className="admin-qb-generated">
            <h4>Generated concepts</h4>
            {generated.map((item, index) => (
              <label key={index} className="admin-qb-generated-item">
                <input
                  type="checkbox"
                  checked={selectedGenerated.has(index)}
                  onChange={(e) => {
                    setSelectedGenerated((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(index);
                      else next.delete(index);
                      return next;
                    });
                  }}
                />
                <div>
                  <strong>{item.category}</strong>
                  <p>{item.conceptLabel}</p>
                </div>
              </label>
            ))}
          </div>
        ) : null}
      </AdminDialog>

      <AdminDialog
        open={restoreOpen}
        title="Restore approved pilot concept sets"
        description="Re-activates the last approved batches for Amazon, TCS, Razorpay, Siemens, and Pennant Technologies. Surplus batches stay archived."
        onClose={closeRestoreDialog}
        footer={(
          <>
            <button type="button" className="admin-btn admin-btn--ghost" onClick={closeRestoreDialog} disabled={restoreApplying}>
              Cancel
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--primary"
              disabled={restoreLoading || restoreApplying || !restorePreview}
              onClick={applyRestore}
            >
              {restoreApplying ? 'Restoring…' : 'Restore now'}
            </button>
          </>
        )}
      >
        {restoreLoading ? (
          <p className="admin-muted">Loading preview…</p>
        ) : restorePreview ? (
          <div className="admin-restore-preview">
            <table className="admin-restore-preview-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Expected</th>
                  <th>To restore</th>
                  <th>Current status</th>
                </tr>
              </thead>
              <tbody>
                {restorePreview.companies.map((row) => (
                  <tr key={row.companySlug}>
                    <td>{row.companySlug}</td>
                    <td>{PILOT_RESTORE_EXPECTED[row.companySlug] ?? row.expected}</td>
                    <td>{row.restoreCount}</td>
                    <td>{row.priorStatuses.join(', ') || 'none'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {restorePreview.companies.some((row) => row.wrongActiveArchivedCount > 0) ? (
              <p className="admin-muted admin-restore-preview-note">
                Wrongly-active rows from other batches will be archived during restore.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="admin-muted">No preview available.</p>
        )}
      </AdminDialog>
    </div>
  );
};

export default AdminQuestionConceptsPanel;
