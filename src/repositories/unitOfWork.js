const mongoose = require('mongoose');
const AppError = require('../utils/AppError');

module.exports = async function unitOfWork(work) {
  try {
    return await mongoose.connection.transaction(work, {
      readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, maxCommitTimeMS: 10000,
    });
  } catch (error) {
    if (error.code === 20 || /Transaction numbers are only allowed|replica set member or mongos/i.test(error.message)) {
      throw new AppError('This operation requires a transaction-capable database. Ask the administrator to configure a MongoDB replica set.', 503);
    }
    throw error;
  }
};
