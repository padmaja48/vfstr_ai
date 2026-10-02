import { Router } from 'express';
import { adminListReports, getReport, listReports, reportParamsSchema } from '../controllers/report.controller';
import { authenticate, requireAccountSetupComplete, requireActiveAccount } from '../middleware/auth';
import { authorizeAdmin } from '../middleware/adminScope';
import { validate } from '../middleware/validate';

const router = Router();

router.use(authenticate);
router.use(requireActiveAccount);
router.use(requireAccountSetupComplete);
router.get('/', listReports);
router.get('/admin/all', authorizeAdmin, adminListReports);
router.get('/:id', validate(reportParamsSchema), getReport);

export default router;
