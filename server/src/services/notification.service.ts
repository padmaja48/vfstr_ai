import mongoose from 'mongoose';
import { env } from '../config/env';
import { Institution } from '../models/Institution';
import {
  INotification,
  Notification,
  NotificationAudienceType,
  NotificationChannel,
  NotificationDeliveryStats,
} from '../models/Notification';
import { NotificationRecipient } from '../models/NotificationRecipient';
import { User } from '../models/User';
import { AppError } from '../utils/AppError';
import { adminNotificationEmail, deliverEmail } from './email.service';
import { queueNotificationSend, removeScheduledNotificationJob } from './notificationQueue.service';

export const IMPLEMENTED_CHANNELS: NotificationChannel[] = ['in_app', 'email'];

export type ReadinessBand = 'Beginner' | 'Intermediate' | 'Ready';

export const readinessBandFromScore = (score: number): ReadinessBand => {
  const n = Number(score) || 0;
  if (n >= 75) return 'Ready';
  if (n >= 50) return 'Intermediate';
  return 'Beginner';
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const loginPageUrl = () => `${env.CLIENT_URL.replace(/\/$/, '')}/`;

const emptyStats = (): NotificationDeliveryStats => ({
  attempted: 0,
  succeeded: 0,
  failed: 0,
  recipients: 0,
  inAppDelivered: 0,
  emailDelivered: 0,
  emailFailed: 0,
});

export const buildAudienceLabel = async (
  audienceType: NotificationAudienceType,
  audienceValue?: string,
) => {
  if (audienceType === 'all') return 'All users';
  if (audienceType === 'readinessLevel') return `Readiness: ${audienceValue || '—'}`;
  if (audienceType === 'plan') return 'Plan targeting (not available yet)';
  if (audienceType === 'institution' && audienceValue) {
    if (mongoose.Types.ObjectId.isValid(audienceValue)) {
      const inst = await Institution.findById(audienceValue).select('name').lean();
      if (inst?.name) return inst.name;
    }
    return audienceValue;
  }
  return audienceValue || '—';
};

export const resolveNotificationRecipients = async (
  audienceType: NotificationAudienceType,
  audienceValue?: string,
) => {
  if (audienceType === 'plan') {
    throw new AppError(
      'Plan-based audience targeting is not available yet — subscriptions are not integrated.',
      400,
      'PLAN_AUDIENCE_UNAVAILABLE',
    );
  }

  const baseFilter: Record<string, unknown> = {
    isActive: { $ne: false },
    requiresAccountSetup: { $ne: true },
  };

  if (audienceType === 'institution') {
    const id = String(audienceValue || '').trim();
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('institution audience requires a valid institutionId.', 400, 'AUDIENCE_INVALID');
    }
    baseFilter.institutionId = new mongoose.Types.ObjectId(id);
  }

  const users = await User.find(baseFilter).select('_id name email averageScore role').lean();

  const eligible = users.filter((user) => {
    const role = String(user.role || '');
    const isStudentLike = ['student', 'candidate'].includes(role)
      || (!['superAdmin', 'institutionAdmin', 'admin', 'recruiter'].includes(role) && role !== '');
    if (audienceType === 'all') return isStudentLike;
    if (audienceType === 'institution') return isStudentLike || role === 'admin' || role === 'institutionAdmin';
    if (audienceType === 'readinessLevel') {
      if (!isStudentLike) return false;
      return readinessBandFromScore(Number(user.averageScore)) === audienceValue;
    }
    return isStudentLike;
  });

  return eligible.map((user) => ({
    userId: user._id as mongoose.Types.ObjectId,
    name: user.name,
    email: user.email,
  }));
};

const serializeNotification = (doc: INotification | Record<string, unknown>) => {
  const json = typeof (doc as INotification).toJSON === 'function'
    ? (doc as INotification).toJSON()
    : { ...(doc as Record<string, unknown>) };
  return {
    id: String(json._id || json.id),
    title: json.title,
    body: json.body,
    audienceType: json.audienceType,
    audienceValue: json.audienceValue || '',
    audienceLabel: json.audienceLabel || '',
    channels: json.channels || [],
    scheduledAt: json.scheduledAt,
    status: json.status,
    createdBy: json.createdBy ? String(json.createdBy) : undefined,
    sentAt: json.sentAt,
    deliveryStats: json.deliveryStats || emptyStats(),
    createdAt: json.createdAt,
    updatedAt: json.updatedAt,
  };
};

