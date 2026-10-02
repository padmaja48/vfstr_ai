import axios from 'axios';

const resolveApiBaseUrl = () => {
  if (typeof window !== 'undefined') {
    // Same-origin keeps httpOnly session cookies across reloads (Vite /api proxy in dev).
    return window.location.origin;
  }
  return (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/$/, '');
};

const rawApiUrl = resolveApiBaseUrl();
const API_BASE_URL = rawApiUrl.endsWith('/api') ? rawApiUrl : `${rawApiUrl}/api`;

const CSRF_COOKIE_NAME = 'fluentai_csrf';
const MUTATING_METHODS = new Set(['post', 'put', 'patch', 'delete']);

/** In-memory CSRF cache — fallback when cookie is not yet readable after login. */
let csrfTokenCache = '';
let csrfBootstrapPromise = null;

export const readCsrfTokenFromCookie = () => {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${CSRF_COOKIE_NAME}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : '';
};

export const setCsrfToken = (token) => {
  if (token) csrfTokenCache = token;
};

/** Prefer the cookie (server source of truth) over the in-memory cache. */
export const getCsrfToken = () => readCsrfTokenFromCookie() || csrfTokenCache;

const attachCsrfHeader = (config, token) => {
  if (!token) return config;
  config.headers = config.headers || {};
  config.headers['X-CSRF-Token'] = token;
  return config;
};

/** Fetch a fresh CSRF token from /auth/session when cookie/cache is missing or stale. */
const ensureCsrfToken = async () => {
  const existing = getCsrfToken();
  if (existing) return existing;

  if (!csrfBootstrapPromise) {
    csrfBootstrapPromise = api.get('/auth/session')
      .then((response) => {
        const token = response.data?.csrfToken || readCsrfTokenFromCookie();
        if (token) setCsrfToken(token);
        return token || '';
      })
      .finally(() => {
        csrfBootstrapPromise = null;
      });
  }
  return csrfBootstrapPromise;
};

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

api.interceptors.request.use(async (config) => {
  const method = String(config.method || 'get').toLowerCase();
  if (!MUTATING_METHODS.has(method)) return config;

  let csrf = getCsrfToken();
  if (!csrf) {
    csrf = await ensureCsrfToken();
  }
  return attachCsrfHeader(config, csrf);
});

api.interceptors.response.use(
  (response) => {
    if (response.data?.csrfToken) {
      setCsrfToken(response.data.csrfToken);
    }
    return response;
  },
  async (error) => {
    const originalRequest = error.config || {};
    const url = String(originalRequest.url || '');
    const isAuthBootstrap =
      /\/auth\/(session|profile|refresh|login|register|google)/i.test(url);
    const isAnonymousAuth =
      /\/auth\/(login|register|google|forgot-password|reset-password|verify-email)/i.test(url);

    if (error.response?.status === 401 && !originalRequest._retry && !isAnonymousAuth) {
      originalRequest._retry = true;
      try {
        const response = await axios.post(
          `${API_BASE_URL}/auth/refresh`,
          {},
          { withCredentials: true },
        );
        if (response.data?.csrfToken) {
          setCsrfToken(response.data.csrfToken);
        }
        const csrf = getCsrfToken();
        attachCsrfHeader(originalRequest, csrf);
        return api(originalRequest);
      } catch {
        try {
          window.dispatchEvent(new CustomEvent('fluentai:auth-expired', {
            detail: { silent: isAuthBootstrap },
          }));
        } catch { /* ignore */ }
      }
    }

    if (
      error.response?.status === 403
      && error.response?.data?.code === 'CSRF_INVALID'
      && !originalRequest._csrfRetry
      && !/\/auth\/session/i.test(url)
    ) {
      originalRequest._csrfRetry = true;
      try {
        const response = await api.get('/auth/session');
        const csrf = response.data?.csrfToken || readCsrfTokenFromCookie();
        if (csrf) {
          setCsrfToken(csrf);
          attachCsrfHeader(originalRequest, csrf);
          return api(originalRequest);
        }
      } catch {
        /* fall through */
      }
    }

    return Promise.reject(error);
  },
);

