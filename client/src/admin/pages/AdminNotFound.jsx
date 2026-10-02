import React from 'react';
import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { EmptyState } from '../components/shared/EmptyState';

/** Admin 404 — cream surface, teal accents. */
export const AdminNotFound = () => (
  <div className="admin-page admin-not-found">
    <EmptyState
      icon={Compass}
      title="Page not found"
      description="That admin route doesn’t exist. Head back to the dashboard or pick a module from the sidebar."
      action={(
        <Link to="/admin/dashboard" className="admin-btn admin-btn--primary">
          Go to dashboard
        </Link>
      )}
    />
  </div>
);

export default AdminNotFound;
