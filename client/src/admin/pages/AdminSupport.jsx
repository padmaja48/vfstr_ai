import React from 'react';
import { PageHeader } from '../components/shared/PageHeader';
import { PendingBackendState } from '../components/shared/PendingBackendState';
import { adminSupportService } from '../services/adminApi';

void adminSupportService;

export const AdminSupport = () => (
  <div className="admin-page">
    <PageHeader
      title="Support"
      description="Ticket queue and conversation threads."
    />
    <PendingBackendState
      title="Pending backend support"
      description="Support tickets are not modeled or exposed by the API yet."
      feature="Support tickets"
    />
  </div>
);

export default AdminSupport;
