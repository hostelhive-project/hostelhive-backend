const Payment = require('../models/Payment');

const paymentRepository = {
  async expireCheckout(reference) {
    return require('./unitOfWork')(async (session) => {
      const payment = await Payment.findOneAndUpdate({ transactionReference: reference, paymentStatus: { $ne: 'Paid' } },
        { $set: { paymentStatus: 'Failed' } }, { new: true, session });
      if (payment) await require('../models/Invoice').updateOne({ _id: payment.invoiceId, checkoutSessionId: reference },
        { $set: { checkoutSessionId: null, checkoutLockUntil: null } }, { session });
      return payment;
    });
  },
  recordIntentFailure(intent) {
    const filter = intent.metadata?.paymentId ? { _id: intent.metadata.paymentId } : { paymentIntentId: intent.id };
    return Payment.findOneAndUpdate({ ...filter, paymentStatus: 'Processing' }, { $set: {
      paymentIntentId: intent.id, lastFailureCode: intent.last_payment_error?.code || 'payment_failed',
    } }, { new: true });
  },
  create(data) {
    return Payment.create(data);
  },
  findById(id) {
    return Payment.findById(id);
  },
  findByInvoice(invoiceId) {
    return Payment.find({ invoiceId }).sort({ createdAt: -1 });
  },
  findProcessingByInvoice(invoiceId) {
    return Payment.findOne({ invoiceId, paymentStatus: 'Processing' });
  },
};

module.exports = paymentRepository;
