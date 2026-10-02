import React from 'react';
import { PageHeader } from '../components/shared/PageHeader';
import { PendingBackendState } from '../components/shared/PendingBackendState';

/** Fallback route shell — no mock metrics. */
export const AdminPlaceholderPage = ({ title = 'Admin', description }) => (
  <div className="admin-page">
    <PageHeader title={title} description={description || 'This module is not fully wired yet.'} />
    <PendingBackendState />
  </div>
);

export default AdminPlaceholderPage;
