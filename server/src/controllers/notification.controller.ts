import { z } from 'zod';
import {
  NOTIFICATION_AUDIENCE_TYPES,
  NOTIFICATION_CHANNELS,
} from '../models/Notification';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import {
  createAdminNotification,
  deleteAdminNotification,
  getAdminNotification,
  IMPLEMENTED_CHANNELS,
  listAdminNotifications,
  listUserNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/notification.service';

const audienceEnum = z.enum(NOTIFICATION_AUDIENCE_TYPES as unknown as [string, ...string[]]);
const channelEnum = z.enum(NOTIFICATION_CHANNELS as unknown as [string, ...string[]]);

export const listAdminNotificationsQuerySchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    status: z.string().optional(),
    audienceType: z.string().optional(),
  }),
});

export const notificationIdSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
});

export const createNotificationSchema = z.object({
  body: z.object({
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(8000),
    audienceType: audienceEnum,
    audienceValue: z.string().trim().optional(),
    channels: z.array(channelEnum).min(1),
    scheduledAt: z.string().datetime().optional(),
  }).superRefine((data, ctx) => {
    const implemented = data.channels.filter((channel) =>
      IMPLEMENTED_CHANNELS.includes(channel as typeof IMPLEMENTED_CHANNELS[number]),
    );
    if (!implemented.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Select at least one supported channel (in-app or email).',
        path: ['channels'],
      });
    }
    if (data.audienceType === 'institution' && !data.audienceValue?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Institution audience requires institutionId.',
        path: ['audienceValue'],
      });
    }
    if (data.audienceType === 'readinessLevel' && !data.audienceValue?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Readiness audience requires a readiness level.',
        path: ['audienceValue'],
      });
    }
    if (data.channels.some((channel) => !IMPLEMENTED_CHANNELS.includes(channel as typeof IMPLEMENTED_CHANNELS[number])
      && ['sms', 'push'].includes(channel))) {
      // Allow request if only stub channels are extra; implemented filter happens in service.
    }
  }),
});

export const listAdminNotificationsHandler = asyncHandler(async (req, res) => {
  const payload = await listAdminNotifications({
    page: Number.parseInt(String(req.query.page || '1'), 10) || 1,
    limit: Number.parseInt(String(req.query.limit || '25'), 10) || 25,
    status: String(req.query.status || 'all'),
    audienceType: String(req.query.audienceType || 'all'),
  });
  res.json(payload);
});

export const getAdminNotificationHandler = asyncHandler(async (req, res) => {
  const row = await getAdminNotification(String(req.params.id));
  if (!row) throw new AppError('Notification not found', 404, 'NOTIFICATION_NOT_FOUND');
  res.json(row);
});

export const createNotificationHandler = asyncHandler(async (req, res) => {
  const scheduledAt = req.body.scheduledAt ? new Date(req.body.scheduledAt) : undefined;
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) {
    throw new AppError('Invalid scheduledAt datetime.', 400, 'SCHEDULE_INVALID');
  }

  const implementedChannels = (req.body.channels as string[]).filter((channel) =>
    IMPLEMENTED_CHANNELS.includes(channel as typeof IMPLEMENTED_CHANNELS[number]),
  ) as typeof IMPLEMENTED_CHANNELS;

  const created = await createAdminNotification({
    title: req.body.title,
    body: req.body.body,
    audienceType: req.body.audienceType,
    audienceValue: req.body.audienceValue,
    channels: implementedChannels,
    scheduledAt,
    createdByUserId: String(req.user!._id),
  });

  res.status(201).json({ notification: created });
});

export const deleteAdminNotificationHandler = asyncHandler(async (req, res) => {
  const result = await deleteAdminNotification(String(req.params.id));
  if (!result) throw new AppError('Notification not found', 404, 'NOTIFICATION_NOT_FOUND');
  res.json(result);
});

export const listUserNotificationsHandler = asyncHandler(async (req, res) => {
  const payload = await listUserNotifications(String(req.user!._id));
  res.json(payload);
});

export const markNotificationReadHandler = asyncHandler(async (req, res) => {
  const payload = await markNotificationRead(String(req.user!._id), String(req.params.id));
  res.json(payload);
});

export const markAllNotificationsReadHandler = asyncHandler(async (_req, res) => {
  const payload = await markAllNotificationsRead(String(_req.user!._id));
  res.json(payload);
});
