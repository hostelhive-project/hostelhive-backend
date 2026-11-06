const router = require('express').Router();
const notificationController = require('../controllers/notification.controller');
const authenticate = require('../middleware/auth.middleware');

router.use(authenticate);

router.get('/', notificationController.list); // ?unread=true
router.get('/unread-count', notificationController.unreadCount);
router.patch('/:id/read', notificationController.markRead);
router.patch('/read-all', notificationController.markAllRead);

module.exports = router;
