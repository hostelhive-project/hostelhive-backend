const catchAsync = require('../utils/catchAsync');
const { success } = require('../utils/response');
const notificationService = require('../services/notification.service');

const notificationController = {
  list: catchAsync(async (req, res) => {
    const notifications = await notificationService.listForUser(req.user.id, {
      unreadOnly: req.query.unread === 'true',
    });
    return success(res, 200, notifications);
  }),

  unreadCount: catchAsync(async (req, res) => {
    const count = await notificationService.countUnread(req.user.id);
    return success(res, 200, { count });
  }),

  markRead: catchAsync(async (req, res) => {
    const notification = await notificationService.markRead(req.params.id, req.user.id);
    return success(res, 200, notification);
  }),

  markAllRead: catchAsync(async (req, res) => {
    await notificationService.markAllRead(req.user.id);
    return success(res, 200, null, 'All notifications marked as read');
  }),
};

module.exports = notificationController;
