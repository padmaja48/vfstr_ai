import React, { useContext } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AuthContext } from '../../../context/AuthContext';
import { isAdminUser, isSuperAdmin, isSuperAdminOnlyPath } from '../../lib/adminAuth';

/** Redirects institution admins away from super-admin-only routes. */
export const SuperAdminRoute = ({ children }) => {
  const { user } = useContext(AuthContext);
  const location = useLocation();

  if (!isAdminUser(user)) {
    return <Navigate to="/" replace />;
  }

  if (!isSuperAdmin(user) && isSuperAdminOnlyPath(location.pathname)) {
    return <Navigate to="/admin/dashboard" replace state={{ forbidden: true }} />;
  }

  return children;
};
