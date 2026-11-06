const { verifyAccessToken } = require('../utils/jwt');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const { User: User } = require('../repositories/data.repository');

/**
 * Verifies the Authorization: Bearer <token> header, decodes it, and loads
 * the current user onto req.user. Matches the RBAC middleware sub-module
 * described in SDS §3.1 (API Layer) and Fig 3 ("Intercept Request for
 * Authorization" / "Decode JWT & Verify Signature").
 */
const authenticate = catchAsync(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const parts = header.trim().split(/\s+/);

  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer' || !parts[1]) {
    throw new AppError('Authentication required. Please log in to continue.', 401);
  }

  const token = parts[1];
  let decoded;
  try {
    decoded = verifyAccessToken(token);
  } catch (err) {
    throw new AppError('Your session has expired or is invalid. Please log in again.', 401);
  }

  const user = await User.findById(decoded.sub).select('+sessionVersion');
  if (!user || !user.isActive || !user.emailVerified) {
    throw new AppError('Account not found or has been deactivated.', 401);
  }
  if ((decoded.ver || 0) !== (user.sessionVersion || 0)) {
    throw new AppError('Your session has been revoked. Please log in again.', 401);
  }

  req.user = {
    id: user._id.toString(),
    _id: user._id.toString(),
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    phone: user.phone || '',
    role: user.role,
    hostelId: user.hostelId ? user.hostelId.toString() : null,
  };

  next();
});

module.exports = authenticate;
