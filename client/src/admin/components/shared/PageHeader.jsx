import React from 'react';

/**
 * @param {{ title: string, description?: string, actions?: React.ReactNode, eyebrow?: string }} props
 */
export const PageHeader = ({ eyebrow = 'VFSTR.AI Admin', title, description, actions }) => (
  <header className="admin-page-header">
    <div className="admin-page-header-copy">
      <p className="admin-page-eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {description ? <p className="admin-page-desc">{description}</p> : null}
    </div>
    {actions ? <div className="admin-page-header-actions">{actions}</div> : null}
  </header>
);
