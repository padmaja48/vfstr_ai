import React, { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AdminSidebar } from './AdminSidebar';
import { AdminTopbar } from './AdminTopbar';

const COLLAPSE_KEY = 'fluentai.adminSidebarCollapsed';

export const AdminLayout = () => {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [routeLoading, setRouteLoading] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1024px)');
    const sync = () => {
      if (mq.matches) setCollapsed(true);
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, String(collapsed));
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  useEffect(() => {
    setRouteLoading(true);
    const t = window.setTimeout(() => setRouteLoading(false), 280);
    return () => window.clearTimeout(t);
  }, [location.pathname]);

  return (
    <div
      className={`admin-shell${collapsed ? ' admin-shell--collapsed' : ''}`}
      data-admin-theme="light"
    >
      <AdminSidebar collapsed={collapsed} />
      <button
        type="button"
        className="admin-sidebar-toggle"
        onClick={() => setCollapsed((v) => !v)}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!collapsed}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <span className="admin-sidebar-toggle__icon" aria-hidden="true">
          {collapsed ? '›' : '‹'}
        </span>
      </button>
      <div className="admin-main">
        <AdminTopbar searchQuery={searchQuery} onSearchChange={setSearchQuery} />
        <main className="admin-content">
          <div className="admin-content-inner">
            {routeLoading ? (
              <div className="admin-route-loader" aria-busy="true" aria-label="Loading page">
                <span className="admin-spinner" />
                <p>Loading…</p>
              </div>
            ) : (
              <Outlet context={{ searchQuery }} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
};
