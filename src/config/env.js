// Resolve the backend environment independently of the host's working directory.
require('dotenv').config({ path: require('node:path').resolve(__dirname, '..', '..', '.env') });
const { isIP } = require('net');

function configuredNumber(name, fallback) {
  return process.env[name] === undefined ? fallback : Number(process.env[name]);
}

function trustedProxy() {
  const value = (process.env.TRUST_PROXY ?? 'false').trim();
  if (value === 'false' || value === '0') return false;
  if (/^[1-9]\d*$/.test(value) && Number(value) <= 10) return Number(value);

  const networks = value.split(',').map((entry) => entry.trim());
  const valid = networks.every((entry) => {
    if (['loopback', 'linklocal', 'uniquelocal'].includes(entry)) return true;
    const [address, mask, ...extra] = entry.split('/');
    const family = isIP(address);
    if (!family || extra.length > 0) return false;
    if (mask === undefined) return true;
    return /^\d+$/.test(mask) && Number(mask) > 0 && Number(mask) <= (family === 4 ? 32 : 128);
  });
  if (valid) return networks;
  // A blanket true or /0 would trust a client-controlled X-Forwarded-For header.
  throw new Error('Invalid TRUST_PROXY. Use false, a proxy hop count from 1 to 10, or explicit trusted IP addresses/CIDRs.');
}

function required(name, fallback = undefined) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    // Fail loudly at boot rather than silently at request time.
    // eslint-disable-next-line no-console
    console.warn(`[env] Missing environment variable: ${name}`);
  }
  return value;
}

module.exports = {
  port: configuredNumber('PORT', 5000),
  // alwaysdata supplies IP and PORT to Node.js applications.
  host: process.env.IP || process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  trustProxy: trustedProxy(),
  clientIpHeader: process.env.CLIENT_IP_HEADER || 'x-forwarded-for',
  server: {
    requestTimeoutMs: configuredNumber('HTTP_REQUEST_TIMEOUT_MS', 120000),
    headersTimeoutMs: configuredNumber('HTTP_HEADERS_TIMEOUT_MS', 60000),
    keepAliveTimeoutMs: configuredNumber('HTTP_KEEP_ALIVE_TIMEOUT_MS', 5000),
    shutdownTimeoutMs: configuredNumber('SHUTDOWN_TIMEOUT_MS', 15000),
  },
  rateLimit: {
    api: {
      windowMs: configuredNumber('API_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
      max: configuredNumber('API_RATE_LIMIT_MAX', 300),
    },
    auth: {
      windowMs: configuredNumber('AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
      max: configuredNumber('AUTH_RATE_LIMIT_MAX', 60),
    },
  },
  mongoUri: required('MONGO_URI', 'mongodb://localhost:27017/hostelhive'),
  mongo: {
    maxPoolSize: configuredNumber('MONGO_MAX_POOL_SIZE', 10),
    minPoolSize: configuredNumber('MONGO_MIN_POOL_SIZE', 0),
    serverSelectionTimeoutMs: configuredNumber('MONGO_SERVER_SELECTION_TIMEOUT_MS', 10000),
  },
  uploads: {
    maxConcurrent: configuredNumber('UPLOAD_MAX_CONCURRENT', process.env.NODE_ENV === 'production' ? 1 : 4),
    maxConcurrentPerUser: configuredNumber('UPLOAD_MAX_CONCURRENT_PER_USER', process.env.NODE_ENV === 'production' ? 1 : 2),
  },
  jwt: {
    secret: required('JWT_SECRET'),
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    refreshSecret: required('JWT_REFRESH_SECRET'),
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },
  bcryptSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS || 10),
  email: {
    brevoApiKey: (process.env.BREVO_API_KEY || '').trim(),
    apiTimeoutMs: configuredNumber('EMAIL_API_TIMEOUT_MS', 15000),
    from: process.env.EMAIL_FROM,
  },
  cors: {
    webOrigin: process.env.CLIENT_WEB_ORIGIN || 'http://localhost:5173',
    webOrigins: (process.env.CLIENT_WEB_ORIGIN || 'http://localhost:5173,http://localhost:3000')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    mobileOrigin: process.env.CLIENT_MOBILE_ORIGIN || '*',
  },
  pkrPerUsd: Number(process.env.PKR_PER_USD !== undefined && process.env.PKR_PER_USD !== '' ? process.env.PKR_PER_USD : 280),
  integrations: {
    groq: {
      apiKey: process.env.GROQ_API_KEY,
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      baseUrl: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
    },
    cleaningAi: {
      enabled: process.env.CLEANING_AI_ENABLED !== 'false',
      model: process.env.GROQ_VISION_MODEL || 'qwen/qwen3.8-27b',
      // Fail closed on an invalid limit. This counts requests, including retries, across all hostels.
      dailyLimit: Math.min(20, Math.max(0, Math.floor(Number(process.env.CLEANING_AI_DAILY_LIMIT ?? 20) || 0))),
    },
    stripe: {
      secretKey: process.env.STRIPE_SECRET_KEY,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
      // Where the Admin's browser lands after Stripe Connect onboarding
      connectRefreshUrl: process.env.STRIPE_CONNECT_REFRESH_URL || 'http://localhost:3000/admin/stripe/refresh',
      connectReturnUrl: process.env.STRIPE_CONNECT_RETURN_URL || 'http://localhost:3000/admin/stripe/complete',
      // Where the resident's browser lands after paying/cancelling a checkout
      successUrl: process.env.STRIPE_SUCCESS_URL || 'http://localhost:3000/payments/success',
      cancelUrl: process.env.STRIPE_CANCEL_URL || 'http://localhost:3000/payments/cancel',
      pkrPerUsd: Number(process.env.PKR_PER_USD !== undefined && process.env.PKR_PER_USD !== '' ? process.env.PKR_PER_USD : 280),
    },
    blockchain: {
      rpcUrl: process.env.BLOCKCHAIN_RPC_URL,
      privateKey: process.env.BLOCKCHAIN_PRIVATE_KEY,
      network: process.env.BLOCKCHAIN_NETWORK || 'polygon-amoy',
      explorerTxBaseUrl: process.env.BLOCKCHAIN_EXPLORER_TX_BASE_URL || 'https://amoy.polygonscan.com/tx/',
    },
    firebase: {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY,
    },
    imagekit: {
      publicKey: (process.env.IMAGEKIT_PUBLIC_KEY || '').trim(),
      privateKey: (process.env.IMAGEKIT_PRIVATE_KEY || '').trim(),
      urlEndpoint: (process.env.IMAGEKIT_URL_ENDPOINT || (process.env.NODE_ENV === 'production' ? '' : 'https://ik.imagekit.io/pvafewi0b')).trim(),
    },
  },
};
