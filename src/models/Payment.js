const mongoose = require('mongoose');

const { Schema } = mongoose;

const PAYMENT_STATUSES = ['Unpaid', 'Paid', 'Processing', 'Failed'];
const PAYMENT_METHODS = ['Card', 'Cash', 'BankTransfer', 'JazzCash', 'EasyPaisa'];

/**
 * Rebuilt for Stripe Connect (see AGENTS.md "Payments"). A Payment settles
 * an Invoice; the money itself goes straight to the owning Hostel's
 * connected Stripe account (stripeAccountId), never into a HostelHive
 * balance. This document exists purely as our record of what happened —
 * we are a record-keeper, not a money-holder, per project decision.
 */
const paymentSchema = new Schema(
  {
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true },
    hostelId: { type: Schema.Types.ObjectId, ref: 'Hostel', required: true }, // denormalized for fast lookups/reporting
    amount: { type: Number, required: true, min: 0 },
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: 'Processing' },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, default: 'Card' },
    stripeAccountId: { type: String, default: null }, // offline payments do not have a Stripe account
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    chargedAmountCents: { type: Number, default: null },
    chargedCurrency: { type: String, default: null },
    exchangeRate: { type: Number, default: null },
    paymentIntentId: { type: String, default: null, index: true },
    lastFailureCode: { type: String, default: null },
    refundedAmount: { type: Number, default: 0 },
    refundedCents: { type: Number, default: 0 },
    disputedAmount: { type: Number, default: 0 },
    disputedCents: { type: Number, default: 0 },
    disputeStatus: { type: String, default: null },
    disputeLossAmount: { type: Number, default: 0 },
    disputeId: { type: String, default: null },
    transactionReference: { type: String, unique: true, sparse: true }, // Stripe Checkout Session id
    transactionDate: { type: Date },
    blockchainRef: { type: String, default: null },
  },
  { timestamps: true }
);

paymentSchema.index({ invoiceId: 1 });
paymentSchema.index({ hostelId: 1, paymentStatus: 1 });

module.exports = mongoose.model('Payment', paymentSchema);
module.exports.PAYMENT_STATUSES = PAYMENT_STATUSES;
module.exports.PAYMENT_METHODS = PAYMENT_METHODS;
