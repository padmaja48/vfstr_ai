/**
 * Admin services — reuse the shared axios client in `services/api.js`.
 * Stubbed modules throw with code PENDING_BACKEND until real routes exist.
 */
import { institutionAPI, interviewAPI, reportAPI, resumeAPI, userAPI, adminAPI } from '@/services/api';

const pending = (feature) => {
  const err = new Error(`${feature} backend endpoint is not available yet`);
  err.code = 'PENDING_BACKEND';
  err.feature = feature;
  return Promise.reject(err);
};

export const adminUsersService = {
  list: async (options = {}) => {
    if (options.paginated) {
      const res = await userAPI.getAllUsers({
        page: options.page,
        limit: options.limit,
        search: options.search || undefined,
        status: options.status || 'all',
        scope: options.scope || 'all',
        institution: options.institution || undefined,
        institutionId: options.institutionId || undefined,
        batch: options.batch || undefined,
        branch: options.branch || undefined,
      });
      return res.data || { users: [], pagination: null };
    }

    // Dashboard / aggregations: page through results (server no longer returns a full dump).
    const pageSize = 100;
    let page = 1;
    let totalPages = 1;
    const users = [];
    while (page <= totalPages && page <= 50) {
      const res = await userAPI.getAllUsers({
        page,
        limit: pageSize,
        search: options.search || undefined,
        status: options.status || 'all',
        scope: options.scope || 'all',
        institution: options.institution || undefined,
        institutionId: options.institutionId || undefined,
        batch: options.batch || undefined,
        branch: options.branch || undefined,
      });
      const payload = res.data || {};
      const batch = Array.isArray(payload) ? payload : (payload.users || []);
      users.push(...batch);
      totalPages = Array.isArray(payload)
        ? 1
        : Math.max(1, Number(payload.pagination?.totalPages || 1));
      page += 1;
    }
    return { users, pagination: { page: 1, limit: users.length, total: users.length, totalPages: 1 } };
  },
  getAnalytics: async (id) => {
    const res = await userAPI.getUserAnalytics(id);
    return res.data;
  },
  create: async (payload) => {
    const res = await userAPI.createUser(payload);
    return res.data;
  },
  bulkImportEmails: async (emails, options = {}) => {
    const res = await userAPI.bulkImportEmails({
      emails,
      role: options.role,
      institutionId: options.institutionId,
    });
    return res.data;
  },
  update: async (id, payload) => {
    const res = await userAPI.updateUserAdmin(id, payload);
    return res.data;
  },
  remove: async (id) => {
    const res = await userAPI.deleteUser(id);
    return res.data;
  },
  bulkRemove: async (ids) => {
    const res = await userAPI.bulkDeleteUsers(ids);
    return res.data;
  },
  bulkDeactivate: async (ids) => {
    const res = await userAPI.bulkDeactivateUsers(ids);
    return res.data;
  },
};

export const adminInterviewsService = {
  list: async () => {
    const res = await interviewAPI.adminList();
    return res.data || [];
  },
  get: async (id) => {
    const res = await interviewAPI.adminGet(id);
    return res.data;
  },
};

export const adminResumesService = {
  list: async () => {
    const res = await resumeAPI.adminList();
    return res.data || [];
  },
  get: async (id) => {
    const res = await resumeAPI.adminGet(id);
    return res.data;
  },
};

export const adminReportsService = {
  list: async () => {
    const res = await reportAPI.adminList();
    return res.data || [];
  },
};

/** Question bank CRUD — superAdmin only */
export const adminQuestionsService = {
  list: async (params = {}) => {
    const res = await adminAPI.listQuestions(params);
    return res.data;
  },
  get: async (id) => {
    const res = await adminAPI.getQuestion(id);
    return res.data;
  },
  create: async (payload) => {
    const res = await adminAPI.createQuestion(payload);
    return res.data;
  },
  update: async (id, payload) => {
    const res = await adminAPI.updateQuestion(id, payload);
    return res.data;
  },
  archive: async (id) => {
    const res = await adminAPI.archiveQuestion(id);
    return res.data;
  },
  generate: async (payload) => {
    const res = await adminAPI.generateQuestions(payload);
    return res.data;
  },
  bulkCreate: async (payload) => {
    const res = await adminAPI.bulkCreateQuestions(payload);
    return res.data;
  },
};