export const authAPI = {
  getSession: () => api.get('/auth/session'),
  register: (name, email, password) =>
    api.post('/auth/register', { name, email, password }),
  login: (identifier, password) =>
    api.post('/auth/login', { email: identifier, password }),
  googleLogin: (credential) => api.post('/auth/google', { credential }),
  verifyEmail: (email, otp) => api.post('/auth/verify-email', { email, otp }),
  forgotPassword: (email) => api.post('/auth/forgot-password', { email }),
  resetPassword: (email, otp, password) => api.post('/auth/reset-password', { email, otp, password }),
  refresh: () => api.post('/auth/refresh', {}),
  logout: () => api.post('/auth/logout'),
  getProfile: () => api.get('/auth/profile'),
  completeAccountSetup: (payload) => api.post('/auth/complete-account-setup', payload),
};

export const userAPI = {
  getDashboard: () => api.get('/users/dashboard'),
  updateProfile: (dataOrName, level) =>
    typeof dataOrName === 'object'
      ? api.put('/users/profile', dataOrName)
      : api.put('/users/profile', { name: dataOrName, level }),
  changePassword: (currentPassword, newPassword) =>
    api.post('/users/change-password', { currentPassword, newPassword }),
  getAllUsers: (params) => api.get('/users/all', params ? { params } : undefined),
  getUserAnalytics: (id) => api.get(`/users/${id}/analytics`),
  createUser: (payload) => api.post('/users', payload),
  bulkImportEmails: (payload) => api.post('/users/bulk-import', payload),
  updateUserAdmin: (id, payload) => api.patch(`/users/${id}`, payload),
  deleteUser: (id) => api.delete(`/users/${id}`),
  bulkDeleteUsers: (ids) => api.post('/users/bulk-delete', { ids }),
  bulkDeactivateUsers: (ids) => api.post('/users/bulk-deactivate', { ids }),
};

export const ttsAPI = {
  synthesize: (text, speaker = 'priya', options = {}) =>
    api.post('/tts', { text, speaker, ...options }, { responseType: 'blob' }),
};

export const interviewAPI = {
  createInterview: (data) => api.post('/interviews', data),
  getInterview: (interviewId) => api.get(`/interviews/${interviewId}`),
  startInterview: (interviewId, networkQualityTier) =>
    api.post('/interviews/start', { interviewId, networkQualityTier }),
  submitAnswer: (interviewId, question, answer) =>
    api.post('/interviews/answer', { interviewId, question, answer }),
  completeInterview: (interviewId, feedback, totalScore) =>
    api.post('/interviews/complete', { interviewId, feedback, totalScore }),
  getState: (interviewId) => api.get(`/interviews/${interviewId}/state`),
  speak: (interviewId, text, voiceStyle = 'default', options = {}) =>
    api.post(`/interviews/${interviewId}/speak`, { text, voiceStyle, ...options }, { responseType: 'blob' }),
  transcribe: (interviewId, formData) =>
    api.post(`/interviews/${interviewId}/transcribe`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 45_000,
    }),
  uploadRecording: (interviewId, formData) =>
    api.post(`/interviews/${interviewId}/recording`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  getUserInterviews: () => api.get('/interviews/user-interviews'),
  adminList: () => api.get('/interviews/admin/all'),
  adminGet: (id) => api.get(`/interviews/admin/${id}`),
  adminReportPdf: (id) => api.get(`/interviews/admin/${id}/report/pdf`, { responseType: 'blob' }),
  logViolation: (id, type, description) =>
    api.patch(`/interviews/${id}/violation`, { type, description }),
  logFaceIncident: (id, payload) =>
    api.patch(`/interviews/${id}/face-incident`, payload),
  terminate: (id, reasonType, questionIndex) =>
    api.post(`/interviews/${id}/terminate`, { reasonType, questionIndex }),
  getReport: (id) => api.get(`/interviews/${id}/report`),
  getReportPdf: (id) => api.get(`/interviews/${id}/report/pdf`, { responseType: 'blob' }),
  personaPreview: (personaId) =>
    api.post('/interviews/persona-preview', { personaId }, { responseType: 'blob' }),
};

