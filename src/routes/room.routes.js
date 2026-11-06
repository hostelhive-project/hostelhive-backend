const router = require('express').Router();
const roomController = require('../controllers/room.controller');
const authenticate = require('../middleware/auth.middleware');
const requireRole = require('../middleware/rbac.middleware');
const scopeToOwnHostel = require('../middleware/hostelScope.middleware');
const validate = require('../middleware/validate');
const roomService = require('../services/room.service');
const { updateRoomSchema, roomStatusSchema } = require('../validators/hostel.validator');

router.get('/:id', roomController.getById);

router.put(
  '/:id',
  authenticate,
  requireRole('Admin'),
  scopeToOwnHostel(roomService.loaderById),
  validate(updateRoomSchema),
  roomController.update
);

router.patch(
  '/:id/status',
  authenticate,
  requireRole('Admin'),
  scopeToOwnHostel(roomService.loaderById),
  validate(roomStatusSchema),
  roomController.updateStatus
);

router.delete(
  '/:id',
  authenticate,
  requireRole('Admin'),
  scopeToOwnHostel(roomService.loaderById),
  roomController.remove
);

module.exports = router;
