import { Router } from 'express';
import {
  listUserNotificationsHandler,
  markAllNotificationsReadHandler,
  markNotificationReadHandler,
  notificationIdSchema,
} from '../controllers/notification.controller';
import { authenticate, requireAccountSetupComplete, requireActiveAccount } from '../middleware/auth';
import { validate } from '../middleware/validate';

const router = Router();

router.use(authenticate);
router.use(requireActiveAccount);
router.use(requireAccountSetupComplete);

router.get('/', listUserNotificationsHandler);
router.patch('/read-all', markAllNotificationsReadHandler);
router.patch('/:id/read', validate(notificationIdSchema), markNotificationReadHandler);

export default router;
