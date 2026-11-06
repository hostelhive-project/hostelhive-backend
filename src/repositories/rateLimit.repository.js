const RateLimitBucket = require('../models/RateLimitBucket');
module.exports = { async increment(id, expiresAt) {
  try { return await RateLimitBucket.findOneAndUpdate({ _id: id }, { $inc: { count: 1 }, $setOnInsert: { expiresAt } }, { new: true, upsert: true }); }
  catch (error) { if (error.code !== 11000) throw error; return RateLimitBucket.findOneAndUpdate({ _id: id }, { $inc: { count: 1 } }, { new: true }); }
} };
