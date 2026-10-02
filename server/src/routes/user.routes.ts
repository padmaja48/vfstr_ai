import { Router } from 'express';
import { z } from 'zod';
import {
  bulkImportEmails,
  bulkImportEmailsSchema,
  bulkDeleteUsers,
  bulkDeactivateUsers,
  bulkUserIdsSchema,
  changePassword,
  changePasswordSchema,
  createUser,
  createUserSchema,
  deleteUser,
  deleteUserSchema,
  getAllUsers,
  getUserAnalytics,
  getUserDashboard,
  updateProfile,
  updateProfileSchema,
  updateUserAdmin,
  updateUserAdminSchema,
} from '../controllers/user.controller';
import { authorizeAdmin, authorizeSuperAdmin } from '../middleware/adminScope';
import { authenticate, requireAccountSetupComplete, requireActiveAccount } from '../middleware/auth';
import { bulkImportLimiter } from '../middleware/rateLimiter';
import { validate } from '../middleware/validate';

const idSchema = z.object({ params: z.object({ id: z.string().min(1) }) });

const router = Router();

router.use(authenticate);
router.use(requireActiveAccount);
router.use(requireAccountSetupComplete);
router.get('/dashboard', getUserDashboard);
router.put('/profile', validate(updateProfileSchema), updateProfile);
router.post('/change-password', validate(changePasswordSchema), changePassword);

router.get('/all', authorizeAdmin, getAllUsers);
router.get('/:id/analytics', authorizeAdmin, validate(idSchema), getUserAnalytics);

router.post('/', authorizeSuperAdmin, validate(createUserSchema), createUser);
router.post('/bulk-import', authorizeSuperAdmin, bulkImportLimiter, validate(bulkImportEmailsSchema), bulkImportEmails);
router.post('/bulk-delete', authorizeSuperAdmin, validate(bulkUserIdsSchema), bulkDeleteUsers);
router.post('/bulk-deactivate', authorizeSuperAdmin, validate(bulkUserIdsSchema), bulkDeactivateUsers);
router.patch('/:id', authorizeSuperAdmin, validate(updateUserAdminSchema), updateUserAdmin);
router.delete('/:id', authorizeSuperAdmin, validate(deleteUserSchema), deleteUser);

export default router;
