import React from 'react';
import '../styles/BrandLogo.css';

/**
 * VFSTR.AI brand mark — text wordmark (no ProGrow / FluentAI assets).
 * @param {{ variant?: 'sidebar' | 'auth' | 'admin', collapsed?: boolean, className?: string }} props
 */
export const BrandLogo = ({ variant = 'auth', collapsed = false, className = '' }) => (
  <div
    className={[
      'brand-logo',
      `brand-logo--${variant}`,
      collapsed ? 'brand-logo--collapsed' : '',
      className,
    ].filter(Boolean).join(' ')}
    role="img"
    aria-label="VFSTR.AI"
  >
    <span className="brand-logo__mark" aria-hidden="true">VF</span>
    {!collapsed && (
      <span className="brand-logo__text">
        VFSTR<span className="brand-logo__dot">.AI</span>
      </span>
    )}
  </div>
);

export default BrandLogo;
