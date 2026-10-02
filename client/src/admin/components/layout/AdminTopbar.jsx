import React, { useContext, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, LogOut, Search, UserRound } from 'lucide-react';
import { AuthContext } from '../../../context/AuthContext';
import { ADMIN_NAV } from '../../lib/adminNav';

export const AdminTopbar = ({ searchQuery, onSearchChange }) => {
  const { user, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const current = ADMIN_NAV.find((item) =>
    item.end ? pathname === item.path : pathname.startsWith(item.path),
  );

  const initials = user?.role === 'admin'
    ? 'A'
    : String(user?.name || 'A')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('') || 'A';

  useEffect(() => {
    const onDocClick = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <header className="admin-topbar">
      <div className="admin-topbar-left">
        <div className="admin-topbar-titles">
          <p className="admin-topbar-kicker">VFSTR.AI Admin</p>
          <h2>{current?.label || 'Admin'}</h2>
        </div>
      </div>

      <div className="admin-topbar-center">
        <label className="admin-search" htmlFor="admin-global-search">
          <Search size={16} strokeWidth={2} aria-hidden="true" />
          <input
            id="admin-global-search"
            type="search"
            placeholder="Search users, interviews, questions…"
            value={searchQuery}
            onChange={(e) => onSearchChange?.(e.target.value)}
          />
        </label>
      </div>

      <div className="admin-topbar-right">
        <div className="admin-menu-wrap" ref={menuRef}>
          <button
            type="button"
            className="admin-avatar-btn"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => {
              setMenuOpen((v) => !v);
            }}
          >
            <span className="admin-user-avatar admin-user-avatar--sm">{initials}</span>
            <span className="admin-avatar-meta">
              <strong>{user?.name?.split(' ')[0] || 'Admin'}</strong>
              <em>Administrator</em>
            </span>
            <ChevronDown size={15} aria-hidden="true" />
          </button>
          {menuOpen && (
            <div className="admin-dropdown" role="menu">
              <button
                type="button"
                className="admin-dropdown-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  navigate('/');
                }}
              >
                <UserRound size={15} />
                Profile
              </button>
              <button
                type="button"
                className="admin-dropdown-item admin-dropdown-item--danger"
                role="menuitem"
                onClick={handleLogout}
              >
                <LogOut size={15} />
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
