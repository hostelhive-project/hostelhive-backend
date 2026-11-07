const { isIP } = require('net');
const { createPrivateKey } = require('crypto');
const { parseEmailSender } = require('../utils/emailSender');

function configured(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function loopback(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '::' || host === '0.0.0.0' || /^127\./.test(host);
}

function publicHttps(value, { originOnly = false } = {}) {
  if (!configured(value) || /\s/.test(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !loopback(parsed.hostname)
      && (!originOnly || parsed.origin === value);
  } catch {
    return false;
  }
}

function mongoConnection(value) {
  if (!configured(value) || /\s/.test(value)) return false;
  const match = value.match(/^mongodb(\+srv)?:\/\/([^/?#]+)\/([^?/#]+)(?:\?[^#]*)?$/);
  if (!match) return false;
  const authority = match[2].slice(match[2].lastIndexOf('@') + 1);
  const seeds = authority.split(',');
  if (match[1] && seeds.length !== 1) return false;
  return seeds.every((seed) => {
    try {
      const parsed = new URL(`mongodb://${seed}`);
      return !loopback(parsed.hostname) && !parsed.username && !parsed.password
        && parsed.pathname === '' && (!match[1] || !parsed.port)
        && (isIP(parsed.hostname.replace(/^\[|\]$/g, '')) || /^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(parsed.hostname));
    } catch {
      return false;
    }
  });
}

function checkoutReturn(value, outcome) {
  if (publicHttps(value)) return true;
  // These routes are handled by the existing installed mobile application.
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'hostelhive:' && parsed.hostname === 'payments'
      && parsed.pathname === `/${outcome}` && !parsed.username && !parsed.password && !parsed.hash;
  } catch {
    return false;
  }
}

function mailbox(value) {
  return configured(value) && !/[\r\n]/.test(value)
    && /^(?:[^<>]+<)?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(value.trim());
}

/** Validate configuration before opening a listener. Errors contain setting names, never values. */
function validateProductionConfiguration(env) {
  const errors = [];
  const range = (name, value, minimum, maximum) => {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      errors.push(`${name} must be an integer between ${minimum} and ${maximum}.`);
    }
  };

  if (!['development', 'test', 'production'].includes(env.nodeEnv)) errors.push('NODE_ENV must be development, test or production.');
  range('PORT', env.port, 1, 65535);
  if (!configured(env.host) || (!isIP(env.host) && !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(env.host))) {
    errors.push('IP/HOST must be a valid listen address.');
  }
  if (!['x-forwarded-for', 'x-real-ip'].includes(env.clientIpHeader)) errors.push('CLIENT_IP_HEADER must be x-forwarded-for or x-real-ip.');
  range('HTTP_REQUEST_TIMEOUT_MS', env.server.requestTimeoutMs, 15000, 300000);
  range('HTTP_HEADERS_TIMEOUT_MS', env.server.headersTimeoutMs, 5000, env.server.requestTimeoutMs);
  range('HTTP_KEEP_ALIVE_TIMEOUT_MS', env.server.keepAliveTimeoutMs, 1000, env.server.headersTimeoutMs - 1);
  range('SHUTDOWN_TIMEOUT_MS', env.server.shutdownTimeoutMs, 1000, 60000);
  range('API_RATE_LIMIT_WINDOW_MS', env.rateLimit.api.windowMs, 1000, 86400000);
  range('API_RATE_LIMIT_MAX', env.rateLimit.api.max, 1, 100000);
  range('AUTH_RATE_LIMIT_WINDOW_MS', env.rateLimit.auth.windowMs, 1000, 86400000);
  range('AUTH_RATE_LIMIT_MAX', env.rateLimit.auth.max, 1, 100000);
  range('MONGO_MAX_POOL_SIZE', env.mongo.maxPoolSize, 1, 100);
  range('MONGO_MIN_POOL_SIZE', env.mongo.minPoolSize, 0, env.mongo.maxPoolSize);
  range('MONGO_SERVER_SELECTION_TIMEOUT_MS', env.mongo.serverSelectionTimeoutMs, 1000, 30000);
  range('UPLOAD_MAX_CONCURRENT', env.uploads.maxConcurrent, 1, 10);
  range('UPLOAD_MAX_CONCURRENT_PER_USER', env.uploads.maxConcurrentPerUser, 1, env.uploads.maxConcurrent);
  range('EMAIL_API_TIMEOUT_MS', env.email.apiTimeoutMs, 1000, 30000);
  if (!configured(env.email.brevoApiKey)) errors.push('BREVO_API_KEY is required for OTP delivery.');
  if (!parseEmailSender(env.email.from)) errors.push('EMAIL_FROM must contain one valid Brevo sender mailbox, optionally with a display name.');

  if (env.nodeEnv === 'production') {
    if (env.clientIpHeader === 'x-real-ip' && !env.trustProxy) {
      errors.push('CLIENT_IP_HEADER=x-real-ip requires an explicit trusted reverse proxy in TRUST_PROXY.');
    }
    if (!mongoConnection(env.mongoUri)) errors.push('MONGO_URI must be a non-loopback mongodb:// or mongodb+srv:// connection with an explicit database name.');
    for (const [name, value] of [['JWT_SECRET', env.jwt.secret], ['JWT_REFRESH_SECRET', env.jwt.refreshSecret]]) {
      if (!configured(value) || Buffer.byteLength(value.trim()) < 32 || /^(your[_ -]|replace[_ -]|change[_ -]|example|placeholder)/i.test(value.trim())) {
        errors.push(`${name} must contain a strong, non-placeholder secret of at least 32 bytes.`);
      }
    }
    if (env.jwt.secret === env.jwt.refreshSecret) errors.push('JWT_SECRET and JWT_REFRESH_SECRET must be different.');
    for (const [name, expiresIn] of [['JWT_EXPIRES_IN', env.jwt.expiresIn], ['JWT_REFRESH_EXPIRES_IN', env.jwt.refreshExpiresIn]]) {
      try {
        const jwt = require('jsonwebtoken');
        const token = jwt.sign({ sub: 'configuration-check' }, 'configuration-check-only', { expiresIn });
        const lifetime = jwt.decode(token);
        if (lifetime.exp <= lifetime.iat) throw new Error();
      } catch {
        errors.push(`${name} must be a valid token lifetime, for example 7d or 30d.`);
      }
    }
    range('BCRYPT_SALT_ROUNDS', env.bcryptSaltRounds, 10, 15);

    if (!env.cors.webOrigins.length || !env.cors.webOrigins.every((origin) => publicHttps(origin, { originOnly: true }))) {
      errors.push('CLIENT_WEB_ORIGIN must contain exact HTTPS origins, separated by commas, without paths, wildcards or trailing slashes.');
    }
    if (configured(process.env.CLIENT_MOBILE_ORIGIN) && env.cors.mobileOrigin !== '*' && !publicHttps(env.cors.mobileOrigin, { originOnly: true })) {
      errors.push('CLIENT_MOBILE_ORIGIN must be an exact HTTPS origin when configured for a browser build. Native applications do not send a browser Origin header.');
    }
    const imagekit = env.integrations.imagekit;
    if (!configured(imagekit.publicKey) || !configured(imagekit.privateKey) || !publicHttps(imagekit.urlEndpoint)) {
      errors.push('IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY and an HTTPS IMAGEKIT_URL_ENDPOINT are required for production uploads.');
    }
    if (process.env.ALLOW_SIMULATED_UPLOADS === 'true') errors.push('ALLOW_SIMULATED_UPLOADS must not be enabled in production.');
    if (!Number.isFinite(env.pkrPerUsd) || env.pkrPerUsd <= 0) errors.push('PKR_PER_USD must be a positive number.');
    try {
      new Intl.DateTimeFormat('en', { timeZone: process.env.BILLING_TIMEZONE || 'Asia/Karachi' });
    } catch {
      errors.push('BILLING_TIMEZONE must be a valid IANA time zone.');
    }

    const stripe = env.integrations.stripe;
    if ([stripe.secretKey, stripe.publishableKey, stripe.webhookSecret].some(configured)) {
      if (!configured(stripe.secretKey) || !configured(stripe.webhookSecret)) errors.push('Configured Stripe payments require STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET together.');
      for (const [name, value] of [['STRIPE_CONNECT_RETURN_URL', stripe.connectReturnUrl], ['STRIPE_CONNECT_REFRESH_URL', stripe.connectRefreshUrl]]) {
        if (!publicHttps(value)) errors.push(`${name} must be a public HTTPS callback URL.`);
      }
      if (!checkoutReturn(stripe.successUrl, 'success')) errors.push('STRIPE_SUCCESS_URL must be HTTPS or the existing hostelhive://payments/success app route.');
      if (!checkoutReturn(stripe.cancelUrl, 'cancel')) errors.push('STRIPE_CANCEL_URL must be HTTPS or the existing hostelhive://payments/cancel app route.');
    }

    const blockchain = env.integrations.blockchain;
    if ([blockchain.rpcUrl, blockchain.privateKey].some(configured)) {
      if (!publicHttps(blockchain.rpcUrl) || !/^0x[0-9a-fA-F]{64}$/.test(blockchain.privateKey || '')) {
        errors.push('Configured blockchain writes require an HTTPS BLOCKCHAIN_RPC_URL and a valid BLOCKCHAIN_PRIVATE_KEY together.');
      }
      if (!publicHttps(blockchain.explorerTxBaseUrl)) errors.push('BLOCKCHAIN_EXPLORER_TX_BASE_URL must be HTTPS.');
    }
    const firebase = env.integrations.firebase;
    if ([firebase.projectId, firebase.clientEmail, firebase.privateKey].some(configured)) {
      if (![firebase.projectId, firebase.clientEmail, firebase.privateKey].every(configured)) {
        errors.push('Configured push delivery requires FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY together.');
      } else {
        try {
          if (!mailbox(firebase.clientEmail)) throw new Error();
          createPrivateKey(firebase.privateKey.replace(/\\n/g, '\n'));
        } catch {
          errors.push('FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY must be valid service-account credentials.');
        }
      }
    }
    if (configured(env.integrations.groq.apiKey) && !publicHttps(env.integrations.groq.baseUrl)) errors.push('GROQ_BASE_URL must use public HTTPS when Groq is configured.');
  }

  if (errors.length) throw new Error(`Invalid server configuration:\n- ${errors.join('\n- ')}`);
}

module.exports = { validateProductionConfiguration };
