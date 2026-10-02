import React from 'react';
import { Inbox } from 'lucide-react';

/**
 * Shared empty state — teal icon, short copy, optional CTA.
 * @param {{ title?: string, description?: string, action?: React.ReactNode, icon?: React.ComponentType, compact?: boolean }} props
 */
export const EmptyState = ({
  title = 'Nothing here yet',
  description,
  action,
  icon: Icon = Inbox,
  compact = false,
}) => (
  <div className={`admin-empty-state admin-card${compact ? ' admin-empty-state--compact' : ''}`}>
    <span className="admin-empty-icon" aria-hidden="true">
      <Icon size={compact ? 22 : 28} strokeWidth={2} />
    </span>
    <h2>{title}</h2>
    <p>{description || 'Try adjusting filters or check back after new activity.'}</p>
    {action ? <div className="admin-empty-actions">{action}</div> : null}
  </div>
);

export default EmptyState;
