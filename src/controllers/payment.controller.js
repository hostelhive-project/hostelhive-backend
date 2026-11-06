const catchAsync = require('../utils/catchAsync');
const { success } = require('../utils/response');
const paymentService = require('../services/payment.service');

const paymentController = {
  // Admin — connect the hostel's Stripe account
  getOnboardingLink: catchAsync(async (req, res) => {
    const result = await paymentService.getOrCreateOnboardingLink(req.params.hostelId, req.user.id);
    return success(res, 200, result, 'Open this link to finish connecting your hostel to Stripe');
  }),

  getOnboardingStatus: catchAsync(async (req, res) => {
    const status = await paymentService.syncOnboardingStatus(req.params.hostelId);
    return success(res, 200, status);
  }),

  // Resident — pay an invoice
  checkout: catchAsync(async (req, res) => {
    const { payment, checkoutUrl, reused } = await paymentService.initiateCheckout(
      req.body.invoiceId,
      req.user.id
    );
    return success(
      res,
      reused ? 200 : 201,
      { paymentId: payment._id, checkoutUrl },
      reused ? 'Existing checkout session resumed' : 'Checkout session created'
    );
  }),

  getById: catchAsync(async (req, res) => {
    const payment = await paymentService.getById(req.params.id, req.user);
    return success(res, 200, payment);
  }),

  listForInvoice: catchAsync(async (req, res) => {
    const payments = await paymentService.listForInvoice(req.params.invoiceId, req.user);
    return success(res, 200, payments);
  }),

  /**
   * Stripe webhook. Requires the RAW request body for signature verification
   * (see app.js — this route is mounted with express.raw(), not express.json()).
   */
  webhook: catchAsync(async (req, res) => {
    await paymentService.handleWebhook(req.body, req.headers['stripe-signature']);

    res.status(200).json({ received: true });
  }),
};

module.exports = paymentController;