export const listAdminNotifications = async (options: {
  page?: number;
  limit?: number;
  status?: string;
  audienceType?: string;
}) => {
  const page = Math.max(1, options.page || 1);
  const limit = Math.min(100, Math.max(1, options.limit || 25));
  const filter: Record<string, unknown> = {};
  if (options.status && options.status !== 'all') filter.status = options.status;
  if (options.audienceType && options.audienceType !== 'all') filter.audienceType = options.audienceType;

  const [rows, total] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Notification.countDocuments(filter),
  ]);

  return {
    notifications: rows.map(serializeNotification),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
};

export const getAdminNotification = async (id: string) => {
  const row = await Notification.findById(id);
  if (!row) return null;
  const recipientCount = await NotificationRecipient.countDocuments({ notificationId: row._id });
  const readCount = await NotificationRecipient.countDocuments({ notificationId: row._id, read: true });
  return {
    ...serializeNotification(row),
    recipientCount,
    readCount,
  };
};

export type CreateNotificationInput = {
  title: string;
  body: string;
  audienceType: NotificationAudienceType;
  audienceValue?: string;
  channels: NotificationChannel[];
  scheduledAt?: Date;
  createdByUserId: string;
};

export const createAdminNotification = async (input: CreateNotificationInput) => {
  const channels = input.channels.filter((channel) => IMPLEMENTED_CHANNELS.includes(channel));
  if (!channels.length) {
    throw new AppError('Select at least one supported channel (in-app or email).', 400, 'CHANNELS_REQUIRED');
  }

  const audienceLabel = await buildAudienceLabel(input.audienceType, input.audienceValue);
  const scheduledAt = input.scheduledAt;
  const isScheduled = scheduledAt && scheduledAt.getTime() > Date.now() + 1000;

  const notification = await Notification.create({
    title: input.title.trim(),
    body: input.body.trim(),
    audienceType: input.audienceType,
    audienceValue: input.audienceValue?.trim() || undefined,
    audienceLabel,
    channels,
    scheduledAt: isScheduled ? scheduledAt : undefined,
    status: isScheduled ? 'scheduled' : 'draft',
    createdBy: new mongoose.Types.ObjectId(input.createdByUserId),
    deliveryStats: emptyStats(),
  });

  if (isScheduled && scheduledAt) {
    const job = await queueNotificationSend(String(notification._id), scheduledAt);
    if (job?.id) {
      notification.scheduleJobId = String(job.id);
      await notification.save();
    }
    return serializeNotification(notification);
  }

  return deliverNotification(String(notification._id));
};

export const deleteAdminNotification = async (id: string) => {
  const row = await Notification.findById(id);
  if (!row) return null;
  if (!['draft', 'scheduled'].includes(row.status)) {
    throw new AppError('Only draft or scheduled notifications can be deleted.', 400, 'DELETE_FORBIDDEN');
  }
  if (row.scheduleJobId) {
    await removeScheduledNotificationJob(row.scheduleJobId);
  }
  await NotificationRecipient.deleteMany({ notificationId: row._id });
  await row.deleteOne();
  return { deleted: true };
};

const sendNotificationEmailsBatch = async (
  recipients: Array<{ recipientId: mongoose.Types.ObjectId; email: string; name: string }>,
  title: string,
  body: string,
) => {
  const chunkSize = Math.max(
    1,
    Number.parseInt(process.env.BULK_WELCOME_EMAIL_CHUNK_SIZE || '15', 10) || 15,
  );
  const chunkDelayMs = Math.max(
    0,
    Number.parseInt(process.env.BULK_WELCOME_EMAIL_CHUNK_DELAY_MS || '150', 10) || 150,
  );
  const loginUrl = loginPageUrl();
  let emailDelivered = 0;
  let emailFailed = 0;

  for (let offset = 0; offset < recipients.length; offset += chunkSize) {
    const chunk = recipients.slice(offset, offset + chunkSize);
    const results = await Promise.allSettled(
      chunk.map(async (recipient) => {
        const content = adminNotificationEmail({
          name: recipient.name,
          title,
          body,
          loginUrl,
        });
        await deliverEmail({ to: recipient.email, ...content });
      }),
    );

    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      const recipient = chunk[index];
      if (result.status === 'fulfilled') {
        emailDelivered += 1;
        await NotificationRecipient.updateOne(
          { _id: recipient.recipientId },
          { emailStatus: 'delivered', emailDeliveredAt: new Date(), emailError: undefined },
        );
      } else {
        emailFailed += 1;
        const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
        await NotificationRecipient.updateOne(
          { _id: recipient.recipientId },
          { emailStatus: 'failed', emailError: error },
        );
      }
    }

    if (offset + chunkSize < recipients.length && chunkDelayMs > 0) {
      await sleep(chunkDelayMs);
    }
  }

  return { emailDelivered, emailFailed };
};

