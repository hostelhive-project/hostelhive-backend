const router = require('express').Router();
const userController = require('../controllers/user.controller');
const authenticate = require('../middleware/auth.middleware');
const requireRole = require('../middleware/rbac.middleware');
const scopeToOwnHostel = require('../middleware/hostelScope.middleware');
const validate = require('../middleware/validate');
const userService = require('../services/user.service');
const {
  updateProfileSchema,
  createStaffSchema,
  updateStaffSchema,
  updateStaffInvitationSchema,
  deleteStaffSchema,
} = require('../validators/user.validator');

// UC-03 / PB-03 Profile Management & Staff directory
router.use(authenticate);
router.post(
  '/staff',
  requireRole('Admin'),
  validate(createStaffSchema),
  userController.createStaff
);
router.get(
  '/hostel/:hostelId/staff',
  requireRole('Admin'),
  scopeToOwnHostel((req) => ({ hostelId: req.params.hostelId })),
  userController.listStaffForHostel
);
router.patch(
  '/staff/:id/invitation',
  requireRole('Admin'),
  scopeToOwnHostel((req) => userService.getById(req.params.id)),
  validate(updateStaffInvitationSchema),
  userController.updateStaffInvitation
);
router.post(
  '/staff/:id/invitation/resend',
  requireRole('Admin'),
  scopeToOwnHostel((req) => userService.getById(req.params.id)),
  validate(deleteStaffSchema),
  userController.resendStaffInvitation
);
router.delete(
  '/staff/:id/invitation',
  requireRole('Admin'),
  scopeToOwnHostel((req) => userService.getById(req.params.id)),
  validate(deleteStaffSchema),
  userController.cancelStaffInvitation
);
router.patch(
  '/staff/:id',
  requireRole('Admin'),
  scopeToOwnHostel((req) => userService.getById(req.params.id)),
  validate(updateStaffSchema),
  userController.updateStaff
);
router.delete(
  '/staff/:id',
  requireRole('Admin'),
  scopeToOwnHostel((req) => userService.getById(req.params.id)),
  validate(deleteStaffSchema),
  userController.deleteStaff
);
router.get('/:id', userController.getById);
router.put('/:id', validate(updateProfileSchema), userController.updateById);

module.exports = router;
