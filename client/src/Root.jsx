import React from 'react';
import { Route, Routes } from 'react-router-dom';
import { App as StudentApp } from './components/App';
import { AdminApp } from './admin/AdminApp';
import { AdminRoute } from './admin/components/layout/AdminRoute';

/**
 * Top-level router:
 * - /admin/* → isolated admin shell (gated)
 * - everything else → existing student interview app (unchanged UI)
 */
export const Root = () => (
  <Routes>
    <Route
      path="/admin/*"
      element={(
        <AdminRoute>
          <AdminApp />
        </AdminRoute>
      )}
    />
    <Route path="/*" element={<StudentApp />} />
  </Routes>
);

export default Root;
