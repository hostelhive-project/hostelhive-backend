const Notification = require('../models/Notification');

const notificationRepository = {
  create(data) {
    if (data.deliveryKey) return Notification.findOneAndUpdate({ deliveryKey: data.deliveryKey },
      { $setOnInsert: data }, { upsert: true, new: true, runValidators: true });
    return Notification.create(data);
  },
  findForUser(userId, { unreadOnly = false, limit = 50 } = {}) {
    const filter = { userId };
    if (unreadOnly) filter.isRead = false;
    return Notification.find(filter).sort({ createdAt: -1 }).limit(limit);
  },
  countUnread(userId) {
    return Notification.countDocuments({ userId, isRead: false });
  },
  markRead(id, userId) {
    return Notification.findOneAndUpdate({ _id: id, userId }, { isRead: true }, { new: true });
  },
  markAllRead(userId) {
    return Notification.updateMany({ userId, isRead: false }, { isRead: true });
  },
};

module.exports = notificationRepository;
