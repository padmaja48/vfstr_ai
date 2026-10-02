import React from 'react';
import { PageHeader } from '../components/shared/PageHeader';
import { PendingBackendState } from '../components/shared/PendingBackendState';
import { adminSubscriptionsService } from '../services/adminApi';

void adminSubscriptionsService;

export const AdminSubscriptions = () => (
  <div className="admin-page">
    <PageHeader
      title="Subscriptions"
      description="Plans, subscribers, and billing history."
    />
    <PendingBackendState
      title="Pending backend support"
      description="No plans, subscribers, or billing transaction APIs exist on this platform yet."
      feature="Subscriptions / Billing"
    />
  </div>
);

export default AdminSubscriptions;
