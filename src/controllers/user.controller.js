const catchAsync = require('../utils/catchAsync');
const { success } = require('../utils/response');
const AppError = require('../utils/AppError');
const userService = require('../services/user.service');


const userController = {
  getById: catchAsync(async (req, res) => {
    return success(res, 200, await userService.getForViewer(req.params.id, req.user));
  }),

  updateById: catchAsync(async (req, res) => {
    const isSelf = req.params.id === req.user.id;
    if (!isSelf) {
      throw new AppError('You can only update your own profile', 403);
    }
    const user = await userService.updateSelf(req.params.id, req.body);
    return success(res, 200, user, 'Profile updated');
  }),

  listStaffForHostel: catchAsync(async (req, res) => {
    const staff = await userService.listStaffForHostel(req.params.hostelId);
    return success(res, 200, staff);
  }),

  createStaff: catchAsync(async (req, res) => {
    const staff = await userService.createStaff(req.user, req.body);
    return success(res, 201, staff, 'Staff invitation sent. The member must verify their email and set a password to activate the account.');
  }),

  updateStaff: catchAsync(async (req, res) => {
    const staff = await userService.updateStaff(req.user, req.params.id, req.body);
    return success(res, 200, staff, 'Staff member updated successfully');
  }),

  updateStaffInvitation: catchAsync(async (req, res) => {
    const invitation = await userService.updateStaffInvitation(req.user, req.params.id, req.body);
    return success(res, 200, invitation, 'Invitation updated and a new verification code sent');
  }),

  resendStaffInvitation: catchAsync(async (req, res) => {
    await userService.resendStaffInvitation(req.user, req.params.id);
    return success(res, 200, null, 'A new verification code was sent');
  }),

  cancelStaffInvitation: catchAsync(async (req, res) => {
    await userService.cancelStaffInvitation(req.user, req.params.id);
    return success(res, 200, null, 'Pending staff invitation cancelled');
  }),

  deleteStaff: catchAsync(async (req, res) => {
    const staff = await userService.deleteStaff(req.user, req.params.id);
    return success(res, 200, staff, 'Staff member removed from your hostel');
  }),
};

module.exports = userController;
