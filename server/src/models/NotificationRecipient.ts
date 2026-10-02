import mongoose, { Document, Model, Schema } from 'mongoose';

export type ChannelDeliveryStatus = 'pending' | 'delivered' | 'failed' | 'skipped';

export interface INotificationRecipient extends Document {
  notificationId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  read: boolean;
  readAt?: Date;
  inAppStatus: ChannelDeliveryStatus;
  inAppDeliveredAt?: Date;
  emailStatus: ChannelDeliveryStatus;
  emailError?: string;
  emailDeliveredAt?: Date;
}

const notificationRecipientSchema = new Schema<INotificationRecipient>(
  {
    notificationId: { type: Schema.Types.ObjectId, ref: 'Notification', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    read: { type: Boolean, default: false, index: true },
    readAt: { type: Date },
    inAppStatus: { type: String, enum: ['pending', 'delivered', 'failed', 'skipped'], default: 'pending' },
    inAppDeliveredAt: { type: Date },
    emailStatus: { type: String, enum: ['pending', 'delivered', 'failed', 'skipped'], default: 'skipped' },
    emailError: { type: String },
    emailDeliveredAt: { type: Date },
  },
  { timestamps: true },
);

notificationRecipientSchema.index({ userId: 1, read: 1, createdAt: -1 });
notificationRecipientSchema.index({ notificationId: 1, userId: 1 }, { unique: true });

export const NotificationRecipient =
  (mongoose.models.NotificationRecipient as Model<INotificationRecipient> | undefined)
  ?? mongoose.model<INotificationRecipient>('NotificationRecipient', notificationRecipientSchema);
