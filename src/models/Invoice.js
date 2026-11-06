const mongoose = require('mongoose');

const { Schema } = mongoose;

const INVOICE_STATUSES = ['Unpaid', 'PartiallyPaid', 'Paid', 'Overdue'];

/**
 * Added collection (not in the original ERD). The ERD modeled Booking -> Payment
 * as "bills Exactly 1", but the Rent Payments screen shows recurring monthly
 * charges with payment history.
 * Correct chain: Booking (1) -> Invoice (1..*, one per billing month) -> Payment (0..*).
 */
const invoiceSchema = new Schema(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
    billingMonth: { type: String, required: true }, // e.g. "2026-09"
    rentAmount: { type: Number, required: true, min: 0 },
    totalDue: { type: Number, required: true, min: 0 },
    status: { type: String, enum: INVOICE_STATUSES, default: 'Unpaid' },
    refundedAmount: { type: Number, default: 0 },
    disputeStatus: { type: String, default: null },
    dueDate: { type: Date, required: true },
    // Internal checkout lock prevents parallel Stripe sessions for one invoice.
    checkoutLockUntil: { type: Date, default: null, select: false },
    checkoutSessionId: { type: String, default: null, select: false },
  },
  { timestamps: true }
);

invoiceSchema.index({ bookingId: 1, billingMonth: 1 }, { unique: true });
invoiceSchema.index({ status: 1, dueDate: 1 });

invoiceSchema.pre('validate', function computeTotal(next) {
  this.totalDue = this.rentAmount || 0;
  next();
});

module.exports = mongoose.model('Invoice', invoiceSchema);
module.exports.INVOICE_STATUSES = INVOICE_STATUSES;
