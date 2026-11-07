const crypto = require('node:crypto');
const { isIP } = require('node:net');
const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const repository = require('../repositories/rateLimit.repository');
const AppError = require('../utils/AppError');

function clientAddress(req) {
  if (env.clientIpHeader !== 'x-real-ip') return req.ip || req.socket.remoteAddress;

  // Some hosts document X-Real-IP instead of X-Forwarded-For. Only their
  // explicitly trusted reverse proxy may supply the authoritative address.
  const peer = req.socket.remoteAddress;
  const trust = req.app.get('trust proxy fn');
  const forwarded = req.headers['x-real-ip'];
  if (peer && typeof trust === 'function' && trust(peer, 0) && typeof forwarded === 'string' && isIP(forwarded)) {
    return forwarded;
  }
  return peer;
}

function addressKey(address) {
  if (isIP(address || '') === 4) return address;
  if (isIP(address || '') !== 6) return 'unknown';

  // URL normalizes compressed IPv6 spellings without an extra dependency.
  const canonical = new URL(`http://[${address.split('%')[0]}]/`).hostname.slice(1, -1);
  const [left, right] = canonical.split('::');
  const head = left ? left.split(':') : [];
  const tail = right ? right.split(':') : [];
  const groups = right === undefined ? head : [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail];
  const numbers = groups.map((part) => Number.parseInt(part, 16));

  // IPv4-mapped addresses must share the native IPv4 client's bucket.
  if (numbers.slice(0, 5).every((part) => part === 0) && numbers[5] === 0xffff) {
    return [numbers[6] >> 8, numbers[6] & 255, numbers[7] >> 8, numbers[7] & 255].join('.');
  }

  // Count the /64 subnet together so rotating an IPv6 host address cannot
  // bypass the throttle. Canonicalize to avoid textual aliases.
  return `${numbers.slice(0, 4).map((part) => part.toString(16)).join(':')}::/64`;
}

class MongoIpStore {
  constructor(prefix) {
    this.prefix = `ip:${prefix}:`;
    this.localKeys = false;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  bucket(key) {
    const window = Math.floor(Date.now() / this.windowMs);
    return {
      id: `${this.prefix}${window}:${key}`,
      resetTime: new Date((window + 1) * this.windowMs),
    };
  }

  async increment(key) {
    const { id, resetTime } = this.bucket(key);
    try {
      const record = await repository.increment(id, resetTime);
      return { totalHits: record.count, resetTime };
    } catch (_error) {
      // Never silently disable protection when the shared store is unavailable.
      throw new AppError('Request protection is temporarily unavailable. Please try again shortly.', 503);
    }
  }

  async decrement(key) {
    // The configured limiters count all requests, so response-time decrements
    // are deliberately not enabled. Implemented for the Store interface.
    await repository.decrement(this.bucket(key).id);
  }

  async resetKey(key) {
    await repository.reset(this.bucket(key).id);
  }
}

function createIpLimiter(name, options, skip = () => false) {
  return rateLimit({
    ...options,
    standardHeaders: true,
    legacyHeaders: false,
    requestPropertyName: `${name}RateLimit`,
    store: env.nodeEnv === 'production' ? new MongoIpStore(name) : undefined,
    keyGenerator: (req) => crypto.createHmac('sha256', env.jwt.secret)
      .update(addressKey(clientAddress(req))).digest('hex'),
    skip: (req) => req.method === 'OPTIONS' || skip(req),
    message: {
      success: false,
      message: 'Too many requests. Please wait before trying again.',
    },
  });
}

// Persist production buckets across processes/restarts, using MongoDB's TTL
// cleanup. Development and isolated test apps keep independent memory stores.
const apiLimiter = createIpLimiter('api', env.rateLimit.api);
const protectedAuthPaths = new Set([
  '/login', '/register', '/verify-email', '/activate-staff-invite',
  '/resend-verification', '/forgot-password', '/reset-password', '/change-password',
]);
const authLimiter = createIpLimiter('auth', env.rateLimit.auth, (req) => {
  const path = req.path.replace(/\/+$/, '').toLowerCase();
  // Session refresh and authenticated GET /me use the general API allowance,
  // avoiding a shared login/OTP quota for routine parallel session checks.
  return req.method !== 'POST' || !protectedAuthPaths.has(path);
});

module.exports = { apiLimiter, authLimiter };
