const { EventEmitter } = require('node:events');
const events = ['SIGTERM', 'SIGINT', 'unhandledRejection', 'uncaughtException'];
let originalListeners;

beforeEach(() => {
  originalListeners = new Map(events.map((event) => [event, process.listeners(event)]));
});

afterEach(() => {
  for (const event of events) {
    for (const listener of process.listeners(event)) {
      if (!originalListeners.get(event).includes(listener)) process.removeListener(event, listener);
    }
  }
  jest.restoreAllMocks();
  for (const name of ['node:http', '../src/config/db', '../src/app',
    '../src/config/validateProduction', '../src/jobs/generateMonthlyInvoices', '../src/jobs/processOutbox',
    '../src/repositories/jobLease.repository', '../src/repositories/outbox.repository',
    '../src/services/blockchain.service', '../src/services/invoice.service', 'node-cron', 'mongoose', 'node:fs']) jest.dontMock(name);
});

function serverFixture({ bindError } = {}) {
  const listener = new EventEmitter();
  listener.close = jest.fn((callback) => callback?.());
  listener.closeIdleConnections = jest.fn();
  listener.closeAllConnections = jest.fn();
  listener.listen = jest.fn((_port, _host, callback) => {
    queueMicrotask(() => bindError ? listener.emit('error', { code: bindError }) : callback());
  });
  const database = Object.assign(jest.fn().mockResolvedValue(undefined), { disconnect: jest.fn().mockResolvedValue(undefined) });
  const validator = jest.fn();
  const billingStop = jest.fn().mockResolvedValue(undefined);
  const outboxStop = jest.fn().mockResolvedValue(undefined);
  const billing = jest.fn(() => billingStop);
  const outbox = jest.fn(() => outboxStop);
  const app = Object.assign(() => {}, { locals: {} });
  jest.doMock('node:http', () => ({ createServer: jest.fn(() => listener) }));
  jest.doMock('../src/config/db', () => database);
  jest.doMock('../src/app', () => app);
  jest.doMock('../src/config/validateProduction', () => ({ validateProductionConfiguration: validator }));
  jest.doMock('../src/jobs/generateMonthlyInvoices', () => billing);
  jest.doMock('../src/jobs/processOutbox', () => outbox);
  let context;
  jest.isolateModules(() => {
    const config = require('../src/config/env');
    config.nodeEnv = 'production';
    config.host = '127.0.0.9';
    config.port = 34567;
    context = { config, start: require('../server').start };
  });
  return { ...context, listener, database, validator, billing, outbox, billingStop, outboxStop, app };
}

test('startup binds assigned IP/PORT and starts workers only after listener succeeds', async () => {
  const fixture = serverFixture();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  await expect(fixture.start()).resolves.toBe(fixture.listener);
  expect(fixture.listener.listen).toHaveBeenCalledWith(34567, '127.0.0.9', expect.any(Function));
  expect(fixture.validator.mock.invocationCallOrder[0]).toBeLessThan(fixture.database.mock.invocationCallOrder[0]);
  expect(fixture.listener.listen.mock.invocationCallOrder[0]).toBeLessThan(fixture.billing.mock.invocationCallOrder[0]);
  expect(fixture.outbox).toHaveBeenCalledTimes(1);
});

test('invalid configuration prevents database connections', async () => {
  const fixture = serverFixture();
  fixture.validator.mockImplementation(() => { throw new Error('Invalid settings'); });
  await expect(fixture.start()).rejects.toThrow('Invalid settings');
  expect(fixture.database).not.toHaveBeenCalled();
  expect(fixture.listener.listen).not.toHaveBeenCalled();
});

test('bind conflict is actionable and does not leave background workers running', async () => {
  const fixture = serverFixture({ bindError: 'EADDRINUSE' });
  await expect(fixture.start()).rejects.toThrow('already in use');
  expect(fixture.database.disconnect).toHaveBeenCalledTimes(1);
  expect(fixture.billing).not.toHaveBeenCalled();
  expect(fixture.outbox).not.toHaveBeenCalled();
});

test('shutdown marks draining, stops jobs, closes HTTP/DB and exits after workers settle', async () => {
  const fixture = serverFixture();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  let release;
  fixture.outboxStop.mockReturnValue(new Promise((resolve) => { release = resolve; }));
  const exit = jest.spyOn(process, 'exit').mockImplementation(() => undefined);
  await fixture.start();
  const stop = process.listeners('SIGTERM').find((handler) => !originalListeners.get('SIGTERM').includes(handler));
  stop();
  await new Promise(setImmediate);
  expect(fixture.app.locals.draining).toBe(true);
  expect(fixture.billingStop).toHaveBeenCalledTimes(1);
  expect(fixture.outboxStop).toHaveBeenCalledTimes(1);
  expect(fixture.listener.closeIdleConnections).toHaveBeenCalledTimes(1);
  expect(fixture.database.disconnect).not.toHaveBeenCalled();
  const exited = new Promise((resolve) => exit.mockImplementation(resolve));
  release();
  expect(await exited).toBe(0);
  expect(fixture.database.disconnect).toHaveBeenCalledTimes(1);
});

