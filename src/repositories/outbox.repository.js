const OutboxEvent = require('../models/OutboxEvent');
const crypto = require('crypto');

module.exports = {
  enqueue: (id, kind, payload, session) => OutboxEvent.updateOne({ _id: id }, {
    $setOnInsert: { kind, payload, status: 'Pending', nextAttemptAt: new Date() },
  }, { upsert: true, session }),
  claim: () => OutboxEvent.findOneAndUpdate({ $or: [
    { status: 'Pending', nextAttemptAt: { $lte: new Date() } },
    { status: 'Processing', leaseUntil: { $lte: new Date() } },
  ] }, { $set: { status: 'Processing', claimToken: crypto.randomUUID(), leaseUntil: new Date(Date.now() + 120000) }, $inc: { attempts: 1 } }, { new: true, sort: { nextAttemptAt: 1 } }),
  renew: (job) => OutboxEvent.updateOne({ _id: job._id, status: 'Processing', claimToken: job.claimToken }, {
    $set: { leaseUntil: new Date(Date.now() + 120000) },
  }),
  complete: (job) => OutboxEvent.updateOne({ _id: job._id, status: 'Processing', claimToken: job.claimToken }, {
    $set: { status: 'Completed', leaseUntil: null, claimToken: null, lastError: null },
  }),
  retry: (job, error) => OutboxEvent.updateOne({ _id: job._id, status: 'Processing', claimToken: job.claimToken }, { $set: {
    status: 'Pending', leaseUntil: null, claimToken: null, lastError: String(error.message).slice(0, 500),
    nextAttemptAt: new Date(Date.now() + Math.min(300000, 2000 * 2 ** Math.min(job.attempts, 7))),
  } }),
};
