const router = require('express').Router();
const paymentController = require('../controllers/payment.controller');
const authenticate = require('../middleware/auth.middleware');
const requireRole = require('../middleware/rbac.middleware');
const validate = require('../middleware/validate');
const scopeToOwnHostel = require('../middleware/hostelScope.middleware');
const paymentService = require('../services/payment.service');
const { checkoutSchema } = require('../validators/payment.validator');

router.use(authenticate);

router.post('/checkout', requireRole('Student'), validate(checkoutSchema), paymentController.checkout);
router.get(
  '/:id',
  requireRole('Student', 'Admin'),
  scopeToOwnHostel(paymentService.loaderById),
  paymentController.getById
);
router.get(
  '/invoice/:invoiceId',
  requireRole('Student', 'Admin'),
  paymentController.listForInvoice
);

module.exports = router;
