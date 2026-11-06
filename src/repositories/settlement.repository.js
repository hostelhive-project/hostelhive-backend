const unitOfWork = require('./unitOfWork');
const Payment = require('../models/Payment');
const Invoice = require('../models/Invoice');
const Booking = require('../models/Booking');
const outbox = require('./outbox.repository');
const AppError = require('../utils/AppError');

module.exports = {
  settle(checkout) {
    return unitOfWork(async (session) => {
      const reference = checkout.metadata?.paymentId;
      const payment = await Payment.findOne(reference
        ? { _id: reference }
        : { transactionReference: checkout.id }).session(session);
      if (!payment) {
        if (checkout.metadata?.invoiceId) throw new AppError('Payment record is not ready for settlement. Delivery will be retried.', 503);
        return null;
      }
      if (payment.transactionReference && payment.transactionReference !== checkout.id) throw new AppError('Checkout reference does not match the payment.', 409);
      if (checkout.metadata?.invoiceId && String(payment.invoiceId) !== checkout.metadata.invoiceId) throw new AppError('Checkout invoice does not match the payment.', 409);
      if (payment.chargedAmountCents != null && (checkout.amount_total !== payment.chargedAmountCents || checkout.currency !== payment.chargedCurrency)) {
        throw new AppError('Checkout amount or currency does not match the payment.', 409);
      }
      const invoice = await Invoice.findById(payment.invoiceId).session(session);
      if (!invoice) throw new AppError('Invoice is not available for settlement.', 409);
      payment.transactionReference = checkout.id;
      payment.paymentIntentId = typeof checkout.payment_intent === 'object' ? checkout.payment_intent?.id : checkout.payment_intent;
      payment.paymentStatus = 'Paid';
      payment.transactionDate = payment.transactionDate || new Date();
      await payment.save({ session });
      invoice.status = 'Paid';
      invoice.checkoutLockUntil = null;
      invoice.checkoutSessionId = null;
      await invoice.save({ session });
      await outbox.enqueue(`anchor:Payment:${payment.id}`, 'BlockchainAnchor', { sourceType: 'Payment', sourceId: payment.id,
        snapshot: { invoiceId: payment.invoiceId, hostelId: payment.hostelId, amount: payment.amount, paidAt: payment.transactionDate },
      }, session);
      const booking = await Booking.findById(invoice.bookingId).session(session);
      if (booking) await outbox.enqueue(`payment-notification:${payment.id}`, 'Notification', {
        userId: String(booking.studentId), type: 'RentDue', title: 'Payment received',
        body: `Your payment of PKR ${payment.amount.toLocaleString()} for ${invoice.billingMonth} has been confirmed.`,
        relatedEntityId: payment.id,
      }, session);
      return payment;
    });
  },
};
