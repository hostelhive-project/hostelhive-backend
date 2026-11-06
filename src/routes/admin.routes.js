const router = require('express').Router();
const adminDashboardController = require('../controllers/adminDashboard.controller');
const authenticate = require('../middleware/auth.middleware');
const requireRole = require('../middleware/rbac.middleware');

router.use(authenticate, requireRole('Admin'));

router.get('/dashboard/summary', adminDashboardController.summary);
router.get('/dashboard/recent-activity', adminDashboardController.recentActivity);

module.exports = router;
