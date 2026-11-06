const { getStripeClient } = require('../integrations/stripe');
const repository = require('../repositories/paymentAdjustment.repository');

module.exports = {
  async reconcile({ type, id }) {
    const stripe = getStripeClient();
    let dispute = null;
    let chargeId = id;
    if (type.startsWith('charge.dispute.')) {
      dispute = await stripe.disputes.retrieve(id);
      chargeId = typeof dispute.charge === 'object' ? dispute.charge.id : dispute.charge;
    }
    const charge = await stripe.charges.retrieve(chargeId);
    const intentId = typeof charge.payment_intent === 'object' ? charge.payment_intent?.id : charge.payment_intent;
    if (intentId) {
      const sessions = await stripe.checkout.sessions.list({ payment_intent: intentId, limit: 1 });
      if (sessions.data[0]) await repository.associateIntent(sessions.data[0].id, intentId);
    }
    return repository.record(charge, dispute);
  },
};
