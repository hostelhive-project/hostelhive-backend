const crypto = require('crypto');
const repository = require('../repositories/outbox.repository');
const leases = require('../repositories/jobLease.repository');

function scheduleOutbox() {
  let running = false;
  const owner = crypto.randomUUID();
  const run = async () => {
    if (running) return;
    running = true;
    let heartbeat;
    let leaseLost = false;
    try {
      if (!await leases.claim('outbox', owner)) return;
      heartbeat = setInterval(() => {
        void leases.renew('outbox', owner).then(result => { if (!result.matchedCount) leaseLost = true; })
          .catch(() => { leaseLost = true; });
      }, 15000);
      await require('../services/blockchain.service').reconcile();
      for (let count = 0; count < 10; count++) {
        if (leaseLost) break;
        const job = await repository.claim();
        if (!job) break;
        const jobHeartbeat = setInterval(() => { void repository.renew(job).catch(() => {}); }, 30000);
        try {
          if (job.kind === 'BlockchainAnchor') await require('../services/blockchain.service').anchor(job.payload);
          else if (job.kind === 'Notification') await require('../services/notification.service').notify({ ...job.payload, deliveryKey: job._id });
          else if (job.kind === 'StripeAdjustment') await require('../services/paymentAdjustment.service').reconcile(job.payload);
          else if (job.kind === 'CleaningAssessment') {
            const result = await require('../services/cleaningAssessment.service').processAssessment(job.payload);
            if (result.retryAt) { await repository.defer(job, result.retryAt); continue; }
          }
          await repository.complete(job);
        } catch (error) { await repository.retry(job, error); }
        finally { clearInterval(jobHeartbeat); }
      }
    } catch (error) { console.error('[outbox] Delivery deferred:', error.message); }
    finally { clearInterval(heartbeat); await leases.release('outbox', owner).catch(() => {}); running = false; }
  };
  const timer = setInterval(() => { void run(); }, 5000);
  void run();
  return () => clearInterval(timer);
}
module.exports = scheduleOutbox;
