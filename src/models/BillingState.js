const mongoose = require('mongoose');
// Added: record the start of automatic catch-up without inventing legacy dues.
module.exports = mongoose.model('BillingState', new mongoose.Schema({ _id: String, enabledFrom: String }));
