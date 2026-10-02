import React from 'react';

/** Lightweight page skeleton for admin route loads. */
export const PageSkeleton = ({ variant = 'table' }) => {
  if (variant === 'cards') {
    return (
      <div className="admin-page-skel" aria-busy="true" aria-label="Loading">
        <div className="admin-skel admin-skel--header" />
        <div className="admin-stat-row admin-stat-row--4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="admin-skel admin-skel--stat" />
          ))}
        </div>
        <div className="admin-skel-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="admin-skel admin-skel--card" />
          ))}
        </div>
      </div>
    );
  }

  if (variant === 'form') {
    return (
      <div className="admin-page-skel" aria-busy="true" aria-label="Loading">
        <div className="admin-skel admin-skel--header" />
        <div className="admin-skel admin-skel--form" />
      </div>
    );
  }

  return (
    <div className="admin-page-skel" aria-busy="true" aria-label="Loading">
      <div className="admin-skel admin-skel--header" />
      <div className="admin-skel admin-skel--filters" />
      <div className="admin-skel admin-skel--table" />
    </div>
  );
};

export default PageSkeleton;
