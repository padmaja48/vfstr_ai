import mongoose, { Document, Model, Schema } from 'mongoose';

export type ScheduleStatus = 'Scheduled' | 'Rescheduled' | 'Cancelled' | 'Completed';

export interface ISchedule extends Document {
  userId: mongoose.Types.ObjectId;
  interviewId?: mongoose.Types.ObjectId;
  title: string;
  scheduledFor: Date;
  timezone: string;
  status: ScheduleStatus;
  reminderJobIds: string[];
  notes?: string;
}

const scheduleSchema = new Schema<ISchedule>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    interviewId: { type: Schema.Types.ObjectId, ref: 'Interview' },
    title: { type: String, required: true },
    scheduledFor: { type: Date, required: true, index: true },
    timezone: { type: String, default: 'UTC' },
    status: {
      type: String,
      enum: ['Scheduled', 'Rescheduled', 'Cancelled', 'Completed'],
      default: 'Scheduled',
      index: true,
    },
    reminderJobIds: { type: [String], default: [] },
    notes: String,
  },
  { timestamps: true },
);

export const Schedule =
  (mongoose.models.Schedule as Model<ISchedule> | undefined) ??
  mongoose.model<ISchedule>('Schedule', scheduleSchema);
