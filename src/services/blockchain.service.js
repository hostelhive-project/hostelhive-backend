const AppError = require('../utils/AppError');
const repository = require('../repositories/blockchain.repository');
const outbox = require('../repositories/outbox.repository');
const integration = require('../integrations/blockchain');

function payloadFor(type, source, version = 1) {
  if (type === 'Payment') return {
    invoiceId: source.invoiceId, hostelId: source.hostelId, amount: source.amount, paidAt: source.transactionDate,
  };
  return {
    description: source.description, severityTier: source.severityTier, residentId: source.residentId?._id || source.residentId,
    hostelId: source.hostelId?._id || source.hostelId,
    ...(version ? { createdAt: source.createdAt, roomNumber: source.roomNumberAtSubmission || null } : {}),
  };
}

module.exports = {
  payloadFor,
  async enqueue(sourceType, source, session) {
    await outbox.enqueue(`anchor:${sourceType}:${source._id}`, 'BlockchainAnchor', {
      sourceType, sourceId: String(source._id), snapshot: payloadFor(sourceType, source),
    }, session);
  },
  async anchor({ sourceType, sourceId, snapshot }) {
    const source = await repository.source(sourceType, sourceId);
    if (!source) throw new AppError('Audit source no longer exists.', 409);
    const record = await integration.writeRecord(sourceType, sourceId, snapshot || payloadFor(sourceType, source));
    if (record.status === 'Pending') throw new Error('Blockchain confirmation is pending.');
    await repository.attach(sourceType, sourceId, record.blockRef);
    return record;
  },
  async reconcile() {
    for (const { sourceType, source } of await repository.missing()) await this.enqueue(sourceType, source);
  },
  async verify(sourceType, sourceId, user) {
    // Use the same object-level authorization as the source's normal detail API.
    if (sourceType === 'Payment') await require('./payment.service').getById(sourceId, user);
    else await require('./complaint.service').getById(sourceId, user);
    const record = await repository.find(sourceType, sourceId);
    if (!record) throw new AppError('No blockchain record is available yet. Audit delivery may still be pending.', 404);
    const source = await repository.source(sourceType, sourceId);
    const version = record.hashVersion || 0;
    const currentHash = integration.hashPayload(payloadFor(sourceType, source, version), version);
    const chain = await integration.verifyOnChain(record);
    return {
      hash: record.hash, blockRef: record.blockRef, network: record.network,
      explorerUrl: record.explorerUrl, writtenAt: record.writtenAt,
      status: record.status, sourceMatches: currentHash === record.hash,
      snapshotMatches: record.anchorPayload ? integration.hashPayload(record.anchorPayload, version) === record.hash : null,
      ...chain,
    };
  },
};
