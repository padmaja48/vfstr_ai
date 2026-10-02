import React, { useContext } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { AuthContext } from '../../../context/AuthContext';
import { isAdminUser } from '../../lib/adminAuth';

/** Gates /admin/* behind auth + isAdmin. */
export const AdminRoute = ({ children }) => {
  const { authenticated, user, initializing } = useContext(AuthContext);
  const location = useLocation();

  if (initializing) {
    return <div className="admin-boot">Loading admin…</div>;
  }

  if (!authenticated) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }

  if (user?.requiresAccountSetup) {
    return <Navigate to="/" replace state={{ from: location.pathname, accountSetupRequired: true }} />;
  }

  if (!isAdminUser(user)) {
    return (
      <div className="admin-denied">
        <div className="admin-denied-card">
          <h1>Admin access required</h1>
          <p>
            This area is limited to Super Admin or Institution Admin accounts.
            Your current role is <strong>{user?.role || 'unknown'}</strong>.
          </p>
          {import.meta.env.DEV ? (
            <p className="admin-denied-hint">
              Development only: set <code>localStorage.fluentai.forceAdmin = &quot;true&quot;</code> then refresh,
              or update the user role in MongoDB.
            </p>
          ) : null}
          <Link className="admin-denied-link" to="/">Return to VFSTR.AI</Link>
        </div>
      </div>
    );
  }

  return children;
};
