const AppError = require('../utils/AppError');
const notificationRepository = require('../repositories/notification.repository');
const { sendPush } = require('../integrations/firebase');
const { User: User } = require('../repositories/data.repository');

const notificationService = {
  /**
   * The one function every other module calls. Always writes the in-app
   * Notification first (this is the part that must never fail silently),
   * then best-effort attempts a push — a failed/skipped push never rolls
   * back or blocks the in-app write.
   */
  async notify({ userId, type, title, body, relatedEntityId = null, deliveryKey }) {
    const notification = await notificationRepository.create({ userId, type, title, body, relatedEntityId, ...(deliveryKey ? { deliveryKey } : {}) });

    const user = await User.findById(userId).select('deviceToken');
    if (user?.deviceToken) {
      // Intentionally not awaited-and-thrown — see integrations/firebase.js.
      sendPush({ deviceToken: user.deviceToken, title, body, data: {
        notificationId: String(notification._id), userId: String(userId), type,
        ...(relatedEntityId ? { relatedEntityId: String(relatedEntityId) } : {}),
      } }).catch(() => {});
    }

    return notification;
  },

  listForUser(userId, opts) {
    return notificationRepository.findForUser(userId, opts);
  },

  countUnread(userId) {
    return notificationRepository.countUnread(userId);
  },

  async markRead(id, userId) {
    const notification = await notificationRepository.markRead(id, userId);
    if (!notification) throw new AppError('Notification not found', 404);
    return notification;
  },

  markAllRead(userId) {
    return notificationRepository.markAllRead(userId);
  },
};

module.exports = notificationService;
