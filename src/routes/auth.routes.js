const router = require('express').Router();
const authController = require('../controllers/auth.controller');
const authenticate = require('../middleware/auth.middleware');
const requireRole = require('../middleware/rbac.middleware');
const validate = require('../middleware/validate');
const accountRateLimit = require('../middleware/accountRateLimit.middleware');
const {
  registerSchema,
  loginSchema,
  refreshSchema,
  emailOtpSchema,
  emailSchema,
  resetPasswordSchema,
  activateStaffInviteSchema,
  changePasswordSchema,
} = require('../validators/auth.validator');

router.post('/register', validate(registerSchema), accountRateLimit('signup', 5), authController.register);
router.post('/verify-email', validate(emailOtpSchema), accountRateLimit('verification', 20), authController.verifyEmail);
router.post(
  '/activate-staff-invite',
  validate(activateStaffInviteSchema),
  accountRateLimit('activation', 20),
  authController.activateStaffInvite
);
router.post('/resend-verification', validate(emailSchema), accountRateLimit('resend', 5), authController.resendVerificationCode);
router.post('/forgot-password', validate(emailSchema), accountRateLimit('recovery', 5), authController.requestPasswordReset);
router.post('/reset-password', validate(resetPasswordSchema), accountRateLimit('reset', 20), authController.resetPassword);
router.post(
  '/change-password',
  authenticate,
  requireRole('Student', 'Admin', 'CleaningStaff'),
  validate(changePasswordSchema),
  accountRateLimit('change-password', 10),
  authController.changePassword
);
router.post('/login', validate(loginSchema), accountRateLimit('login', 15), authController.login);
router.post('/refresh', validate(refreshSchema), authController.refresh);
router.post('/logout', authenticate, authController.logout);
router.get('/me', authenticate, authController.me);

module.exports = router;
