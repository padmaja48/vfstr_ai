import React from 'react';
import { Construction, RefreshCw } from 'lucide-react';
import { EmptyState } from './EmptyState';

/** Shown when a module has no real backend endpoint yet (never use fake data). */
export const PendingBackendState = ({
  title = 'Pending backend support',
  description = 'This admin module is ready in the UI, but the platform API for it does not exist yet. No placeholder data is shown.',
  feature,
}) => (
  <EmptyState
    icon={Construction}
    title={title}
    description={
      feature
        ? `${description} Feature: ${feature}.`
        : description
    }
  />
);

/** Shared error retry block for admin fetches. */
export const AdminQueryError = ({ error, onRetry, title = 'Could not load data' }) => {
  if (error?.code === 'PENDING_BACKEND') {
    return <PendingBackendState feature={error.feature || error.message} />;
  }
  return (
    <EmptyState
      title={title}
      description={error?.response?.data?.message || error?.message || 'Something went wrong talking to the API.'}
      action={onRetry ? (
        <button type="button" className="admin-btn admin-btn--primary" onClick={onRetry}>
          <RefreshCw size={15} />
          Retry
        </button>
      ) : null}
    />
  );
};

export default PendingBackendState;
