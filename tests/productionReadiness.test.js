const request = require('supertest');
const baseEnv = require('../src/config/env');
const { validateProductionConfiguration } = require('../src/config/validateProduction');

// Deterministic regression coverage: no application database or provider calls.
function productionConfig() {
  const config = JSON.parse(JSON.stringify(baseEnv));
  config.nodeEnv = 'production';
  config.mongoUri = 'mongodb+srv://fixture:password@cluster.example.com/hostelhive?retryWrites=true&w=majority';
  config.jwt = { secret: 'a'.repeat(48), refreshSecret: 'b'.repeat(48), expiresIn: '7d', refreshExpiresIn: '30d' };
  config.bcryptSaltRounds = 10;
  config.cors.webOrigins = ['https://admin.example.com'];
  config.email = { ...config.email, brevoApiKey: 'fixture-api-key', from: 'HostelHive <sender@example.com>' };
  config.integrations.imagekit = { publicKey: 'fixture-public', privateKey: 'fixture-private', urlEndpoint: 'https://ik.imagekit.io/fixture' };
  config.integrations.stripe = { ...config.integrations.stripe, secretKey: '', publishableKey: '', webhookSecret: '' };
  config.integrations.firebase = { projectId: '', clientEmail: '', privateKey: '' };
  config.integrations.blockchain = { ...config.integrations.blockchain, rpcUrl: '', privateKey: '' };
  return config;
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.dontMock('../src/repositories/rateLimit.repository');
});

test('valid production configuration with optional providers disabled is accepted', () => {
  expect(() => validateProductionConfiguration(productionConfig())).not.toThrow();
});

test.each([
  ['local MongoDB', (config) => { config.mongoUri = 'mongodb://127.0.0.1:27018/hostelhive'; }, 'MONGO_URI'],
  ['missing database name', (config) => { config.mongoUri = 'mongodb+srv://cluster.example.com/'; }, 'MONGO_URI'],
  ['weak JWT secret', (config) => { config.jwt.secret = 'weak'; }, 'JWT_SECRET'],
  ['shared JWT secrets', (config) => { config.jwt.refreshSecret = config.jwt.secret; }, 'must be different'],
  ['invalid token lifetime', (config) => { config.jwt.expiresIn = 'forever'; }, 'JWT_EXPIRES_IN'],
  ['expired token lifetime', (config) => { config.jwt.expiresIn = '0d'; }, 'JWT_EXPIRES_IN'],
  ['browser origin wildcard', (config) => { config.cors.webOrigins = ['*']; }, 'CLIENT_WEB_ORIGIN'],
  ['browser origin path', (config) => { config.cors.webOrigins = ['https://admin.example.com/dashboard']; }, 'CLIENT_WEB_ORIGIN'],
  ['insecure browser origin', (config) => { config.cors.webOrigins = ['http://admin.example.com']; }, 'CLIENT_WEB_ORIGIN'],
  ['invalid IP header', (config) => { config.clientIpHeader = 'forwarded'; }, 'CLIENT_IP_HEADER'],
  ['untrusted provider IP header', (config) => { config.clientIpHeader = 'x-real-ip'; config.trustProxy = false; }, 'TRUST_PROXY'],
  ['invalid listen address', (config) => { config.host = 'http://example.com'; }, 'IP/HOST'],
  ['invalid request timeout', (config) => { config.server.requestTimeoutMs = 0; }, 'HTTP_REQUEST_TIMEOUT_MS'],
  ['invalid pool size', (config) => { config.mongo.maxPoolSize = 0; }, 'MONGO_MAX_POOL_SIZE'],
  ['invalid upload capacity', (config) => { config.uploads.maxConcurrent = 0; }, 'UPLOAD_MAX_CONCURRENT'],
  ['email API key missing', (config) => { config.email.brevoApiKey = ''; }, 'BREVO_API_KEY'],
  ['email API timeout too long', (config) => { config.email.apiTimeoutMs = 90000; }, 'EMAIL_API_TIMEOUT_MS'],
  ['upload credentials missing', (config) => { config.integrations.imagekit.privateKey = ''; }, 'IMAGEKIT'],
  ['incomplete Firebase credentials', (config) => { config.integrations.firebase.projectId = 'fixture'; }, 'FIREBASE'],
  ['incomplete blockchain credentials', (config) => { config.integrations.blockchain.rpcUrl = 'https://rpc.example.com'; }, 'BLOCKCHAIN'],
])('%s prevents production startup without exposing credential values', (_name, change, message) => {
  const config = productionConfig();
  change(config);
  expect(() => validateProductionConfiguration(config)).toThrow(message);
  try { validateProductionConfiguration(config); } catch (error) {
    expect(error.message).not.toContain('fixture-api-key');
    expect(error.message).not.toContain('fixture-private');
  }
});

