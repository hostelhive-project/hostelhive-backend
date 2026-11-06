const router = require('express').Router();
const invoiceController = require('../controllers/invoice.controller');
const authenticate = require('../middleware/auth.middleware');
const requireRole = require('../middleware/rbac.middleware');
const scopeToOwnHostel = require('../middleware/hostelScope.middleware');
const validate = require('../middleware/validate');
const invoiceService = require('../services/invoice.service');
const bookingService = require('../services/booking.service');
const { generateInvoiceSchema, offlinePaymentSchema } = require('../validators/invoice.validator');

router.use(authenticate);

router.get(
  '/:id/receipt',
  requireRole('Student', 'Admin'),
  scopeToOwnHostel(invoiceService.loaderById),
  invoiceController.getReceipt
);
router.get(
  '/:id',
  requireRole('Student', 'Admin'),
  scopeToOwnHostel(invoiceService.loaderById),
  invoiceController.getById
);
router.get(
  '/booking/:bookingId',
  requireRole('Student', 'Admin'),
  scopeToOwnHostel(bookingService.loaderById),
  invoiceController.listForBooking
);
router.get(
  '/hostel/:hostelId',
  requireRole('Admin'),
  scopeToOwnHostel((req) => ({ hostelId: req.params.hostelId })),
  invoiceController.listForHostel
);

// Manual/admin trigger for testing — the real recurring generation is the cron job in jobs/.
router.post(
  '/booking/:id/generate',
  requireRole('Admin'),
  scopeToOwnHostel(bookingService.loaderById),
  validate(generateInvoiceSchema),
  invoiceController.generateForBooking
);
router.post(
  '/generate-all',
  requireRole('Admin'),
  validate(generateInvoiceSchema),
  invoiceController.generateForAll
);

// Manual settlement for offline payments
router.patch(
  '/:id/mark-paid',
  requireRole('Admin'),
  scopeToOwnHostel(invoiceService.loaderById),
  validate(offlinePaymentSchema),
  invoiceController.markPaid
);

module.exports = router;

