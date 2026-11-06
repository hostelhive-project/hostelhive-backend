const router = require('express').Router();
const cleaningTaskController = require('../controllers/cleaningTask.controller');
const authenticate = require('../middleware/auth.middleware');
const requireRole = require('../middleware/rbac.middleware');
const scopeToOwnHostel = require('../middleware/hostelScope.middleware');
const validate = require('../middleware/validate');
const cleaningTaskService = require('../services/cleaningTask.service');
const { Room: Room } = require('../repositories/data.repository');
const {
  assignTaskSchema,
  completeTaskSchema,
  delayTaskSchema,
  startTaskSchema,
  broadcastDirectiveSchema,
} = require('../validators/cleaningTask.validator');

router.use(authenticate);

// Admin — assignment & directives
router.post(
  '/',
  requireRole('Admin'),
  scopeToOwnHostel((req) => Room.findById(req.body.roomId)),
  validate(assignTaskSchema),
  cleaningTaskController.assign
);
router.get(
  '/hostel/:hostelId',
  requireRole('Admin'),
  scopeToOwnHostel((req) => ({ hostelId: req.params.hostelId })),
  cleaningTaskController.listForHostel
);
router.get(
  '/directive',
  requireRole('Admin'),
  cleaningTaskController.getDirective
);
router.post(
  '/directive',
  requireRole('Admin'),
  validate(broadcastDirectiveSchema),
  cleaningTaskController.broadcastDirective
);

// CleaningStaff — my work queue + lifecycle updates
router.get('/mine', requireRole('CleaningStaff'), cleaningTaskController.myTasks);
router.patch(
  '/:id/start',
  requireRole('CleaningStaff'),
  scopeToOwnHostel(cleaningTaskService.loaderById),
  validate(startTaskSchema),
  cleaningTaskController.start
);
router.patch(
  '/:id/complete',
  requireRole('CleaningStaff'),
  scopeToOwnHostel(cleaningTaskService.loaderById),
  validate(completeTaskSchema),
  cleaningTaskController.complete
);
router.patch(
  '/:id/delay',
  requireRole('CleaningStaff'),
  scopeToOwnHostel(cleaningTaskService.loaderById),
  validate(delayTaskSchema),
  cleaningTaskController.delay
);

router.get(
  '/:id',
  requireRole('Admin', 'CleaningStaff'),
  scopeToOwnHostel(cleaningTaskService.loaderById),
  cleaningTaskController.getById
);

module.exports = router;
