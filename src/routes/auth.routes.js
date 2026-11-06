const router = require('express').Router();
const authController = require('../controllers/auth.controller');
const authenticate = require('../middleware/auth.middleware');
const requireRole = require('../middleware/rbac.middleware');
const validate = require('../middleware/validate');
const rateLimit = require('express-rate-limit');
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

const authActionLimiter = () => rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please try again later.' },
});

router.post('/register', authActionLimiter(), validate(registerSchema), accountRateLimit('signup', 5), authController.register);
router.post('/verify-email', authActionLimiter(), validate(emailOtpSchema), accountRateLimit('verification', 20), authController.verifyEmail);
router.post(
  '/activate-staff-invite',
  authActionLimiter(),
  validate(activateStaffInviteSchema),
  accountRateLimit('activation', 20),
  authController.activateStaffInvite
);
router.post('/resend-verification', authActionLimiter(), validate(emailSchema), accountRateLimit('resend', 5), authController.resendVerificationCode);
router.post('/forgot-password', authActionLimiter(), validate(emailSchema), accountRateLimit('recovery', 5), authController.requestPasswordReset);
router.post('/reset-password', authActionLimiter(), validate(resetPasswordSchema), accountRateLimit('reset', 20), authController.resetPassword);
router.post(
  '/change-password',
  authActionLimiter(),
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
