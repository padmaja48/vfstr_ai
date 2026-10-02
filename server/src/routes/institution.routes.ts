import { Router } from 'express';
import {
  archiveInstitution,
  archiveInstitutionSchema,
  bulkImportStudents,
  bulkImportStudentsSchema,
  createInstitution,
  createInstitutionSchema,
  getInstitution,
  getInstitutionDeletionImpact,
  institutionParamsSchema,
  listInstitutions,
  updateInstitution,
  updateInstitutionSchema,
} from '../controllers/institution.controller';
import { authorizeAdmin, authorizeSuperAdmin } from '../middleware/adminScope';
import { authenticate, requireAccountSetupComplete, requireActiveAccount } from '../middleware/auth';
import { bulkImportLimiter } from '../middleware/rateLimiter';
import { validate } from '../middleware/validate';

const router = Router();

router.use(authenticate);
router.use(requireActiveAccount);
router.use(requireAccountSetupComplete);
router.use(authorizeAdmin);

router.get('/', authorizeSuperAdmin, listInstitutions);
router.post('/', authorizeSuperAdmin, validate(createInstitutionSchema), createInstitution);
router.get('/:id/deletion-impact', authorizeSuperAdmin, validate(institutionParamsSchema), getInstitutionDeletionImpact);
router.post('/:id/archive', authorizeSuperAdmin, validate(archiveInstitutionSchema), archiveInstitution);
router.patch('/:id', authorizeSuperAdmin, validate(updateInstitutionSchema), updateInstitution);
router.get('/:id', authorizeAdmin, validate(institutionParamsSchema), getInstitution);
router.post(
  '/:id/students/bulk',
  authorizeSuperAdmin,
  bulkImportLimiter,
  validate(bulkImportStudentsSchema),
  bulkImportStudents,
);

export default router;
