import { z } from 'zod';
import { getRedis } from '../config/redis';
import { Interview } from '../models/Interview';
import { Schedule } from '../models/Schedule';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { queueReminder, removeReminder } from '../services/reminder.service';

export const scheduleParamsSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
});

export const createScheduleSchema = z.object({
  body: z.object({
    interviewId: z.string().optional(),
    title: z.string().min(2),
    scheduledFor: z.coerce.date(),
    timezone: z.string().default('UTC'),
    notes: z.string().optional(),
  }),
});

export const updateScheduleSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
  body: z.object({
    title: z.string().min(2).optional(),
    scheduledFor: z.coerce.date().optional(),
    timezone: z.string().optional(),
    notes: z.string().optional(),
  }),
});

const scheduleReminders = async (schedule: typeof Schedule.prototype) => {
  const reminderOffsets = [24 * 60 * 60 * 1000, 60 * 60 * 1000];
  const jobs: string[] = [];

  for (const offset of reminderOffsets) {
    const delay = schedule.scheduledFor.getTime() - Date.now() - offset;
    if (delay > 0) {
      const job = await queueReminder(
        {
          scheduleId: String(schedule._id),
          userId: String(schedule.userId),
          title: schedule.title,
          scheduledFor: schedule.scheduledFor.toISOString(),
        },
        { delay },
      );
      if (job.id) {
        jobs.push(job.id);
      }
    }
  }

  schedule.reminderJobIds = jobs;
  await getRedis().set(
    `schedule:${schedule._id}:reminders`,
    JSON.stringify(jobs),
    'EX',
    Math.max(3600, Math.ceil((schedule.scheduledFor.getTime() - Date.now()) / 1000)),
  );
};

const removeScheduleReminders = async (jobIds: string[]) => {
  await Promise.all(jobIds.map((jobId) => removeReminder(jobId)));
};

export const createSchedule = asyncHandler(async (req, res) => {
  if (req.body.scheduledFor <= new Date()) {
    throw new AppError('Scheduled time must be in the future', 400, 'INVALID_SCHEDULE_TIME');
  }

  const interviewId = req.body.interviewId ? String(req.body.interviewId).trim() : '';
  if (interviewId) {
    const owned = await Interview.findOne({ _id: interviewId, userId: req.userId }).select('_id');
    if (!owned) {
      throw new AppError('Interview not found for this account', 403, 'INTERVIEW_FORBIDDEN');
    }
  }

  const schedule = await Schedule.create({
    userId: req.userId,
    title: req.body.title,
    scheduledFor: req.body.scheduledFor,
    timezone: req.body.timezone,
    notes: req.body.notes,
    ...(interviewId ? { interviewId } : {}),
  });

  await scheduleReminders(schedule);
  await schedule.save();

  res.status(201).json(schedule);
});

export const listSchedules = asyncHandler(async (req, res) => {
  const schedules = await Schedule.find({ userId: req.userId }).sort({ scheduledFor: 1 });
  res.json(schedules);
});

export const reschedule = asyncHandler(async (req, res) => {
  const schedule = await Schedule.findOne({ _id: req.params.id, userId: req.userId });
  if (!schedule) {
    throw new AppError('Schedule not found', 404, 'SCHEDULE_NOT_FOUND');
  }

  await removeScheduleReminders(schedule.reminderJobIds);
  Object.assign(schedule, req.body, { status: 'Rescheduled' });
  await scheduleReminders(schedule);
  await schedule.save();

  res.json(schedule);
});

export const cancelSchedule = asyncHandler(async (req, res) => {
  const schedule = await Schedule.findOne({ _id: req.params.id, userId: req.userId });
  if (!schedule) {
    throw new AppError('Schedule not found', 404, 'SCHEDULE_NOT_FOUND');
  }

  await removeScheduleReminders(schedule.reminderJobIds);
  schedule.status = 'Cancelled';
  schedule.reminderJobIds = [];
  await schedule.save();
  await getRedis().del(`schedule:${schedule._id}:reminders`);

  res.json(schedule);
});