export const resumeAPI = {
  upload: (formData) =>
    api.post('/resumes', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  getHistory: () => api.get('/resumes'),
  getResume: (id) => api.get(`/resumes/${id}`),
  adminList: () => api.get('/resumes/admin/all'),
  adminGet: (id) => api.get(`/resumes/admin/${id}`),
};

export const scheduleAPI = {
  create: (data) => api.post('/schedules', data),
  list: () => api.get('/schedules'),
  reschedule: (id, data) => api.put(`/schedules/${id}`, data),
  cancel: (id) => api.delete(`/schedules/${id}`),
};

export const reportAPI = {
  list: () => api.get('/reports'),
  get: (id) => api.get(`/reports/${id}`),
  adminList: () => api.get('/reports/admin/all'),
};

export const institutionAPI = {
  list: () => api.get('/institutions'),
  create: (data) => api.post('/institutions', data),
  get: (id) => api.get(`/institutions/${id}`),
  update: (id, data) => api.patch(`/institutions/${id}`, data),
  deletionImpact: (id) => api.get(`/institutions/${id}/deletion-impact`),
  archive: (id, payload) => api.post(`/institutions/${id}/archive`, payload),
  bulkImportStudents: (id, students) =>
    api.post(`/institutions/${id}/students/bulk`, { students }),
};

export const adminAPI = {
  platformAnalytics: () => api.get('/admin/analytics/platform'),
  institutionAnalytics: (params) => api.get('/admin/analytics/institution', { params }),
  institutionComparison: () => api.get('/admin/analytics/comparison'),
  candidate360: (id) => api.get(`/admin/candidates/${id}/360`),
  terminationHistory: (id) => api.get(`/admin/candidates/${id}/termination-history`),
  terminateStudent: (id, payload) => api.post(`/admin/candidates/${id}/terminate`, payload),
  reactivateStudent: (id, payload = {}) => api.post(`/admin/candidates/${id}/reactivate`, payload),
  resetStudentPassword: (id, payload) => api.post(`/admin/candidates/${id}/reset-password`, payload),
  exportStudents: (params) => api.get('/admin/exports/students', {
    params,
    responseType: params?.format === 'csv' ? 'blob' : 'json',
  }),
  auditLogs: (params) => api.get('/admin/audit-logs', { params }),
  listQuestions: (params) => api.get('/admin/questions', { params }),
  getQuestion: (id) => api.get(`/admin/questions/${id}`),
  createQuestion: (payload) => api.post('/admin/questions', payload),
  updateQuestion: (id, payload) => api.patch(`/admin/questions/${id}`, payload),
  archiveQuestion: (id) => api.delete(`/admin/questions/${id}`),
  generateQuestions: (payload) => api.post('/admin/questions/generate', payload),
  bulkCreateQuestions: (payload) => api.post('/admin/questions/bulk-create', payload),
  listQuestionConcepts: (params) => api.get('/admin/question-concepts', { params }),
  getQuestionConcept: (id) => api.get(`/admin/question-concepts/${id}`),
  createQuestionConcept: (payload) => api.post('/admin/question-concepts', payload),
  updateQuestionConcept: (id, payload) => api.patch(`/admin/question-concepts/${id}`, payload),
  archiveQuestionConcept: (id) => api.delete(`/admin/question-concepts/${id}`),
  deleteQuestionConcept: (id) => api.delete(`/admin/question-concepts/${id}/permanent`),
  generateQuestionConcepts: (payload) => api.post('/admin/question-concepts/generate', payload),
  bulkCreateQuestionConcepts: (payload) => api.post('/admin/question-concepts/bulk-create', payload),
  questionConceptPoolSummaries: () => api.get('/admin/question-concepts/pool-summaries'),
  questionConceptCatalog: () => api.get('/admin/question-concepts/catalog'),
  questionConceptReviewQueue: (params) => api.get('/admin/question-concepts/review-queue', { params }),
  approveQuestionConcepts: (payload) => api.post('/admin/question-concepts/approve', payload),
  discardQuestionConcepts: (payload) => api.post('/admin/question-concepts/discard', payload),
  startConceptGenerationBatch: (payload) => api.post('/admin/question-concepts/generation-batches', payload),
  listConceptGenerationBatches: () => api.get('/admin/question-concepts/generation-batches'),
  getConceptGenerationBatch: (batchId) => api.get(`/admin/question-concepts/generation-batches/${batchId}`),
  cancelConceptGenerationBatch: (batchId) => api.post(`/admin/question-concepts/generation-batches/${batchId}/cancel`),
  previewRestoreApprovedPilotConcepts: () => api.get('/admin/question-concepts/restore-approved-pilot'),
  restoreApprovedPilotConcepts: () => api.post('/admin/question-concepts/restore-approved-pilot', { confirm: true }),
};

export default api;
