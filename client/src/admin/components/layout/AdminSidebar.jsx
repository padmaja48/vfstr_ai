import React, { useContext, useMemo } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LogOut, PanelLeftClose } from 'lucide-react';
import { AuthContext } from '../../../context/AuthContext';
import { getAdminNavSections } from '../../lib/adminNav';
import { adminRoleLabel } from '../../lib/adminAuth';
import { BrandLogo } from '../../../components/BrandLogo';

export const AdminSidebar = ({ collapsed }) => {
  const { user, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const sections = useMemo(() => getAdminNavSections(user), [user]);

  const initial = String(user?.name || 'Admin').trim().charAt(0).toUpperCase() || 'A';

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <aside className={`admin-sidebar${collapsed ? ' is-collapsed' : ''}`}>
      <div className="admin-brand-row">
        <div className="admin-brand">
          <BrandLogo variant="admin" collapsed={collapsed} />
        </div>
      </div>

      {!collapsed ? (
        <div className="admin-user-chip">
          <span className="admin-user-avatar" aria-hidden="true">
            <span className="admin-user-avatar__initial">{initial}</span>
          </span>
          <div className="admin-user-chip-meta">
            <strong title={user?.name}>{user?.name || 'Admin'}</strong>
            <span>{adminRoleLabel(user)}{user?.institution ? ` · ${user.institution}` : ''}</span>
          </div>
        </div>
      ) : (
        <div className="admin-user-chip admin-user-chip--collapsed" title={user?.name || 'Admin'}>
          <span className="admin-user-avatar" aria-hidden="true">
            <span className="admin-user-avatar__initial">{initial}</span>
          </span>
        </div>
      )}

      <nav className="admin-nav" aria-label="Admin">
        {sections.map((section) => (
          <div key={section.title} className="admin-nav-section">
            {!collapsed && <p className="admin-nav-section-title">{section.title}</p>}
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={Boolean(item.end)}
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) => `admin-nav-link${isActive ? ' is-active' : ''}`}
                >
                  <Icon size={18} strokeWidth={2} className="admin-nav-icon" aria-hidden="true" />
                  {!collapsed && <span>{item.label}</span>}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="admin-sidebar-footer">
        <NavLink to="/" className="admin-nav-link admin-nav-link--muted" title="Back to VFSTR.AI">
          <PanelLeftClose size={18} strokeWidth={2} aria-hidden="true" />
          {!collapsed && <span>Back to VFSTR.AI</span>}
        </NavLink>
        <button
          type="button"
          className="admin-logout-btn"
          onClick={handleLogout}
          title="Sign out"
        >
          <LogOut size={16} strokeWidth={2} aria-hidden="true" />
          {!collapsed && <span>Sign out</span>}
        </button>
      </div>
    </aside>
  );
};
