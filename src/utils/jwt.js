const jwt = require('jsonwebtoken');
const env = require('../config/env');

function signAccessToken(payload) {
  return jwt.sign({ ...payload, kind: 'access' }, env.jwt.secret, { expiresIn: env.jwt.expiresIn });
}

function signRefreshToken(payload) {
  return jwt.sign({ ...payload, kind: 'refresh' }, env.jwt.refreshSecret, { expiresIn: env.jwt.refreshExpiresIn });
}

function verifyAccessToken(token) {
  const decoded = jwt.verify(token, env.jwt.secret, { algorithms: ['HS256'] });
  if (decoded.kind && decoded.kind !== 'access') throw new Error('Invalid token purpose');
  return decoded;
}

function verifyRefreshToken(token) {
  const decoded = jwt.verify(token, env.jwt.refreshSecret, { algorithms: ['HS256'] });
  if (decoded.kind && decoded.kind !== 'refresh') throw new Error('Invalid token purpose');
  return decoded;
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};
