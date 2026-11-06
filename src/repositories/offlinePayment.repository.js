const unitOfWork = require('./unitOfWork');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const Booking = require('../models/Booking');
const Room = require('../models/Room');
const outbox = require('./outbox.repository');
const AppError = require('../utils/AppError');

module.exports = {
  record(invoiceId, actorId, details = {}) {
    return unitOfWork(async (session) => {
      const invoice = await Invoice.findById(invoiceId).select('+checkoutLockUntil').session(session);
      if (!invoice) throw new AppError('Invoice not found', 404);
      if (invoice.status === 'Paid' || (invoice.checkoutLockUntil && invoice.checkoutLockUntil > new Date())) {
        throw new AppError('This invoice is already paid or has an active checkout.', 409);
      }
      if (await Payment.exists({ invoiceId, paymentStatus: 'Processing' }).session(session)) throw new AppError('An online checkout is active for this invoice.', 409);
      const booking = await Booking.findById(invoice.bookingId).session(session);
      const room = booking && await Room.findById(booking.roomId).session(session);
      if (!room) throw new AppError('Billing association is not available.', 409);
      const [payment] = await Payment.create([{
        invoiceId, hostelId: room.hostelId, amount: invoice.totalDue, paymentStatus: 'Paid',
        paymentMethod: details.paymentMethod || 'Cash', recordedBy: actorId, transactionDate: new Date(),
        transactionReference: `offline:${invoiceId}`,
      }], { session });
      invoice.status = 'Paid'; invoice.checkoutLockUntil = null; invoice.checkoutSessionId = null;
      await invoice.save({ session });
      await outbox.enqueue(`anchor:Payment:${payment.id}`, 'BlockchainAnchor', { sourceType: 'Payment', sourceId: payment.id,
        snapshot: { invoiceId: payment.invoiceId, hostelId: payment.hostelId, amount: payment.amount, paidAt: payment.transactionDate },
      }, session);
      await outbox.enqueue(`payment-notification:${payment.id}`, 'Notification', {
        userId: String(booking.studentId), type: 'RentDue', title: 'Offline payment recorded',
        body: `Your payment of PKR ${payment.amount.toLocaleString()} for ${invoice.billingMonth} was recorded by the hostel administrator.`, relatedEntityId: payment.id,
      }, session);
      return invoice;
    });
  },
};
