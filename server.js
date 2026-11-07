const http = require('node:http');
const env = require('./src/config/env');
const { validateProductionConfiguration } = require('./src/config/validateProduction');
const database = require('./src/config/db');
const app = require('./src/app');
const scheduleMonthlyInvoiceGeneration = require('./src/jobs/generateMonthlyInvoices');
const scheduleOutbox = require('./src/jobs/processOutbox');

async function start() {
  validateProductionConfiguration(env);
  await database();
  app.locals.draining = false;
  const server = http.createServer({
    requestTimeout: env.server.requestTimeoutMs,
    headersTimeout: env.server.headersTimeoutMs,
    keepAliveTimeout: env.server.keepAliveTimeoutMs,
  }, app);
  const stopJobs = [];
  let shutdownPromise;

  const shutdown = (reason, exitCode = 0) => {
    if (shutdownPromise) return shutdownPromise;
    app.locals.draining = true;
    console.log(`[server] ${reason}; draining requests and jobs`);
    const deadline = setTimeout(() => {
      console.error('[server] Shutdown deadline reached; queued jobs will recover through their leases.');
      server.closeAllConnections();
      process.exit(1);
    }, env.server.shutdownTimeoutMs);
    deadline.unref();

    shutdownPromise = (async () => {
      const closed = new Promise((resolve) => server.close(resolve));
      server.closeIdleConnections();
      await Promise.all([closed, ...stopJobs.map((stop) => Promise.resolve().then(stop))]);
      await database.disconnect();
      clearTimeout(deadline);
      process.exit(exitCode);
    })().catch(() => {
      console.error('[server] Shutdown could not finish cleanly.');
      process.exit(1);
    });
    return shutdownPromise;
  };

  try {
    // No workers start if the assigned bind IP/port cannot be opened.
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(env.port, env.host, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    server.on('error', () => { void shutdown('HTTP listener error', 1); });
    if (env.nodeEnv !== 'test') {
      stopJobs.push(scheduleMonthlyInvoiceGeneration(), scheduleOutbox());
    }
  } catch (error) {
    await Promise.allSettled(stopJobs.map((stop) => Promise.resolve().then(stop)));
    server.close();
    await database.disconnect();
    throw new Error(error.code === 'EADDRINUSE'
      ? 'The configured IP/PORT is already in use. Stop the duplicate server or check the host-assigned address.'
      : 'Server startup failed. Check the assigned IP/PORT and worker configuration.');
  }

  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
  process.once('unhandledRejection', () => { void shutdown('Unhandled asynchronous failure', 1); });
  process.once('uncaughtException', () => { void shutdown('Unexpected runtime failure', 1); });
  console.log(`[server] HostelHive API listening on ${env.host}:${env.port} (${env.nodeEnv})`);
  return server;
}

if (require.main === module) {
  start().catch((error) => { console.error('[startup]', error.message); process.exitCode = 1; });
}

module.exports = { start };
