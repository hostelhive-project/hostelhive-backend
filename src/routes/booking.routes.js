const router = require('express').Router();
const bookingController = require('../controllers/booking.controller');
const authenticate = require('../middleware/auth.middleware');
const requireRole = require('../middleware/rbac.middleware');
const scopeToOwnHostel = require('../middleware/hostelScope.middleware');
const validate = require('../middleware/validate');
const bookingService = require('../services/booking.service');
const { createBookingSchema, rejectBookingSchema } = require('../validators/booking.validator');

router.use(authenticate);

// Student
router.post('/', requireRole('Student'), validate(createBookingSchema), bookingController.create);
router.get('/mine', requireRole('Student'), bookingController.myBookings);
router.patch('/:id/cancel', requireRole('Student'), bookingController.cancel);

// Admin — room allocation workflow
router.get(
  '/hostel/:hostelId',
  requireRole('Admin'),
  scopeToOwnHostel((req) => ({ hostelId: req.params.hostelId })),
  bookingController.listForHostel
);
router.get(
  '/hostel/:hostelId/pending',
  requireRole('Admin'),
  scopeToOwnHostel((req) => ({ hostelId: req.params.hostelId })),
  bookingController.pendingForHostel
);
router.get(
  '/hostel/:hostelId/residents',
  requireRole('Admin'),
  scopeToOwnHostel((req) => ({ hostelId: req.params.hostelId })),
  bookingController.residentsForHostel
);
router.patch(
  '/:id/approve',
  requireRole('Admin'),
  scopeToOwnHostel(bookingService.loaderById),
  bookingController.approve
);
router.patch(
  '/:id/reject',
  requireRole('Admin'),
  scopeToOwnHostel(bookingService.loaderById),
  validate(rejectBookingSchema),
  bookingController.reject
);
router.patch(
  '/:id/checkin',
  requireRole('Admin'),
  scopeToOwnHostel(bookingService.loaderById),
  bookingController.checkIn
);
router.patch(
  '/:id/checkout',
  requireRole('Admin'),
  scopeToOwnHostel(bookingService.loaderById),
  bookingController.checkOut
);

// Students may view their own booking; Admins may view bookings in their hostel.
router.get(
  '/:id',
  requireRole('Student', 'Admin'),
  scopeToOwnHostel(bookingService.loaderById),
  bookingController.getById
);

module.exports = router;
