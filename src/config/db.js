const mongoose = require('mongoose');
const env = require('./env');
const { prepareProductionDatabase } = require('../repositories/database.repository');
let initialized = false;

async function connectDB() {
  mongoose.set('strictQuery', true);

  try {
    initialized = false;
    const options = {
      serverSelectionTimeoutMS: env.mongo.serverSelectionTimeoutMs,
      maxPoolSize: env.mongo.maxPoolSize,
      minPoolSize: env.mongo.minPoolSize,
      ...(env.nodeEnv === 'production' ? { autoIndex: false, autoCreate: false } : {}),
    };
    if (env.nodeEnv === 'test') {
      if (!/^hostelhive_test_[a-zA-Z0-9_]+$/.test(process.env.TEST_DATABASE_NAME || '')) {
        throw new Error('Refusing test connection without an isolated TEST_DATABASE_NAME.');
      }
      options.dbName = process.env.TEST_DATABASE_NAME;
    }
    await mongoose.connect(env.mongoUri, options);
    if (env.nodeEnv === 'production') await prepareProductionDatabase();
    initialized = true;
    // eslint-disable-next-line no-console
    console.log(`[db] MongoDB connected -> ${mongoose.connection.host}/${mongoose.connection.name}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[db] MongoDB startup failed. Check connection, transaction support and model indexes.');
    await mongoose.disconnect().catch(() => undefined);
    // Connection errors can contain credentials or provider connection strings.
    if (err.message === 'Production MongoDB must support transactions. Use Atlas or a replica set.') throw err;
    throw new Error('MongoDB startup failed. Check MONGO_URI, Atlas access and conflicting model indexes.');
  }

  mongoose.connection.on('disconnected', () => {
    // eslint-disable-next-line no-console
    console.warn('[db] MongoDB disconnected');
  });
}

module.exports = connectDB;
module.exports.isReady = () => initialized && mongoose.connection.readyState === 1;
module.exports.disconnect = async () => {
  initialized = false;
  await mongoose.disconnect();
};
