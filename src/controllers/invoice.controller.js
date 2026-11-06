const catchAsync = require('../utils/catchAsync');
const { success } = require('../utils/response');
const AppError = require('../utils/AppError');
const invoiceService = require('../services/invoice.service');

const invoiceController = {
  getById: catchAsync(async (req, res) => {
    const invoice = await invoiceService.getById(req.params.id, req.user);
    return success(res, 200, invoice);
  }),

  getReceipt: catchAsync(async (req, res) => {
    const receipt = await invoiceService.getReceipt(req.params.id, req.user);
    return success(res, 200, receipt);
  }),

  listForBooking: catchAsync(async (req, res) => {
    const invoices = await invoiceService.listForBooking(req.params.bookingId, req.user);
    return success(res, 200, invoices);
  }),

  // Manual trigger — lets you test invoicing without waiting for the monthly cron.
  generateForBooking: catchAsync(async (req, res) => {
    const bookingId = req.params.id || req.params.bookingId;
    const invoice = await invoiceService.generateForBooking(bookingId, req.body);
    return success(res, 201, invoice, 'Invoice generated');
  }),

  generateForAll: catchAsync(async (req, res) => {
    if (!req.user.hostelId) {
      throw new AppError('Your account is not assigned to a hostel', 400);
    }
    const results = await invoiceService.generateForHostelActiveBookings(
      req.user.hostelId,
      req.body?.billingMonth
    );
    return success(res, 200, results, 'Monthly invoice generation run complete for your hostel');
  }),

  // Temporary manual settlement, until a payment gateway is wired back in.
  // Lets an Admin record a rent payment collected outside the app (cash,
  // bank transfer, whatever) so the resident's dues still reflect reality.
  markPaid: catchAsync(async (req, res) => {
    const invoice = await invoiceService.markInvoiceStatus(req.params.id, 'Paid', req.user.id, req.body);
    return success(res, 200, invoice, 'Invoice marked as paid (manual/offline record)');
  }),

  listForHostel: catchAsync(async (req, res) => {
    const invoices = await invoiceService.listForHostel(req.params.hostelId, req.query.status);
    return success(res, 200, invoices);
  }),
};

module.exports = invoiceController;
