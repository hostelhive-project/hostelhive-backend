require('dotenv').config();

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
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  mongoUri: required('MONGO_URI', 'mongodb://localhost:27017/hostelhive'),
  jwt: {
    secret: required('JWT_SECRET'),
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    refreshSecret: required('JWT_REFRESH_SECRET'),
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },
  bcryptSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS || 10),
  email: {
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: Number(process.env.EMAIL_PORT || 587),
    user: process.env.EMAIL_USER,
    password: process.env.EMAIL_APP_PASSWORD,
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
      urlEndpoint: (process.env.IMAGEKIT_URL_ENDPOINT || 'https://ik.imagekit.io/pvafewi0b').trim(),
    },
  },
};
