const crypto = require('crypto');

process.env.NODE_ENV = 'test';
process.env.TEST_DATABASE_NAME = `hostelhive_test_${process.pid}_${crypto.randomBytes(8).toString('hex')}`;
// Tests never deliver email, push, LLM requests or blockchain transactions.
process.env.EMAIL_USER = '';
process.env.EMAIL_APP_PASSWORD = '';
process.env.FIREBASE_PROJECT_ID = '';
process.env.FIREBASE_CLIENT_EMAIL = '';
process.env.FIREBASE_PRIVATE_KEY = '';
process.env.GROQ_API_KEY = '';
process.env.BLOCKCHAIN_RPC_URL = '';
process.env.BLOCKCHAIN_PRIVATE_KEY = '';
process.env.IMAGEKIT_PUBLIC_KEY = '';
process.env.IMAGEKIT_PRIVATE_KEY = '';
process.env.IMAGEKIT_URL_ENDPOINT = 'https://ik.imagekit.io/audit-tests';
process.env.BCRYPT_SALT_ROUNDS = '4';
process.env.JWT_SECRET = 'hostelhive-isolated-test-access-secret';
process.env.JWT_REFRESH_SECRET = 'hostelhive-isolated-test-refresh-secret';
if (process.env.RUN_LIVE_STRIPE_TESTS !== 'true') process.env.STRIPE_SECRET_KEY = 'sk_test_offline_fixture';
