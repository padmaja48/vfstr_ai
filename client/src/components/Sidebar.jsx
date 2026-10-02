import React from 'react';
import { BrandLogo } from './BrandLogo';
import '../styles/Sidebar.css';

const Icons = {
  dashboard: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
  ),
  profile: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>
    </svg>
  ),
  interview: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
    </svg>
  ),
  results: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  ),
  logout: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  ),
};

const navItems = [
  { id: 'dashboard', label: 'Home', icon: Icons.dashboard },
  { id: 'interview', label: 'Interview', icon: Icons.interview },
  { id: 'results', label: 'Reports', icon: Icons.results },
  { id: 'profile', label: 'Account', icon: Icons.profile },
];

const initialsFor = (name = '') =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'U';

const formatSidebarName = (name = '') => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Candidate';
  if (parts.length === 1) {
    const only = parts[0];
    return only.charAt(0).toUpperCase() + only.slice(1).toLowerCase();
  }
  const full = parts.join(' ');
  if (full.length <= 24) return full;
  const first = parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase();
  const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
  return `${first} ${lastInitial}.`;
};

const Sidebar = ({ currentView, onViewChange, onLogout, user }) => (
  <header className="sidebar app-topnav">
    <div className="sidebar-top">
      <div className="sidebar-header">
        <BrandLogo variant="sidebar" />
      </div>
    </div>

    <nav className="sidebar-nav" aria-label="Primary">
      {navItems.map(({ id, icon, label }) => (
        <button
          key={id}
          type="button"
          className={`nav-item${currentView === id ? ' active' : ''}`}
          onClick={() => onViewChange(id)}
        >
          <span className="icon">{icon}</span>
          <span className="label">{label}</span>
        </button>
      ))}

      <button
        type="button"
        className="nav-item mobile-only-nav nav-logout"
        onClick={onLogout}
        aria-label="Sign out"
      >
        <span className="icon">{Icons.logout}</span>
        <span className="label">Sign out</span>
      </button>
    </nav>

    <div className="sidebar-footer">
      <div className="sidebar-user-card">
        <div className="sidebar-user-avatar">
          {user?.profileImageUrl ? <img src={user.profileImageUrl} alt="" /> : <span>{initialsFor(user?.name)}</span>}
        </div>
        <div className="sidebar-user-meta">
          <strong title={user?.name || 'Candidate'}>{formatSidebarName(user?.name)}</strong>
        </div>
      </div>
      <button type="button" className="logout-btn" onClick={onLogout}>
        <span className="icon">{Icons.logout}</span>
        Sign out
      </button>
    </div>
  </header>
);

export default Sidebar;
