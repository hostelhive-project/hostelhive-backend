const mongoose = require('mongoose');
// Added: immutable reversal/recovery entries, separate from original payments.
module.exports = mongoose.model('PaymentAdjustment', new mongoose.Schema({
  _id: String,
  paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true },
  hostelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hostel', required: true, index: true },
  kind: { type: String, enum: ['Refund', 'Dispute'], required: true },
  amount: { type: Number, required: true },
  recordedAt: { type: Date, default: Date.now, index: true },
}));
