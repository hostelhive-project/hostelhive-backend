const AppError = require('../utils/AppError');

/**
 * Route guard: 403s any user whose role isn't in the allowed list.
 * Usage: router.post('/hostels', authenticate, requireRole('Admin'), controller)
 * Matches SDS Fig 3, Flow B ("Verification Fails (Unauthorized Role)" -> 403).
 */
function requireRole(...allowedRoles) {
  return function roleGuard(req, res, next) {
    if (!req.user) {
      return next(new AppError('Authentication required', 401));
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(new AppError('You do not have permission to perform this action', 403));
    }
    return next();
  };
}

module.exports = requireRole;