test('outbox stop waits for active reconciliation and claims no new jobs', async () => {
  let release;
  const active = new Promise((resolve) => { release = resolve; });
  const leases = { claim: jest.fn().mockResolvedValue(true), renew: jest.fn(), release: jest.fn().mockResolvedValue(undefined) };
  const repository = { claim: jest.fn() };
  jest.doMock('../src/repositories/jobLease.repository', () => leases);
  jest.doMock('../src/repositories/outbox.repository', () => repository);
  jest.doMock('../src/services/blockchain.service', () => ({ reconcile: () => active }));
  let stop;
  jest.isolateModules(() => { stop = require('../src/jobs/processOutbox')(); });
  await Promise.resolve();
  const pending = stop();
  expect(pending).toBeInstanceOf(Promise);
  release();
  await pending;
  expect(repository.claim).not.toHaveBeenCalled();
  expect(leases.release).toHaveBeenCalledTimes(1);
});

test('billing stop waits for in-flight work and stops future scheduling', async () => {
  let release;
  const active = new Promise((resolve) => { release = resolve; });
  const stopTimer = jest.fn();
  const leases = { claim: jest.fn().mockResolvedValue(true), renew: jest.fn(), release: jest.fn().mockResolvedValue(undefined) };
  jest.doMock('../src/repositories/jobLease.repository', () => leases);
  jest.doMock('../src/services/invoice.service', () => ({ reconcileBilling: () => active }));
  jest.doMock('node-cron', () => ({ schedule: () => ({ stop: stopTimer }) }));
  let stop;
  jest.isolateModules(() => { stop = require('../src/jobs/generateMonthlyInvoices')(); });
  await Promise.resolve();
  const pending = stop();
  release();
  await pending;
  expect(stopTimer).toHaveBeenCalledTimes(1);
  expect(leases.release).toHaveBeenCalledTimes(1);
});

test('Brevo keeps the existing OTP contract over HTTPS with a bounded request', async () => {
  const sendEmail = jest.spyOn(global, 'fetch').mockResolvedValue({
    status: 201,
    json: async () => ({ messageId: 'fixture' }),
  });
  let email;
  jest.isolateModules(() => {
    const config = require('../src/config/env');
    config.nodeEnv = 'production';
    config.email.from = 'HostelHive <sender@example.com>';
    config.email.brevoApiKey = 'fixture-api-key';
    config.email.apiTimeoutMs = 15000;
    jest.unmock('../src/integrations/email');
    email = require('../src/integrations/email');
  });
  await email.sendOtpEmail('recipient@example.com', '123456', 'staff-invite');
  expect(sendEmail).toHaveBeenCalledWith('https://api.brevo.com/v3/smtp/email', expect.objectContaining({
    method: 'POST', redirect: 'error', signal: expect.any(AbortSignal),
    headers: expect.objectContaining({ 'api-key': 'fixture-api-key' }),
  }));
  expect(JSON.parse(sendEmail.mock.calls[0][1].body)).toEqual(expect.objectContaining({
    sender: { email: 'sender@example.com', name: 'HostelHive' },
    to: [{ email: 'recipient@example.com' }], subject: 'Activate your HostelHive staff account',
    textContent: expect.stringContaining('123456'),
  }));
});

function databaseFixture(topology = { setName: 'fixture', logicalSessionTimeoutMinutes: 30 }) {
  const indexes = jest.fn().mockResolvedValue(undefined);
  const connection = Object.assign(new EventEmitter(), {
    readyState: 1, host: 'fixture-host', name: 'fixture-db',
    db: { admin: () => ({ command: jest.fn().mockResolvedValue(topology) }) },
  });
  const mongoose = {
    set: jest.fn(), connect: jest.fn().mockResolvedValue(undefined), disconnect: jest.fn().mockResolvedValue(undefined),
    connection, models: { Fixture: { createIndexes: indexes } },
  };
  jest.doMock('mongoose', () => mongoose);
  jest.doMock('node:fs', () => ({ readdirSync: () => [] }));
  let database;
  jest.isolateModules(() => {
    require('../src/config/env').nodeEnv = 'production';
    database = require('../src/config/db');
  });
  return { database, mongoose, indexes };
}

test('production database checks topology and creates declared indexes before readiness', async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  const { database, mongoose, indexes } = databaseFixture();
  expect(database.isReady()).toBe(false);
  await database();
  expect(mongoose.connect).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
    maxPoolSize: 10, minPoolSize: 0, autoIndex: false, autoCreate: false,
  }));
  expect(indexes).toHaveBeenCalledTimes(1);
  expect(database.isReady()).toBe(true);
  mongoose.connection.readyState = 0;
  expect(database.isReady()).toBe(false);
  await database.disconnect();
  expect(database.isReady()).toBe(false);
});

test('standalone database is rejected before accepting application traffic', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const { database, mongoose, indexes } = databaseFixture({ logicalSessionTimeoutMinutes: 30 });
  await expect(database()).rejects.toThrow('must support transactions');
  expect(indexes).not.toHaveBeenCalled();
  expect(mongoose.disconnect).toHaveBeenCalledTimes(1);
  expect(database.isReady()).toBe(false);
});

test('conflicting indexes prevent readiness and do not leak database/provider values', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const { database, indexes } = databaseFixture();
  indexes.mockRejectedValue(new Error('secret provider values'));
  await expect(database()).rejects.toThrow('MongoDB startup failed');
  expect(database.isReady()).toBe(false);
});
