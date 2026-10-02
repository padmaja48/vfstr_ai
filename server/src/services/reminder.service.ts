import { JobsOptions, Queue, Worker } from 'bullmq';
import { env } from '../config/env';
import { getQueueRedis, isMemoryRedis } from '../config/redis';
import { User } from '../models/User';
import { queueEmail } from './email.service';

type ReminderJob = {
  scheduleId: string;
  userId: string;
  title: string;
  scheduledFor: string;
};

let reminderQueue: Queue<ReminderJob, void, string> | null = null;

export const getReminderQueue = () => {
  if (!reminderQueue) {
    reminderQueue = new Queue<ReminderJob, void, string>('reminders', {
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

  return reminderQueue;
};

export const queueReminder = async (payload: ReminderJob, options?: JobsOptions) => {
  if (isMemoryRedis()) {
    return { id: `memory-reminder-${payload.scheduleId}-${Date.now()}` };
  }

  return getReminderQueue().add('interview-reminder', payload, options);
};

export const removeReminder = async (jobId: string) => {
  if (isMemoryRedis()) {
    return;
  }

  const queue = getReminderQueue();
  const job = await queue.getJob(jobId);
  await job?.remove();
};

export const startReminderWorker = () => {
  if (isMemoryRedis()) {
    return { close: async () => undefined };
  }

  return new Worker<ReminderJob>(
    'reminders',
    async (job) => {
      const user = await User.findById(job.data.userId).select('name email');
      if (!user) {
        return;
      }

      await queueEmail({
        to: user.email,
        subject: `Upcoming interview: ${job.data.title}`,
        html: `<p>Hi ${user.name},</p><p>Your interview is scheduled for ${new Date(
          job.data.scheduledFor,
        ).toLocaleString()}.</p>`,
      });
    },
    { connection: getQueueRedis() as never, prefix: env.BULLMQ_PREFIX },
  );
};
