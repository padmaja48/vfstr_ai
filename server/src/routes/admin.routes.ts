import { Router } from 'express';
import { authenticate, requireAccountSetupComplete, requireActiveAccount } from '../middleware/auth';
import {
  exportStudents,
  exportQuerySchema,
  getAssignedInstitutions,
  getCandidate360,
  getInstitutionAnalytics,
  getInstitutionComparison,
  getPlatformAnalytics,
  getTerminationHistory,
  listAuditLogs,
  reactivateStudent,
  reactivateStudentSchema,
  resetStudentPassword,
  resetStudentPasswordSchema,
  terminateStudent,
  terminateStudentSchema,
} from '../controllers/admin.controller';
import {
  archiveQuestionHandler,
  bulkCreateQuestionsHandler,
  bulkCreateQuestionsSchema,
  createQuestionHandler,
  createQuestionSchema,
  generateQuestionsHandler,
  generateQuestionsSchema,
  getQuestionHandler,
  listQuestionsHandler,
  listQuestionsQuerySchema,
  questionIdSchema,
  updateQuestionHandler,
  updateQuestionSchema,
} from '../controllers/question.controller';
import {
  archiveConceptHandler,
  approveConceptsHandler,
  approveConceptsSchema,
  batchIdParamSchema,
  bulkCreateConceptsHandler,
  bulkCreateConceptsSchema,
  cancelGenerationBatchHandler,
  companyPoolSummariesHandler,
  conceptIdSchema,
  createConceptHandler,
  createConceptSchema,
  discardConceptsHandler,
  discardConceptsSchema,
  deleteConceptHandler,
  generateConceptsHandler,
  generateConceptsSchema,
  getConceptHandler,
  getGenerationBatchHandler,
  listCompanyCatalogHandler,
  listConceptsHandler,
  listConceptsQuerySchema,
  listGenerationBatchesHandler,
  reviewQueueHandler,
  reviewQueueQuerySchema,
  restoreApprovedPilotHandler,
  restoreApprovedPilotPreviewHandler,
  restoreApprovedPilotSchema,
  startGenerationBatchHandler,
  startGenerationBatchSchema,
  updateConceptHandler,
  updateConceptSchema,
} from '../controllers/questionConcept.controller';
import {
  createNotificationHandler,
  createNotificationSchema,
  deleteAdminNotificationHandler,
  getAdminNotificationHandler,
  listAdminNotificationsHandler,
  listAdminNotificationsQuerySchema,
  notificationIdSchema,
} from '../controllers/notification.controller';
import { authorizeAdmin, authorizeSuperAdmin } from '../middleware/adminScope';
import { bulkImportLimiter } from '../middleware/rateLimiter';
import { validate } from '../middleware/validate';
import { z } from 'zod';

const idSchema = z.object({ params: z.object({ id: z.string().min(1) }) });

const router = Router();

router.use(authenticate);
router.use(requireActiveAccount);
router.use(requireAccountSetupComplete);

router.get('/assigned-institutions', authorizeAdmin, getAssignedInstitutions);
router.get('/analytics/platform', authorizeSuperAdmin, getPlatformAnalytics);
router.get('/analytics/institution', authorizeAdmin, getInstitutionAnalytics);
router.get('/analytics/comparison', authorizeSuperAdmin, getInstitutionComparison);

router.get('/candidates/:id/360', authorizeAdmin, validate(idSchema), getCandidate360);
router.get('/candidates/:id/termination-history', authorizeAdmin, validate(idSchema), getTerminationHistory);
router.post('/candidates/:id/terminate', authorizeAdmin, validate(terminateStudentSchema), terminateStudent);
router.post('/candidates/:id/reactivate', authorizeAdmin, validate(reactivateStudentSchema), reactivateStudent);
router.post('/candidates/:id/reset-password', authorizeAdmin, validate(resetStudentPasswordSchema), resetStudentPassword);

router.get('/exports/students', authorizeAdmin, validate(exportQuerySchema), exportStudents);

