const BillingState = require('../models/BillingState');
module.exports = { initialize: (month) => BillingState.findOneAndUpdate({ _id: 'monthly' },
  { $setOnInsert: { enabledFrom: month } }, { upsert: true, new: true }) };