// TODO: integrate SMS provider
export const sendNotificationSms = async () => {
  throw new Error('SMS channel is not integrated yet');
};

// TODO: integrate push notification provider
export const sendNotificationPush = async () => {
  throw new Error('Push channel is not integrated yet');
};

export const deliverNotification = async (notificationId: string) => {
  const notification = await Notification.findById(notificationId);
  if (!notification) {
    throw new AppError('Notification not found', 404, 'NOTIFICATION_NOT_FOUND');
  }
  if (['sent', 'partially_sent', 'failed'].includes(notification.status)) {
    return serializeNotification(notification);
  }

  const recipients = await resolveNotificationRecipients(
    notification.audienceType,
    notification.audienceValue,
  );

  const stats = emptyStats();
  stats.recipients = recipients.length;

  if (!recipients.length) {
    notification.status = 'failed';
    notification.sentAt = new Date();
    notification.deliveryStats = stats;
    await notification.save();
    return serializeNotification(notification);
  }

  const sendInApp = notification.channels.includes('in_app');
  const sendEmail = notification.channels.includes('email');

  const recipientDocs = await NotificationRecipient.insertMany(
    recipients.map((recipient) => ({
      notificationId: notification._id,
      userId: recipient.userId,
      read: false,
      inAppStatus: sendInApp ? 'delivered' : 'skipped',
      inAppDeliveredAt: sendInApp ? new Date() : undefined,
      emailStatus: sendEmail ? 'pending' : 'skipped',
    })),
  );

  if (sendInApp) {
    stats.inAppDelivered = recipientDocs.length;
    stats.attempted += recipientDocs.length;
    stats.succeeded += recipientDocs.length;
  }

  if (sendEmail) {
    const emailTargets = recipients.map((recipient, index) => ({
      recipientId: recipientDocs[index]._id as mongoose.Types.ObjectId,
      email: recipient.email,
      name: recipient.name,
    }));
    stats.attempted += emailTargets.length;
    const emailResult = await sendNotificationEmailsBatch(
      emailTargets,
      notification.title,
      notification.body,
    );
    stats.emailDelivered = emailResult.emailDelivered;
    stats.emailFailed = emailResult.emailFailed;
    stats.succeeded += emailResult.emailDelivered;
    stats.failed += emailResult.emailFailed;
  }

  notification.sentAt = new Date();
  notification.deliveryStats = stats;
  if (stats.succeeded === 0) {
    notification.status = 'failed';
  } else if (stats.failed > 0) {
    notification.status = 'partially_sent';
  } else {
    notification.status = 'sent';
  }
  await notification.save();

  return serializeNotification(notification);
};

export const listUserNotifications = async (userId: string) => {
  const rows = await NotificationRecipient.find({ userId })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate({ path: 'notificationId', select: 'title body sentAt status channels' })
    .lean();

  const notifications = rows
    .filter((row) => row.notificationId && typeof row.notificationId === 'object' && 'title' in row.notificationId)
    .map((row) => {
      const note = row.notificationId as unknown as {
        _id: mongoose.Types.ObjectId;
        title: string;
        body: string;
        sentAt?: Date;
      };
      return {
        id: String(row._id),
        notificationId: String(note._id),
        title: note.title,
        body: note.body,
        sentAt: note.sentAt || (row as { createdAt?: Date }).createdAt,
        read: row.read,
        readAt: row.readAt,
      };
    });

  const unreadCount = await NotificationRecipient.countDocuments({ userId, read: false });

  return { notifications, unreadCount };
};

export const markNotificationRead = async (userId: string, recipientId: string) => {
  const row = await NotificationRecipient.findOneAndUpdate(
    { _id: recipientId, userId },
    { read: true, readAt: new Date() },
    { new: true },
  );
  if (!row) {
    throw new AppError('Notification not found', 404, 'NOTIFICATION_NOT_FOUND');
  }
  return { id: String(row._id), read: true, readAt: row.readAt };
};

export const markAllNotificationsRead = async (userId: string) => {
  const result = await NotificationRecipient.updateMany(
    { userId, read: false },
    { read: true, readAt: new Date() },
  );
  return { updated: result.modifiedCount || 0 };
};
