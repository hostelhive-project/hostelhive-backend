const unitOfWork = require('./unitOfWork');
const Payment = require('../models/Payment');
const Invoice = require('../models/Invoice');
const PaymentAdjustment = require('../models/PaymentAdjustment');

module.exports = {
  record(charge, dispute) {
    return unitOfWork(async (session) => {
      const intentId = typeof charge.payment_intent === 'object' ? charge.payment_intent?.id : charge.payment_intent;
      const payment = intentId ? await Payment.findOne({ paymentIntentId: intentId }).session(session) : null;
      if (!payment || payment.paymentStatus !== 'Paid') {
        // Settlement may still be awaiting delivery. Retrying is safe; never
        // acknowledge an uncorrelated financial reversal as reconciled.
        if (!payment && !charge.metadata?.paymentId && !charge.metadata?.invoiceId) return null;
        throw new Error('Payment settlement is not ready for this adjustment.');
      }
      const denominator = payment.chargedAmountCents || charge.amount;
      if (!(denominator > 0)) throw new Error('Original charged amount is unavailable.');
      const refundedCents = Math.min(denominator, Math.max(payment.refundedCents || 0, charge.amount_refunded || 0));
      const refundedAmount = Math.round(payment.amount * refundedCents / denominator * 100) / 100;
      const refundDelta = refundedAmount - (payment.refundedAmount || 0);
      if (refundDelta > 0) await PaymentAdjustment.create([{
        _id: `refund:${payment.id}:${refundedCents}`, paymentId: payment._id, hostelId: payment.hostelId,
        kind: 'Refund', amount: -refundDelta,
      }], { session });
      payment.refundedCents = refundedCents;
      payment.refundedAmount = refundedAmount;
      if (dispute) {
        payment.disputeId = dispute.id;
        payment.disputeStatus = dispute.status;
        payment.disputedCents = dispute.amount;
      }
      if (payment.disputeId) {
        const disputedAmount = payment.disputedCents > 0
          ? Math.round(payment.amount * payment.disputedCents / denominator * 100) / 100
          : payment.disputedAmount;
        payment.disputedAmount = Math.max(0, Math.min(payment.amount - refundedAmount, disputedAmount));
        const loss = payment.disputeStatus === 'lost' ? payment.disputedAmount : 0;
        const delta = loss - (payment.disputeLossAmount || 0);
        if (delta !== 0) await PaymentAdjustment.create([{
          _id: `dispute:${payment.disputeId}:${payment.disputeStatus}:${refundedCents}:${loss}`, paymentId: payment._id, hostelId: payment.hostelId,
          kind: 'Dispute', amount: -delta,
        }], { session });
        payment.disputeLossAmount = loss;
      }
      await payment.save({ session });
      const allPayments = await Payment.find({ invoiceId: payment.invoiceId, paymentStatus: 'Paid' }).session(session);
      await Invoice.updateOne({ _id: payment.invoiceId }, { $set: {
        refundedAmount: allPayments.reduce((sum, item) => sum + (item.refundedAmount || 0), 0),
        disputeStatus: dispute?.status || payment.disputeStatus,
      } }, { session });
      return payment;
    });
  },
  totalForPeriod: (hostelId, since) => PaymentAdjustment.aggregate([
    { $match: { hostelId, recordedAt: { $gte: since } } }, { $group: { _id: null, total: { $sum: '$amount' } } },
  ]),
  associateIntent: (reference, intent) => Payment.updateOne({ transactionReference: reference }, { $set: { paymentIntentId: intent } }),
};
