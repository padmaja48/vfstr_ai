import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminLayout } from './components/layout/AdminLayout';
import { SuperAdminRoute } from './components/layout/SuperAdminRoute';
import { AdminDashboard } from './pages/AdminDashboard';
import { AdminUsers } from './pages/AdminUsers';
import { AdminInterviews } from './pages/AdminInterviews';
import { AdminInterviewDetail } from './pages/AdminInterviewDetail';
import { AdminQuestionBank } from './pages/AdminQuestionBank';
import { AdminResumeAnalysis } from './pages/AdminResumeAnalysis';
import { AdminResumeDetail } from './pages/AdminResumeDetail';
import { AdminPerformance } from './pages/AdminPerformance';
import { AdminInstitutions } from './pages/AdminInstitutions';
import { AdminInstitutionDetail } from './pages/AdminInstitutionDetail';
import { AdminCandidate360 } from './pages/AdminCandidate360';
import { AdminSettings } from './pages/AdminSettings';
import { AdminNotFound } from './pages/AdminNotFound';
import './styles/admin.css';

const SuperOnly = ({ children }) => <SuperAdminRoute>{children}</SuperAdminRoute>;

export const AdminApp = () => (
  <Routes>
    <Route element={<AdminLayout />}>
      <Route index element={<Navigate to="dashboard" replace />} />
      <Route path="dashboard" element={<AdminDashboard />} />
      <Route path="users" element={<AdminUsers />} />
      <Route path="candidates/:id/360" element={<AdminCandidate360 />} />
      <Route path="interviews" element={<AdminInterviews />} />
      <Route path="interviews/:id" element={<AdminInterviewDetail />} />
      <Route path="resume-analysis" element={<AdminResumeAnalysis />} />
      <Route path="resume-analysis/:id" element={<AdminResumeDetail />} />
      <Route path="performance" element={<AdminPerformance />} />
      <Route path="settings" element={<SuperOnly><AdminSettings /></SuperOnly>} />
      <Route path="question-bank" element={<SuperOnly><AdminQuestionBank /></SuperOnly>} />
      <Route path="institutions" element={<SuperOnly><AdminInstitutions /></SuperOnly>} />
      <Route path="institutions/:id" element={<SuperOnly><AdminInstitutionDetail /></SuperOnly>} />
      <Route path="*" element={<AdminNotFound />} />
    </Route>
  </Routes>
);

export default AdminApp;
