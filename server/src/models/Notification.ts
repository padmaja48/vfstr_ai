import mongoose, { Document, Model, Schema } from 'mongoose';

export const NOTIFICATION_AUDIENCE_TYPES = ['all', 'institution', 'plan', 'readinessLevel'] as const;
export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'sms', 'push'] as const;
export const NOTIFICATION_STATUSES = ['draft', 'scheduled', 'sent', 'failed', 'partially_sent'] as const;

export type NotificationAudienceType = (typeof NOTIFICATION_AUDIENCE_TYPES)[number];
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export type NotificationDeliveryStats = {
  attempted: number;
  succeeded: number;
  failed: number;
  recipients: number;
  inAppDelivered: number;
  emailDelivered: number;
  emailFailed: number;
};

export interface INotification extends Document {
  title: string;
  body: string;
  audienceType: NotificationAudienceType;
  audienceValue?: string;
  audienceLabel?: string;
  channels: NotificationChannel[];
  scheduledAt?: Date;
  status: NotificationStatus;
  createdBy: mongoose.Types.ObjectId;
  sentAt?: Date;
  deliveryStats: NotificationDeliveryStats;
  scheduleJobId?: string;
}

const deliveryStatsSchema = new Schema<NotificationDeliveryStats>(
  {
    attempted: { type: Number, default: 0 },
    succeeded: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    recipients: { type: Number, default: 0 },
    inAppDelivered: { type: Number, default: 0 },
    emailDelivered: { type: Number, default: 0 },
    emailFailed: { type: Number, default: 0 },
  },
  { _id: false },
);

const notificationSchema = new Schema<INotification>(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, required: true, trim: true, maxlength: 8000 },
    audienceType: { type: String, enum: NOTIFICATION_AUDIENCE_TYPES, required: true, index: true },
    audienceValue: { type: String, trim: true },
    audienceLabel: { type: String, trim: true },
    channels: { type: [String], default: ['in_app'] },
    scheduledAt: { type: Date, index: true },
    status: { type: String, enum: NOTIFICATION_STATUSES, default: 'draft', index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sentAt: { type: Date },
    deliveryStats: { type: deliveryStatsSchema, default: () => ({}) },
    scheduleJobId: { type: String },
  },
  { timestamps: true },
);

export const Notification =
  (mongoose.models.Notification as Model<INotification> | undefined)
  ?? mongoose.model<INotification>('Notification', notificationSchema);
