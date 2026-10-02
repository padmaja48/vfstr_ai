import React from 'react';
import { PageHeader } from '../components/shared/PageHeader';
import { PendingBackendState } from '../components/shared/PendingBackendState';
import { adminAIConfigService } from '../services/adminApi';

void adminAIConfigService;

export const AdminAIConfiguration = () => (
  <div className="admin-page">
    <PageHeader
      title="AI Configuration"
      description="Model settings, evaluation weights, prompts, and guardrails."
    />
    <PendingBackendState
      title="Pending backend support"
      description="AI configuration and prompt versioning are not exposed via admin APIs yet. Runtime AI still uses server env / service defaults."
      feature="AI Configuration"
    />
  </div>
);

export default AdminAIConfiguration;
