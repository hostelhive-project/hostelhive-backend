const catchAsync = require('../utils/catchAsync');
const { success } = require('../utils/response');
const AppError = require('../utils/AppError');
const adminDashboardService = require('../services/adminDashboard.service');

const adminDashboardController = {
  summary: catchAsync(async (req, res) => {
    if (!req.user.hostelId) {
      throw new AppError('Your account is not yet assigned to a hostel — create one first', 400);
    }
    const summary = await adminDashboardService.getSummary(req.user.hostelId);
    return success(res, 200, summary);
  }),

  recentActivity: catchAsync(async (req, res) => {
    if (!req.user.hostelId) {
      throw new AppError('Your account is not yet assigned to a hostel — create one first', 400);
    }
    const activity = await adminDashboardService.getRecentActivity(req.user.hostelId, Number(req.query.limit) || 10);
    return success(res, 200, activity);
  }),
};

module.exports = adminDashboardController;
