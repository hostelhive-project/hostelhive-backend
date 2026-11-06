const mongoose = require('mongoose');

const { Schema } = mongoose;

const SOURCE_TYPES = ['Payment', 'Complaint'];

/**
 * Added collection. Previously blockchain proof only existed as a field
 * (transactionReference) tucked inside Payment — there was no independently
 * queryable/auditable ledger record, and no way to verify a Complaint's hash
 * at all. This collection is the single source of truth for "what did we
 * write to the chain and when."
 */
const blockchainRecordSchema = new Schema(
  {
    sourceType: { type: String, enum: SOURCE_TYPES, required: true },
    sourceId: { type: Schema.Types.ObjectId, required: true },
    hash: { type: String, required: true },
    blockRef: { type: String, default: null },
    idempotencyKey: { type: String, unique: true, sparse: true },
    status: { type: String, enum: ['Pending', 'Confirmed', 'Simulated'], default: 'Confirmed' },
    hashVersion: { type: Number, default: 0 },
    anchorPayload: { type: Schema.Types.Mixed, select: false },
    expectedAddress: { type: String, default: null },
    chainId: { type: String, default: null },
    nonce: { type: Number, default: null },
    signedTransaction: { type: String, select: false },
    network: { type: String, default: 'simulated' }, // e.g. "polygon-amoy", or "simulated" if no wallet is configured
    explorerUrl: { type: String, default: null }, // clickable public proof link, null in simulated mode
    writtenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

blockchainRecordSchema.index({ sourceType: 1, sourceId: 1 });

module.exports = mongoose.model('BlockchainRecord', blockchainRecordSchema);
module.exports.SOURCE_TYPES = SOURCE_TYPES;
