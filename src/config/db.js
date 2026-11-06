const mongoose = require('mongoose');
const env = require('./env');

async function connectDB() {
  mongoose.set('strictQuery', true);

  try {
    const options = { serverSelectionTimeoutMS: 10000 };
    if (env.nodeEnv === 'test') {
      if (!/^hostelhive_test_[a-zA-Z0-9_]+$/.test(process.env.TEST_DATABASE_NAME || '')) {
        throw new Error('Refusing test connection without an isolated TEST_DATABASE_NAME.');
      }
      options.dbName = process.env.TEST_DATABASE_NAME;
    }
    await mongoose.connect(env.mongoUri, options);
    // eslint-disable-next-line no-console
    console.log(`[db] MongoDB connected -> ${mongoose.connection.host}/${mongoose.connection.name}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[db] MongoDB connection failed:', err.message);
    throw err;
  }

  mongoose.connection.on('disconnected', () => {
    // eslint-disable-next-line no-console
    console.warn('[db] MongoDB disconnected');
  });
}

module.exports = connectDB;
