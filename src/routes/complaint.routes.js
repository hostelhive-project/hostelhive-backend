const router = require('express').Router();
const complaintController = require('../controllers/complaint.controller');
const authenticate = require('../middleware/auth.middleware');
const requireRole = require('../middleware/rbac.middleware');
const scopeToOwnHostel = require('../middleware/hostelScope.middleware');
const validate = require('../middleware/validate');
const complaintService = require('../services/complaint.service');
const {
  createComplaintSchema,
  assignComplaintSchema,
  updateStatusSchema,
  markFixedSchema,
  residentComplaintActionSchema,
} = require('../validators/complaint.validator');

router.use(authenticate);

// Resident
router.post('/', requireRole('Student'), validate(createComplaintSchema), complaintController.create);
router.get('/mine', requireRole('Student'), complaintController.myComplaints);
router.get('/assigned', requireRole('CleaningStaff'), complaintController.assignedToMe);
router.patch(
  '/:id/mark-fixed',
  requireRole('CleaningStaff'),
  validate(markFixedSchema),
  complaintController.markFixed
);
router.patch(
  '/:id/confirm-resolution',
  requireRole('Student'),
  validate(residentComplaintActionSchema),
  complaintController.confirmResolved
);
router.patch(
  '/:id/reopen',
  requireRole('Student'),
  validate(residentComplaintActionSchema),
  complaintController.reopen
);

// Admin
router.get('/', requireRole('Admin'), complaintController.listAll);
router.patch(
  '/:id/assign',
  requireRole('Admin'),
  scopeToOwnHostel(complaintService.loaderById),
  validate(assignComplaintSchema),
  complaintController.assign
);
router.patch(
  '/:id/status',
  requireRole('Admin'),
  scopeToOwnHostel(complaintService.loaderById),
  validate(updateStatusSchema),
  complaintController.updateStatus
);

router.get('/:id', complaintController.getById);

module.exports = router;
