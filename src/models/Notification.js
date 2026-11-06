const mongoose = require('mongoose');

const { Schema } = mongoose;

const NOTIFICATION_TYPES = [
  'RentDue',
  'ComplaintUpdate',
  'BookingUpdate',
  'TaskAssigned',
  'Announcement',
];

/**
 * Added collection. EP-07 / PB-14 / UC-14 / NFR-15 and two sequence diagrams
 * (Fig 6, Fig 7) all require notifications, but no collection existed to store
 * them — the SDS only named FCM as a delivery mechanism, not a persisted entity.
 */
const notificationSchema = new Schema(
  {
    deliveryKey: { type: String, unique: true, sparse: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    isRead: { type: Boolean, default: false },
    relatedEntityId: { type: Schema.Types.ObjectId, default: null }, // polymorphic
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
module.exports.NOTIFICATION_TYPES = NOTIFICATION_TYPES;
