const app = require('./src/app');
const connectDB = require('./src/config/db');
const env = require('./src/config/env');
const scheduleMonthlyInvoiceGeneration = require('./src/jobs/generateMonthlyInvoices');
const scheduleOutbox = require('./src/jobs/processOutbox');

async function start() {
  await connectDB();

  const stopJobs = [];
  if (env.nodeEnv !== 'test') {
    stopJobs.push(scheduleMonthlyInvoiceGeneration(), scheduleOutbox());
  }

  const server = app.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[server] HostelHive API listening on port ${env.port} (${env.nodeEnv})`);
  });

  const shutdown = (signal) => {
    // eslint-disable-next-line no-console
    console.log(`[server] ${signal} received, shutting down gracefully`);
    stopJobs.forEach(stop => stop());
    server.close(() => process.exit(0));
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (err) => {
    // eslint-disable-next-line no-console
    console.error('[unhandledRejection]', err);
    server.close(() => process.exit(1));
  });
}

start().catch((error) => { console.error('[startup] Failed:', error.message); process.exitCode = 1; });