test('configured Stripe callbacks accept existing mobile links and require HTTPS Admin returns', () => {
  const config = productionConfig();
  Object.assign(config.integrations.stripe, {
    secretKey: 'sk_test_fixture', webhookSecret: 'whsec_fixture',
    connectReturnUrl: 'https://admin.example.com/admin/stripe/complete',
    connectRefreshUrl: 'https://admin.example.com/admin/stripe/refresh',
    successUrl: 'hostelhive://payments/success', cancelUrl: 'hostelhive://payments/cancel',
  });
  expect(() => validateProductionConfiguration(config)).not.toThrow();
  config.integrations.stripe.connectReturnUrl = 'http://localhost:3000/admin/stripe/complete';
  expect(() => validateProductionConfiguration(config)).toThrow('STRIPE_CONNECT_RETURN_URL');
});

test.each(['true', '0.0.0.0/0', '::/0', 'untrusted-host.example', '11'])('unsafe TRUST_PROXY=%s is rejected', (value) => {
  const original = process.env.TRUST_PROXY;
  process.env.TRUST_PROXY = value;
  try {
    expect(() => jest.isolateModules(() => require('../src/config/env'))).toThrow('Invalid TRUST_PROXY');
  } finally {
    if (original === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = original;
  }
});

function isolatedApp({ production = false, trustProxy = false, header = 'x-real-ip', apiMax = 300, authMax = 60, store } = {}) {
  let context;
  if (store) jest.doMock('../src/repositories/rateLimit.repository', () => store);
  jest.isolateModules(() => {
    const config = require('../src/config/env');
    config.nodeEnv = production ? 'production' : 'test';
    config.trustProxy = trustProxy;
    config.clientIpHeader = header;
    config.cors.webOrigins = ['https://admin.example.com'];
    config.rateLimit.api.max = apiMax;
    config.rateLimit.auth.max = authMax;
    context = { app: require('../src/app'), database: require('../src/config/db') };
  });
  return context;
}

function fakeStore() {
  const counters = new Map();
  return {
    increment: jest.fn(async (id) => {
      const count = (counters.get(id) || 0) + 1;
      counters.set(id, count);
      return { count };
    }),
    decrement: jest.fn(), reset: jest.fn(),
  };
}

test('API throttles return JSON, Retry-After and standard quota headers', async () => {
  const { app } = isolatedApp({ apiMax: 2 });
  await request(app).get('/api/unknown');
  await request(app).get('/api/unknown');
  const response = await request(app).get('/api/unknown');
  expect(response.status).toBe(429);
  expect(response.body.success).toBe(false);
  expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
  expect(response.headers['ratelimit-limit']).toBe('2');
  expect(response.headers['x-powered-by']).toBeUndefined();
  expect(response.headers['cache-control']).toBe('no-store');
  expect((await request(app).get('/health')).status).toBe(200);
});

test('alwaysdata real IP is accepted only from a trusted proxy and production buckets survive app recreation', async () => {
  const store = fakeStore();
  const options = { production: true, trustProxy: ['loopback'], apiMax: 1, store };
  const first = isolatedApp(options).app;
  expect((await request(first).get('/api/unknown').set('X-Real-IP', '203.0.113.40')).status).toBe(404);
  expect((await request(first).get('/api/unknown').set('X-Real-IP', '203.0.113.41')).status).toBe(404);
  const second = isolatedApp(options).app;
  expect((await request(second).get('/api/unknown').set('X-Real-IP', '203.0.113.40')).status).toBe(429);
  expect(store.increment.mock.calls[0][0]).not.toContain('203.0.113.40');
});

test('untrusted and malformed real-IP headers cannot evade rate limits', async () => {
  const untrusted = isolatedApp({ apiMax: 1 }).app;
  expect((await request(untrusted).get('/api/unknown').set('X-Real-IP', '203.0.113.1')).status).toBe(404);
  expect((await request(untrusted).get('/api/unknown').set('X-Real-IP', '203.0.113.2')).status).toBe(429);
  const trusted = isolatedApp({ trustProxy: ['loopback'], apiMax: 1 }).app;
  await request(trusted).get('/api/unknown').set('X-Real-IP', 'not-an-ip');
  expect((await request(trusted).get('/api/unknown').set('X-Real-IP', '203.0.113.1, 203.0.113.2')).status).toBe(429);
});

test('IPv6 host rotation shares its subnet quota and mapped IPv4 shares its IPv4 quota', async () => {
  const app = isolatedApp({ trustProxy: ['loopback'], apiMax: 1 }).app;
  expect((await request(app).get('/api/unknown').set('X-Real-IP', '2001:db8:1:2::1')).status).toBe(404);
  expect((await request(app).get('/api/unknown').set('X-Real-IP', '2001:db8:1:2::abcd')).status).toBe(429);
  expect((await request(app).get('/api/unknown').set('X-Real-IP', '203.0.113.8')).status).toBe(404);
  expect((await request(app).get('/api/unknown').set('X-Real-IP', '::ffff:203.0.113.8')).status).toBe(429);
});

test('auth IP quota spans sensitive endpoints but not session refresh', async () => {
  const { app } = isolatedApp({ authMax: 1 });
  expect((await request(app).post('/api/auth/login').send({})).status).toBe(400);
  expect((await request(app).post('/api/auth/register').send({})).status).toBe(429);
  expect((await request(app).post('/api/auth/refresh').send({})).status).toBe(400);
});

test('production protection fails closed if the shared store is unavailable', async () => {
  const store = fakeStore();
  store.increment.mockRejectedValue(new Error('private connection detail'));
  const { app } = isolatedApp({ production: true, store });
  const response = await request(app).get('/api/unknown');
  expect(response.status).toBe(503);
  expect(response.body.message).not.toContain('private connection detail');
});

test('production CORS allows exact web origin and native requests, rejects other browser origins', async () => {
  const { app } = isolatedApp({ production: true, store: fakeStore() });
  expect((await request(app).get('/health')).status).toBe(200);
  const allowed = await request(app).options('/api/auth/login').set('Origin', 'https://admin.example.com').set('Access-Control-Request-Method', 'POST');
  expect(allowed.status).toBe(204);
  expect(allowed.headers['access-control-allow-origin']).toBe('https://admin.example.com');
  expect((await request(app).get('/health').set('Origin', 'http://localhost:5173')).status).toBe(403);
  expect((await request(app).get('/health').set('Origin', 'https://other.example.com')).status).toBe(403);
});

test('health, readiness, preflight and signed webhook path bypass general quotas', async () => {
  const store = fakeStore();
  const { app, database } = isolatedApp({ production: true, apiMax: 1, store });
  await request(app).get('/api/unknown');
  expect((await request(app).get('/health')).status).toBe(200);
  expect((await request(app).get('/ready')).status).toBe(503);
  jest.spyOn(database, 'isReady').mockReturnValue(true);
  expect((await request(app).get('/ready')).status).toBe(200);
  expect((await request(app).options('/api/unknown').set('Origin', 'https://admin.example.com')).status).toBe(204);
  expect((await request(app).post('/api/payments/webhook').set('stripe-signature', 'bad').send({ type: 'invalid' })).status).toBe(400);
  expect(store.increment).toHaveBeenCalledTimes(1);
});

test('malformed and oversized JSON bodies return safe client errors', async () => {
  const { app } = isolatedApp();
  const invalid = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"private":"');
  expect(invalid.status).toBe(400);
  expect(invalid.body.message).not.toContain('private');
  const oversized = await request(app).post('/api/auth/login').send({ text: 'x'.repeat(2 * 1024 * 1024) });
  expect(oversized.status).toBe(413);
});

test('draining rejects work and readiness while keeping liveness available', async () => {
  const { app } = isolatedApp();
  app.locals.draining = true;
  expect((await request(app).get('/api/unknown')).status).toBe(503);
  expect((await request(app).get('/ready')).status).toBe(503);
  expect((await request(app).get('/health')).status).toBe(200);
});
