const catchAsync = require('../utils/catchAsync');
const { success } = require('../utils/response');
const authService = require('../services/auth.service');

const authController = {
  register: catchAsync(async (req, res) => {
    const result = await authService.register(req.body);
    return success(res, 202, result, 'Check your email for a verification code');
  }),

  verifyEmail: catchAsync(async (req, res) => {
    const { user, tokens } = await authService.verifyEmail(req.body);
    return success(res, 200, { user, ...tokens }, 'Email verified successfully');
  }),

  activateStaffInvite: catchAsync(async (req, res) => {
    const { user, tokens } = await authService.activateStaffInvite(req.body);
    return success(res, 200, { user, ...tokens }, 'Staff account activated successfully');
  }),

  resendVerificationCode: catchAsync(async (req, res) => {
    await authService.resendVerificationCode(req.body);
    return success(res, 200, null, 'If the account is awaiting verification, a code will be sent');
  }),

  requestPasswordReset: catchAsync(async (req, res) => {
    await authService.requestPasswordReset(req.body);
    return success(res, 200, null, 'If an account exists, a reset code will be sent');
  }),

  resetPassword: catchAsync(async (req, res) => {
    await authService.resetPassword(req.body);
    return success(res, 200, null, 'Password reset successfully');
  }),

  changePassword: catchAsync(async (req, res) => {
    await authService.changePassword({ userId: req.user.id, ...req.body });
    return success(res, 200, null, 'Password changed successfully');
  }),

  login: catchAsync(async (req, res) => {
    const { user, tokens } = await authService.login(req.body);
    return success(res, 200, { user, ...tokens }, 'Logged in successfully');
  }),

  refresh: catchAsync(async (req, res) => {
    const tokens = await authService.refresh(req.body.refreshToken);
    return success(res, 200, tokens, 'Token refreshed');
  }),

  logout: catchAsync(async (req, res) => {
    // Revoke the user's refresh sessions and increment the access-token version.
    await authService.logout(req.user.id);
    return success(res, 200, null, 'Logged out');
  }),

  me: catchAsync(async (req, res) => {
    return success(res, 200, req.user);
  }),
};

module.exports = authController;