router.get('/audit-logs', authorizeSuperAdmin, listAuditLogs);

router.get('/questions', authorizeSuperAdmin, validate(listQuestionsQuerySchema), listQuestionsHandler);
router.get('/questions/:id', authorizeSuperAdmin, validate(questionIdSchema), getQuestionHandler);
router.post('/questions', authorizeSuperAdmin, validate(createQuestionSchema), createQuestionHandler);
router.patch('/questions/:id', authorizeSuperAdmin, validate(updateQuestionSchema), updateQuestionHandler);
router.delete('/questions/:id', authorizeSuperAdmin, validate(questionIdSchema), archiveQuestionHandler);
router.post('/questions/generate', authorizeSuperAdmin, validate(generateQuestionsSchema), generateQuestionsHandler);
router.post('/questions/bulk-create', authorizeSuperAdmin, validate(bulkCreateQuestionsSchema), bulkCreateQuestionsHandler);

router.get('/question-concepts/pool-summaries', authorizeSuperAdmin, companyPoolSummariesHandler);
router.get('/question-concepts/restore-approved-pilot', authorizeSuperAdmin, restoreApprovedPilotPreviewHandler);
router.post('/question-concepts/restore-approved-pilot', authorizeSuperAdmin, validate(restoreApprovedPilotSchema), restoreApprovedPilotHandler);
router.get('/question-concepts/catalog', authorizeSuperAdmin, listCompanyCatalogHandler);
router.get('/question-concepts/review-queue', authorizeSuperAdmin, validate(reviewQueueQuerySchema), reviewQueueHandler);
router.post('/question-concepts/approve', authorizeSuperAdmin, validate(approveConceptsSchema), approveConceptsHandler);
router.post('/question-concepts/discard', authorizeSuperAdmin, validate(discardConceptsSchema), discardConceptsHandler);
router.post('/question-concepts/generation-batches', authorizeSuperAdmin, bulkImportLimiter, validate(startGenerationBatchSchema), startGenerationBatchHandler);
router.get('/question-concepts/generation-batches', authorizeSuperAdmin, listGenerationBatchesHandler);
router.get('/question-concepts/generation-batches/:batchId', authorizeSuperAdmin, validate(batchIdParamSchema), getGenerationBatchHandler);
router.post('/question-concepts/generation-batches/:batchId/cancel', authorizeSuperAdmin, validate(batchIdParamSchema), cancelGenerationBatchHandler);
router.get('/question-concepts', authorizeSuperAdmin, validate(listConceptsQuerySchema), listConceptsHandler);
router.get('/question-concepts/:id', authorizeSuperAdmin, validate(conceptIdSchema), getConceptHandler);
router.post('/question-concepts', authorizeSuperAdmin, validate(createConceptSchema), createConceptHandler);
router.patch('/question-concepts/:id', authorizeSuperAdmin, validate(updateConceptSchema), updateConceptHandler);
router.delete('/question-concepts/:id/permanent', authorizeSuperAdmin, validate(conceptIdSchema), deleteConceptHandler);
router.delete('/question-concepts/:id', authorizeSuperAdmin, validate(conceptIdSchema), archiveConceptHandler);
router.post('/question-concepts/generate', authorizeSuperAdmin, validate(generateConceptsSchema), generateConceptsHandler);
router.post('/question-concepts/bulk-create', authorizeSuperAdmin, validate(bulkCreateConceptsSchema), bulkCreateConceptsHandler);

router.get('/notifications', authorizeSuperAdmin, validate(listAdminNotificationsQuerySchema), listAdminNotificationsHandler);
router.get('/notifications/:id', authorizeSuperAdmin, validate(notificationIdSchema), getAdminNotificationHandler);
router.post('/notifications', authorizeSuperAdmin, validate(createNotificationSchema), createNotificationHandler);
router.delete('/notifications/:id', authorizeSuperAdmin, validate(notificationIdSchema), deleteAdminNotificationHandler);

export default router;
