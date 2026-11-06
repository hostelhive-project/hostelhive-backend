// Idempotent, machine-local development helper; unrelated/remote MongoDB is never started or changed.
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { MongoClient } = require('mongoose').mongo;
const root = path.resolve(__dirname, '..');
const settingsFile = path.join(root, '.local-mongo.json');
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function startLocalMongo() {
  if (process.platform !== 'win32' || !fs.existsSync(settingsFile)) {
    if (process.argv.includes('--required')) throw new Error('No Windows local replica setup was found.');
    return;
  }
  const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  const config = require('dotenv').parse(fs.readFileSync(path.join(root, '.env')));
  const expectedUri = `mongodb://127.0.0.1:${settings.port}/${settings.database}?replicaSet=${settings.replicaSet}`;
  if (config.MONGO_URI !== expectedUri || process.env.MONGO_URI && process.env.MONGO_URI !== expectedUri) return;
  const expectedPath = path.join(process.env.LOCALAPPDATA, 'HostelHive', 'mongo-rs-development');
  if (settings.port !== 27018 || settings.replicaSet !== 'hostelhiveDev' || path.resolve(settings.dataPath) !== path.resolve(expectedPath)) throw new Error('Local replica settings do not match the development instance.');
  const listening = await new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port: settings.port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', error => { socket.destroy(); if (error.code === 'ECONNREFUSED') resolve(false); else reject(error); });
  });
  if (!listening) {
    if (!fs.existsSync(settings.binary) || !fs.existsSync(path.join(settings.dataPath, 'WiredTiger'))) throw new Error('The existing local replica files or MongoDB binary are missing.');
    const child = spawn(settings.binary, ['--dbpath', settings.dataPath, '--port', String(settings.port), '--bind_ip', '127.0.0.1', '--replSet', settings.replicaSet, '--logpath', settings.logPath, '--logappend'], { detached: true, windowsHide: true, stdio: 'ignore' });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
    console.log('[local-mongo] Starting your development replica set.');
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    let client;
    try {
      client = await MongoClient.connect(`mongodb://127.0.0.1:${settings.port}/?directConnection=true`, { serverSelectionTimeoutMS: 600 });
      const options = await client.db('admin').command({ getCmdLineOpts: 1 });
      const status = await client.db('admin').command({ hello: 1 });
      if (path.resolve(options.parsed.storage.dbPath) !== path.resolve(settings.dataPath) || status.setName !== settings.replicaSet) throw new Error('Another MongoDB instance is using the configured port.');
      if (status.isWritablePrimary) { console.log('[local-mongo] hostelhiveDev is ready on 127.0.0.1:27018.'); return; }
    } catch (error) {
      if (!/ECONNREFUSED|Server selection|not yet initialized/i.test(error.message) || attempt === 39) throw error;
    } finally { if (client) await client.close(); }
    await delay(500);
  }
  throw new Error('Local replica set did not become primary; check the configured MongoDB log.');
}

startLocalMongo().catch(error => { console.error('[local-mongo]', error.message); process.exitCode = 1; });
