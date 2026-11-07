const cron = require('node-cron');
const crypto = require('crypto');
const invoiceService = require('../services/invoice.service');
const leases = require('../repositories/jobLease.repository');

// Reconciliation is idempotent per booking/month and runs at startup and
// hourly so downtime at a month boundary does not lose a billing cycle.
function scheduleMonthlyInvoiceGeneration() {
  let running = false;
  let stopped = false;
  let activeRun;
  const owner = crypto.randomUUID();
  const run = async () => {
    if (running || stopped) return;
    running = true;
    let heartbeat;
    try {
      if (!await leases.claim('billing', owner)) return;
      heartbeat = setInterval(() => { void leases.renew('billing', owner).catch(() => {}); }, 15000);
      await invoiceService.reconcileBilling();
    } catch (error) { console.error('[billing] Reconciliation will retry:', error.message); }
    finally { clearInterval(heartbeat); await leases.release('billing', owner).catch(() => {}); running = false; }
  };
  const launch = () => {
    if (stopped || running) return;
    activeRun = run();
    void activeRun.catch(() => undefined);
  };
  const job = cron.schedule('5 * * * *', launch, { timezone: process.env.BILLING_TIMEZONE || 'Asia/Karachi' });
  launch();
  return () => {
    stopped = true;
    job.stop();
    return activeRun;
  };
}
module.exports = scheduleMonthlyInvoiceGeneration;
