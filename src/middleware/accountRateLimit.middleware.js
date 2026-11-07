const crypto = require('crypto');
const env = require('../config/env');
const repository = require('../repositories/rateLimit.repository');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');

module.exports = function accountRateLimit(purpose, maximum) {
  return catchAsync(async (req, res, next) => {
    const identity = req.body.email?.trim().toLowerCase() || req.user?.id;
    if (!identity) return next();
    const windowMs = 15 * 60 * 1000;
    const bucket = Math.floor(Date.now() / windowMs);
    const digest = crypto.createHmac('sha256', env.jwt.secret).update(identity).digest('hex');
    const record = await repository.increment(`${purpose}:${bucket}:${digest}`, new Date((bucket + 1) * windowMs));
    if (record.count > maximum) {
      res.set('Retry-After', String(Math.max(1, Math.ceil(((bucket + 1) * windowMs - Date.now()) / 1000))));
      throw new AppError('Too many attempts for this account. Please try again later.', 429);
    }
    return next();
  });
};
