import { JobsOptions, Queue, Worker } from 'bullmq';
import { env } from '../config/env';
import { getQueueRedis, isMemoryRedis } from '../config/redis';
import { deliverNotification } from './notification.service';

type NotificationSendJob = {
  notificationId: string;
};

const memoryScheduledTimers = new Map<string, ReturnType<typeof setTimeout>>();

let notificationQueue: Queue<NotificationSendJob, void, string> | null = null;

export const getNotificationQueue = () => {
  if (!notificationQueue) {
    notificationQueue = new Queue<NotificationSendJob, void, string>('notifications', {
      connection: getQueueRedis() as never,
      prefix: env.BULLMQ_PREFIX,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 500,
        removeOnFail: 1000,
      },
    });
  }
  return notificationQueue;
};

export const queueNotificationSend = async (notificationId: string, scheduledAt: Date) => {
  const delay = Math.max(0, scheduledAt.getTime() - Date.now());
  const options: JobsOptions = { delay, jobId: `notification-${notificationId}` };

  if (isMemoryRedis()) {
    const jobId = String(options.jobId);
    const timer = setTimeout(() => {
      memoryScheduledTimers.delete(jobId);
      void deliverNotification(notificationId).catch(() => undefined);
    }, delay);
    memoryScheduledTimers.set(jobId, timer);
    return { id: jobId };
  }

  return getNotificationQueue().add('send-notification', { notificationId }, options);
};

export const removeScheduledNotificationJob = async (jobId: string) => {
  if (isMemoryRedis()) {
    const timer = memoryScheduledTimers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      memoryScheduledTimers.delete(jobId);
    }
    return;
  }
  const job = await getNotificationQueue().getJob(jobId);
  await job?.remove();
};

export const startNotificationWorker = () => {
  if (isMemoryRedis()) {
    return { close: async () => undefined };
  }

  return new Worker<NotificationSendJob>(
    'notifications',
    async (job) => {
      await deliverNotification(job.data.notificationId);
    },
    { connection: getQueueRedis() as never, prefix: env.BULLMQ_PREFIX },
  );
};
