import React, { useCallback, useEffect, useState } from 'react';
import { Check, Play, RefreshCw, Trash2, X } from 'lucide-react';
import { AdminDialog } from '../components/shared/AdminDialog';
import { PageSkeleton } from '../components/shared/PageSkeleton';
import { AdminQueryError } from '../components/shared/PendingBackendState';
import { adminQuestionConceptsService } from '../services/adminApi';
import { useToast } from '../../context/ToastContext';
import { isValidConceptId, resolveConceptId } from '../utils/conceptId';

const GENRE_LABELS = {
  product_tech: 'Product-based Tech',
  it_services: 'IT Services / Consulting',
  strategy_consulting: 'Strategy Consulting (MBB-style)',
  fintech: 'Fintech & Banking',
  core_engineering: 'Core Engineering / Manufacturing',
};

export const AdminConceptGenerationPanel = () => {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [batches, setBatches] = useState([]);
  const [reviewGroups, setReviewGroups] = useState([]);
  const [totalPending, setTotalPending] = useState(0);
  const [starting, setStarting] = useState(false);
  const [fullBatchConfirmOpen, setFullBatchConfirmOpen] = useState(false);
  const [activeBatchId, setActiveBatchId] = useState('');
  const [editTarget, setEditTarget] = useState(null);
  const [editingConceptId, setEditingConceptId] = useState('');
  const [editLabel, setEditLabel] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const closeEditDialog = () => {
    setEditTarget(null);
    setEditingConceptId('');
    setEditLabel('');
  };

  const openEditDialog = (concept) => {
    const conceptId = resolveConceptId(concept);
    if (!isValidConceptId(conceptId)) {
      toast.error('This concept is missing a valid id. Refresh and try again.');
      return;
    }
    setEditTarget(concept);
    setEditingConceptId(conceptId);
    setEditLabel(concept.conceptLabel || '');
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [batchPayload, reviewPayload] = await Promise.all([
        adminQuestionConceptsService.listGenerationBatches(),
        adminQuestionConceptsService.reviewQueue(activeBatchId ? { batchId: activeBatchId } : {}),
      ]);
      setBatches(batchPayload.batches || []);
      setReviewGroups(reviewPayload.groups || []);
      setTotalPending(reviewPayload.totalPending || 0);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [activeBatchId]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 8000);
    return () => clearInterval(timer);
  }, [load]);

  const startPilot = async () => {
    setStarting(true);
    try {
      const payload = await adminQuestionConceptsService.startGenerationBatch({ scope: 'pilot' });
      toast.success('Pilot generation batch queued (5 companies).', { className: 'app-toast--teal' });
      if (payload.batch?.id) setActiveBatchId(payload.batch.id);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Could not start pilot batch.');
    } finally {
      setStarting(false);
    }
  };

  const startFullBatch = async () => {
    setFullBatchConfirmOpen(false);
    setStarting(true);
    try {
      const payload = await adminQuestionConceptsService.startGenerationBatch({ scope: 'full' });
      const count = payload.batch?.totalCompanies ?? payload.batch?.companySlugs?.length ?? 0;
      toast.success(`Full generation batch queued (${count} companies).`, { className: 'app-toast--teal' });
      if (payload.batch?.id) setActiveBatchId(payload.batch.id);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Could not start full batch.');
    } finally {
      setStarting(false);
    }
  };

  const startRoleBatch = async () => {
    setStarting(true);
    try {
      const payload = await adminQuestionConceptsService.startGenerationBatch({
        scope: 'custom',
        targetType: 'role',
        roleKeys: ['sde', 'data_analyst', 'ai_ml', 'frontend', 'backend', 'qa', 'hr_behavioral'],
      });
      toast.success('Role generation batch queued (7 roles, 50 concepts each).', { className: 'app-toast--teal' });
      if (payload.batch?.id) setActiveBatchId(payload.batch.id);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Could not start role batch.');
    } finally {
      setStarting(false);
    }
  };

  const bulkApproveCompany = async (group) => {
    if (group.roleApprovalBlocked) {
      toast.error(group.roleApprovalBlockReason || 'This role pool cannot be approved yet.');
      return;
    }
    try {
      const result = await adminQuestionConceptsService.approve({
        ...(group.role ? { role: group.role } : { companySlug: group.companySlug }),
        batchId: group.batchId,
      });
      toast.success(`Approved ${result.approvedCount || 0} concepts for ${group.role || group.companySlug}.`);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Approve failed.');
    }
  };

  const discardConcept = async (concept) => {
    const conceptId = resolveConceptId(concept);
    if (!isValidConceptId(conceptId)) {
      toast.error('Cannot discard: concept id is missing.');
      return;
    }
    try {
      await adminQuestionConceptsService.discard({ conceptIds: [conceptId] });
      toast.success('Concept discarded.');
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Discard failed.');
    }
  };

  const saveEdit = async () => {
    if (!isValidConceptId(editingConceptId) || editLabel.trim().length < 8) {
      toast.error('Concept label must be at least 8 characters.');
      return;
    }
    setSavingEdit(true);
    try {
      await adminQuestionConceptsService.update(editingConceptId, { conceptLabel: editLabel.trim() });
      toast.success('Concept updated.');
      closeEditDialog();
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Update failed.');
    } finally {
      setSavingEdit(false);
    }
  };

  if (loading && !reviewGroups.length && !batches.length) return <PageSkeleton rows={6} />;
  if (error) return <AdminQueryError error={error} onRetry={load} />;

  return (
    <div className="admin-concept-generation-panel">
      <div className="admin-toolbar admin-toolbar--wrap">
        <button type="button" className="admin-btn admin-btn--primary" disabled={starting} onClick={startPilot}>
          <Play size={15} /> {starting ? 'Starting…' : 'Run pilot batch (5 companies)'}
        </button>
        <button
          type="button"
          className="admin-btn admin-btn--ghost"
          disabled={starting}
          onClick={() => setFullBatchConfirmOpen(true)}
        >
          <Play size={15} /> Run full batch (100 companies)
        </button>
        <button type="button" className="admin-btn admin-btn--ghost" disabled={starting} onClick={startRoleBatch}>
          <Play size={15} /> {starting ? 'Starting…' : 'Generate 7 role pools'}
        </button>
        <button type="button" className="admin-btn admin-btn--ghost" onClick={load}>
          <RefreshCw size={15} /> Refresh
        </button>
        <select value={activeBatchId} onChange={(e) => setActiveBatchId(e.target.value)} className="admin-input">
          <option value="">All pending review batches</option>
          {batches.map((batch) => (
            <option key={batch.id} value={batch.id}>
              {batch.scope} · {batch.status} · {batch.completedCompanies}/{batch.totalCompanies}
            </option>
          ))}
        </select>
      </div>

      {batches.length ? (
        <div className="admin-card admin-qb-pool-summaries">
          <h3>Generation batches</h3>
          <div className="admin-qb-pool-grid">
            {batches.slice(0, 6).map((batch) => (
              <div
                key={batch.id}
                className={`admin-qb-pool-card admin-qb-pool-card--${
                  batch.status === 'completed'
                    ? 'in_range'
                    : batch.status === 'partial' || batch.partialTargets?.length
                    ? 'partial'
                    : batch.status === 'failed' || batch.failedCompanies?.length
                    ? 'under'
                    : 'over'
                }`}
              >
                <strong>{batch.scope} batch</strong>
                <span>
                  {batch.completedCompanies}/{batch.totalCompanies}{' '}
                  {batch.targetType === 'role' ? 'roles' : 'companies'} · {batch.status}
                  {batch.partialTargets?.length ? ` · ${batch.partialTargets.length} partial` : ''}
                </span>
                {batch.partialTargets?.length ? (
                  <ul className="admin-batch-failures admin-batch-failures--partial">
                    {batch.partialTargets.map((partial) => (
                      <li key={`${batch.id}-${partial.companySlug}-partial`}>
                        <strong>{partial.companyLabel || partial.companySlug}</strong>
                        <span>{partial.message}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {batch.failedCompanies?.length ? (
                  <ul className="admin-batch-failures">
                    {batch.failedCompanies.map((failure) => (
                      <li key={`${batch.id}-${failure.companySlug}`}>
                        <strong>{failure.companyLabel || failure.companySlug}</strong>
                        <span>{failure.error}</span>
                      </li>
                    ))}
                  </ul>
                ) : batch.partialTargets?.length ? null : (
                  <em>No failures</em>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <p className="admin-muted">{totalPending} concept(s) awaiting review</p>

      {reviewGroups.length ? reviewGroups.map((group) => (
        <section
          key={`${group.role || group.companySlug}:${group.batchId || 'none'}`}
          className={`admin-card admin-concept-review-group${group.isPartialGeneration ? ' admin-concept-review-group--partial' : ''}`}
        >
          <div className="admin-table-card-head">
            <div>
              <h3>
                {group.role || group.companySlug}
                {group.isPartialGeneration ? (
                  <span className="admin-pill admin-pill--ntf-partial">Partial generation</span>
                ) : null}
              </h3>
              <p>
                {group.role ? 'Generic role pool' : GENRE_LABELS[group.genre] || group.genre || 'Unknown genre'} · tier {group.tier}
                {group.batchId ? ` · batch ${group.batchId.slice(-6)}` : ''}
                {group.isPartialGeneration ? ` · ${group.actualConceptCount}/${group.expectedConceptCount ?? 50} concepts saved` : ''}
              </p>
              {group.isPartialGeneration ? (
                <p className="admin-qb-dup-warn">
                  {group.partialMessage || 'This role pool is incomplete and needs a re-run before approval.'}
                </p>
              ) : null}
              {group.roleApprovalBlocked && group.roleApprovalBlockReason ? (
                <p className="admin-qb-dup-warn">
                  Approval blocked: {group.roleApprovalBlockReason}
                </p>
              ) : null}
              {group.preservedManualEdits?.length ? (
                <p className="admin-qb-dup-warn">
                  {group.preservedManualEdits.length} manually-edited concept(s) from a prior batch were kept active — review before discarding.
                </p>
              ) : null}
            </div>
            <button
              type="button"
              className={`admin-btn admin-btn--primary${group.roleApprovalBlocked ? ' admin-btn--disabled' : ''}`}
              disabled={group.roleApprovalBlocked}
              aria-disabled={group.roleApprovalBlocked}
              title={group.roleApprovalBlockReason || (group.roleApprovalBlocked ? 'This role pool cannot be approved yet' : undefined)}
              onClick={() => bulkApproveCompany(group)}
            >
              <Check size={15} /> Bulk approve {group.role ? 'role' : 'company'}
            </button>
          </div>
          <ul className="admin-concept-review-list">
            {group.concepts.map((concept) => (
              <li key={concept.id}>
                <div>
                  <strong>{concept.category}</strong>
                  <span className="admin-pill admin-pill--muted">{concept.specificity || 'mixed'}</span>
                  {concept.isTemplatedFallback ? (
                    <span className="admin-pill admin-pill--ntf-partial">Templated padding</span>
                  ) : null}
                  <p>{concept.conceptLabel}</p>
                </div>
                <div className="admin-row-actions">
                  <button type="button" className="admin-icon-btn" title="Edit" onClick={() => openEditDialog(concept)}>
                    Edit
                  </button>
                  <button type="button" className="admin-icon-btn admin-icon-btn--danger" title="Discard" onClick={() => discardConcept(concept)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )) : (
        <p className="admin-muted">No pending concepts. Run the pilot batch to generate a starter set for manual review.</p>
      )}

      <AdminDialog
        open={fullBatchConfirmOpen}
        title="Run full catalog batch?"
        description="This will generate concepts for ~95 companies — this may take a while and use AI credits. Continue?"
        onClose={() => setFullBatchConfirmOpen(false)}
        footer={(
          <>
            <button type="button" className="admin-btn admin-btn--ghost" onClick={() => setFullBatchConfirmOpen(false)}>
              Cancel
            </button>
            <button type="button" className="admin-btn admin-btn--primary" disabled={starting} onClick={startFullBatch}>
              {starting ? 'Starting…' : 'Continue'}
            </button>
          </>
        )}
      />

      <AdminDialog
        open={Boolean(editTarget)}
        title="Edit concept label"
        onClose={closeEditDialog}
        footer={(
          <>
            <button type="button" className="admin-btn admin-btn--ghost" onClick={closeEditDialog}>
              <X size={15} /> Cancel
            </button>
            <button type="button" className="admin-btn admin-btn--primary" disabled={savingEdit} onClick={saveEdit}>
              {savingEdit ? 'Saving…' : 'Save'}
            </button>
          </>
        )}
      >
        {editTarget ? (
          <p className="admin-muted admin-form-span">
            {editTarget.companySlug} · {editTarget.category} · {editTarget.tier} · {editTarget.status}
          </p>
        ) : null}
        <label className="admin-form-span">
          <span>Concept label</span>
          <textarea rows={3} value={editLabel} onChange={(e) => setEditLabel(e.target.value)} />
        </label>
      </AdminDialog>
    </div>
  );
};

export default AdminConceptGenerationPanel;
