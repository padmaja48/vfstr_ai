import React, { useEffect, useState } from 'react';
import { AdminDialog } from './AdminDialog';
import { adminInstitutionsService } from '../../services/adminApi';
import { useToast } from '../../../context/ToastContext';

/**
 * Super-admin archive (soft delete) for a catalog institution.
 */
export const InstitutionArchiveDialog = ({
  target,
  onClose,
  onArchived,
}) => {
  const toast = useToast();
  const [impact, setImpact] = useState(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);

  const institutionId = target?.catalogId || target?.id || null;
  const institutionName = target?.name || impact?.institution?.name || '';

  useEffect(() => {
    if (!institutionId) {
      setImpact(null);
      setConfirmName('');
      return undefined;
    }

    let cancelled = false;
    setImpact(null);
    setConfirmName('');
    setImpactLoading(true);

    adminInstitutionsService.deletionImpact(institutionId)
      .then((data) => {
        if (!cancelled) setImpact(data);
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error(err?.response?.data?.message || err?.message || 'Could not load institution details.');
          onClose?.();
        }
      })
      .finally(() => {
        if (!cancelled) setImpactLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [institutionId, toast]);

  const confirmArchive = async () => {
    if (!institutionId) return;
    const expectedName = impact?.institution?.name || institutionName;
    if (confirmName.trim() !== expectedName) {
      toast.error('Type the exact institution name to confirm.');
      return;
    }

    setDeleting(true);
    try {
      await adminInstitutionsService.archive(institutionId, {
        confirmName: confirmName.trim(),
      });
      toast.success(`${expectedName} archived. Student and interview history is preserved.`, {
        className: 'app-toast--teal',
      });
      onClose?.();
      await onArchived?.();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Could not archive institution.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AdminDialog
      open={Boolean(target && institutionId)}
      title="Archive institution?"
      description={
        institutionName
          ? `This archives "${impact?.institution?.name || institutionName}" — it will be hidden from active institution lists and import pickers. Linked student and interview history stays intact.`
          : 'Confirm archive.'
      }
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="admin-btn admin-btn--ghost" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="admin-btn admin-btn--danger"
            disabled={
              deleting
              || impactLoading
              || confirmName.trim() !== (impact?.institution?.name || institutionName)
            }
            onClick={confirmArchive}
          >
            {deleting ? 'Archiving…' : 'Archive institution'}
          </button>
        </>
      )}
    >
      {impactLoading ? (
        <p className="admin-muted">Loading linked account counts…</p>
      ) : impact ? (
        <>
          <ul className="admin-delete-impact-list">
            <li><strong>{impact.studentCount}</strong> linked student{impact.studentCount === 1 ? '' : 's'}</li>
            <li><strong>{impact.interviewCount}</strong> linked interview{impact.interviewCount === 1 ? '' : 's'}</li>
            <li><strong>{impact.adminCount}</strong> institution admin{impact.adminCount === 1 ? '' : 's'}</li>
          </ul>
          {(impact.studentCount > 0 || impact.interviewCount > 0) ? (
            <p className="admin-import-warning" role="alert">
              This institution has live student and/or interview data. Archiving hides it from active workflows but does not delete historical records.
            </p>
          ) : (
            <p className="admin-muted">No linked students or interviews were found for this institution record.</p>
          )}
          <label>
            <span>Type <strong>{impact.institution?.name || institutionName}</strong> to confirm</span>
            <input
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder="Institution name"
              autoComplete="off"
            />
          </label>
        </>
      ) : null}
    </AdminDialog>
  );
};