export const adminQuestionConceptsService = {
  list: async (params = {}) => {
    const res = await adminAPI.listQuestionConcepts(params);
    return res.data;
  },
  get: async (id) => {
    const res = await adminAPI.getQuestionConcept(id);
    return res.data;
  },
  create: async (payload) => {
    const res = await adminAPI.createQuestionConcept(payload);
    return res.data;
  },
  update: async (id, payload) => {
    const res = await adminAPI.updateQuestionConcept(id, payload);
    return res.data;
  },
  archive: async (id) => {
    const res = await adminAPI.archiveQuestionConcept(id);
    return res.data;
  },
  delete: async (id) => {
    const res = await adminAPI.deleteQuestionConcept(id);
    return res.data;
  },
  generate: async (payload) => {
    const res = await adminAPI.generateQuestionConcepts(payload);
    return res.data;
  },
  bulkCreate: async (payload) => {
    const res = await adminAPI.bulkCreateQuestionConcepts(payload);
    return res.data;
  },
  poolSummaries: async () => {
    const res = await adminAPI.questionConceptPoolSummaries();
    return res.data;
  },
  catalog: async () => {
    const res = await adminAPI.questionConceptCatalog();
    return res.data;
  },
  reviewQueue: async (params = {}) => {
    const res = await adminAPI.questionConceptReviewQueue(params);
    return res.data;
  },
  approve: async (payload) => {
    const res = await adminAPI.approveQuestionConcepts(payload);
    return res.data;
  },
  discard: async (payload) => {
    const res = await adminAPI.discardQuestionConcepts(payload);
    return res.data;
  },
  startGenerationBatch: async (payload) => {
    const res = await adminAPI.startConceptGenerationBatch(payload);
    return res.data;
  },
  listGenerationBatches: async () => {
    const res = await adminAPI.listConceptGenerationBatches();
    return res.data;
  },
  getGenerationBatch: async (batchId) => {
    const res = await adminAPI.getConceptGenerationBatch(batchId);
    return res.data;
  },
  cancelGenerationBatch: async (batchId) => {
    const res = await adminAPI.cancelConceptGenerationBatch(batchId);
    return res.data;
  },
  previewRestoreApprovedPilot: async () => {
    const res = await adminAPI.previewRestoreApprovedPilotConcepts();
    return res.data;
  },
  restoreApprovedPilot: async () => {
    const res = await adminAPI.restoreApprovedPilotConcepts();
    return res.data;
  },
};

export const adminInstitutionsService = {
  list: async () => {
    const res = await institutionAPI.list();
    return res.data || [];
  },
  create: async (payload) => {
    const res = await institutionAPI.create(payload);
    return res.data;
  },
  get: async (id) => {
    const res = await institutionAPI.get(id);
    return res.data;
  },
  update: async (id, payload) => {
    const res = await institutionAPI.update(id, payload);
    return res.data;
  },
  bulkImportStudents: async (institutionId, students) => {
    const res = await institutionAPI.bulkImportStudents(institutionId, students);
    return res.data;
  },
  deletionImpact: async (id) => {
    const res = await institutionAPI.deletionImpact(id);
    return res.data;
  },
  archive: async (id, payload) => {
    const res = await institutionAPI.archive(id, payload);
    return res.data;
  },
};

/** Admin analytics, exports, 360° reports */
export const adminAnalyticsService = {
  platformAnalytics: async () => {
    const res = await adminAPI.platformAnalytics();
    return res.data;
  },
  institutionAnalytics: async (params) => {
    const res = await adminAPI.institutionAnalytics(params);
    return res.data;
  },
  getCandidate360: async (id) => {
    const res = await adminAPI.candidate360(id);
    return res.data;
  },
  terminateStudent: async (id, payload) => {
    const res = await adminAPI.terminateStudent(id, payload);
    return res.data;
  },
  reactivateStudent: async (id, payload = {}) => {
    const res = await adminAPI.reactivateStudent(id, payload);
    return res.data;
  },
  resetStudentPassword: async (id, password) => {
    const res = await adminAPI.resetStudentPassword(id, { password });
    return res.data;
  },
  institutionComparison: async () => {
    const res = await adminAPI.institutionComparison();
    return res.data;
  },
  exportStudentsCsv: async (params = {}) => {
    const res = await adminAPI.exportStudents({ ...params, format: 'csv' });
    return res.data;
  },
  exportStudentsJson: async (params = {}) => {
    const res = await adminAPI.exportStudents({ ...params, format: 'json' });
    return res.data;
  },
};

/** TODO: backend endpoint not available yet */
export const adminSubscriptionsService = {
  listPlans: () => pending('Subscriptions / Billing'),
  listSubscribers: () => pending('Subscriptions / Billing'),
  listTransactions: () => pending('Subscriptions / Billing'),
};

/** TODO: backend endpoint not available yet */
export const adminSupportService = {
  listTickets: () => pending('Support tickets'),
  getTicket: () => pending('Support tickets'),
};

/** TODO: backend endpoint not available yet */
export const adminAIConfigService = {
  getConfig: () => pending('AI Configuration'),
  saveConfig: () => pending('AI Configuration'),
  listPrompts: () => pending('AI Configuration prompts'),
};

/** Platform admin directory — audit logs intentionally excluded from UI. */
export const adminSettingsService = {
  listPlatformAdmins: () => pending('Platform admin directory'),
};
