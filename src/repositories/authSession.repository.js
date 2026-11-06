const AuthSession = require('../models/AuthSession');

module.exports = {
  create: (data) => AuthSession.create(data),
  consume: (id, userId, tokenHash) => AuthSession.findOneAndUpdate(
    { _id: id, userId, tokenHash, revokedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { revokedAt: new Date() } }, { new: true }
  ),
  revokeAll: (userId) => AuthSession.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } }),
};
