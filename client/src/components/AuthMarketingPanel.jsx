import React from 'react';

const BadgeIconAi = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="8" width="18" height="12" rx="2" />
    <path d="M12 8V5" />
    <circle cx="12" cy="4" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="8" cy="14" r="1" fill="currentColor" stroke="none" />
    <circle cx="16" cy="14" r="1" fill="currentColor" stroke="none" />
  </svg>
);

const BadgeIconChart = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </svg>
);

const FeatureTarget = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
  </svg>
);

const FeatureChart = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </svg>
);

const FeatureShield = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path
      d="M12 7.5l.95 1.92 2.12.31-1.53 1.49.36 2.11L12 12.9l-1.9 1 .36-2.11-1.53-1.49 2.12-.31L12 7.5z"
      fill="currentColor"
      stroke="none"
    />
  </svg>
);

export const AuthMarketingPanel = () => (
  <section className="auth-visual" aria-label="VFSTR.AI preview">
    <div className="auth-visual-shell">
      <div className="auth-visual-body">
        <div className="auth-visual-badges">
          <span className="auth-visual-badge">
            <BadgeIconAi />
            VFSTR.AI interviews
          </span>
          <span className="auth-visual-badge">
            <BadgeIconChart />
            Instant scorecards
          </span>
        </div>

        <h2>
          VFSTR.AI interviews that feel{' '}
          <span className="auth-visual-highlight">real.</span>
        </h2>
        <p>
          Company-style mock sessions with structured scoring and clear feedback —
          so every attempt on VFSTR.AI helps you improve.
        </p>
      </div>

      <div className="auth-visual-features" aria-label="VFSTR.AI highlights">
        <div className="auth-visual-feature">
          <span className="auth-visual-feature-icon"><FeatureTarget /></span>
          <div className="auth-visual-feature-copy">
            <strong>Realistic Experience</strong>
            <span>Company-style questions in a live interview setting.</span>
          </div>
        </div>
        <div className="auth-visual-feature">
          <span className="auth-visual-feature-icon"><FeatureChart /></span>
          <div className="auth-visual-feature-copy">
            <strong>Smart Feedback</strong>
            <span>Actionable insights after every VFSTR.AI session.</span>
          </div>
        </div>
        <div className="auth-visual-feature">
          <span className="auth-visual-feature-icon"><FeatureShield /></span>
          <div className="auth-visual-feature-copy">
            <strong>Track Progress</strong>
            <span>Monitor scores and build interview confidence.</span>
          </div>
        </div>
      </div>
    </div>
  </section>
);

export default AuthMarketingPanel;
