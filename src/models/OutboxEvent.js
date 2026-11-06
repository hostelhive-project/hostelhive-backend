const mongoose = require('mongoose');

// Added: durable, idempotent delivery of post-commit notifications and audit anchors.
const schema = new mongoose.Schema({
  _id: { type: String },
  kind: { type: String, enum: ['BlockchainAnchor', 'Notification', 'StripeAdjustment'], required: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  status: { type: String, enum: ['Pending', 'Processing', 'Completed'], default: 'Pending' },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  leaseUntil: { type: Date, default: null },
  claimToken: { type: String, default: null },
  lastError: { type: String, default: null },
}, { timestamps: true });
schema.index({ status: 1, nextAttemptAt: 1, leaseUntil: 1 });
module.exports = mongoose.model('OutboxEvent', schema);
