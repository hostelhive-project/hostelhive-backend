const BlockchainRecord = require('../models/BlockchainRecord');
const { Payment, Complaint } = require('./data.repository');

module.exports = {
  find: (sourceType, sourceId) => BlockchainRecord.findOne({ sourceType, sourceId }).sort({ writtenAt: -1 }).select('+anchorPayload +signedTransaction'),
  prepare: (sourceType, sourceId, hash, payload) => BlockchainRecord.findOneAndUpdate(
    { idempotencyKey: `${sourceType}:${sourceId}` }, { $setOnInsert: {
      sourceType, sourceId, hash, hashVersion: 1, anchorPayload: payload, status: 'Pending', writtenAt: new Date(),
    } }, { new: true, upsert: true }).select('+anchorPayload'),
  update: (id, updates) => BlockchainRecord.findByIdAndUpdate(id, { $set: updates }, { new: true }).select('+anchorPayload'),
  async saveSigned(id, updates) {
    // A worker that lost its lease must not replace another worker's signed
    // transaction. Both senders will subsequently use the same persisted bytes.
    const stored = await BlockchainRecord.findOneAndUpdate({ _id: id, blockRef: null, status: 'Pending' },
      { $set: updates }, { new: true }).select('+anchorPayload +signedTransaction');
    return stored || BlockchainRecord.findById(id).select('+anchorPayload +signedTransaction');
  },
  reserveNonce(id, namespace, pendingNonce) {
    return require('./unitOfWork')(async (session) => {
      const record = await BlockchainRecord.findById(id).session(session);
      if (record.nonce != null) return record.nonce;
      const counter = await require('../models/Counter').findByIdAndUpdate(`blockchain:${namespace}`,
        [{ $set: { seq: { $add: [{ $max: [{ $ifNull: ['$seq', 0] }, pendingNonce] }, 1] } } }],
        { new: true, upsert: true, session });
      record.nonce = counter.seq - 1;
      await record.save({ session });
      return record.nonce;
    });
  },
  source: (type, id) => (type === 'Payment' ? Payment : Complaint).findById(id),
  attach: (type, id, reference) => (type === 'Payment' ? Payment : Complaint).updateOne({ _id: id }, { $set: { blockchainRef: reference } }),
  missing: async () => {
    const payments = await Payment.find({ paymentStatus: 'Paid', blockchainRef: null }).limit(100);
    const complaints = await Complaint.find({ severityTier: 'Critical', blockchainRef: null }).limit(100);
    return [...payments.map((source) => ({ sourceType: 'Payment', source })), ...complaints.map((source) => ({ sourceType: 'Complaint', source }))];
  },
};
