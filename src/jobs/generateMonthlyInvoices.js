const cron = require('node-cron');
const crypto = require('crypto');
const invoiceService = require('../services/invoice.service');
const leases = require('../repositories/jobLease.repository');

// Reconciliation is idempotent per booking/month and runs at startup and
// hourly so downtime at a month boundary does not lose a billing cycle.
function scheduleMonthlyInvoiceGeneration() {
  let running = false;
  const owner = crypto.randomUUID();
  const run = async () => {
    if (running) return;
    running = true;
    let heartbeat;
    try {
      if (!await leases.claim('billing', owner)) return;
      heartbeat = setInterval(() => { void leases.renew('billing', owner).catch(() => {}); }, 15000);
      await invoiceService.reconcileBilling();
    } catch (error) { console.error('[billing] Reconciliation will retry:', error.message); }
    finally { clearInterval(heartbeat); await leases.release('billing', owner).catch(() => {}); running = false; }
  };
  const job = cron.schedule('5 * * * *', () => { void run(); }, { timezone: process.env.BILLING_TIMEZONE || 'Asia/Karachi' });
  void run();
  return () => job.stop();
}
module.exports = scheduleMonthlyInvoiceGeneration;
