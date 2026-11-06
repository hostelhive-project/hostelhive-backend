const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const { User: User } = require('../repositories/data.repository');

/**
 * Added middleware (not present in the original SDS design). RBAC there was
 * purely role-based: any Admin could hit any /api/hostels/:id route, which
 * breaks NFR-09's "support multiple hostels" requirement once more than one
 * hostel branch is onboarded. This middleware loads the target resource via
 * `loader(req)` and confirms its hostelId matches req.user.hostelId.
 *
 * @param {(req) => Promise<{ hostelId?: import('mongoose').Types.ObjectId | string, _id?: import('mongoose').Types.ObjectId | string, ownerAdminId?: import('mongoose').Types.ObjectId | string } | null>} loader
 */
function scopeToOwnHostel(loader) {
  return catchAsync(async (req, res, next) => {
    // Only Admin/CleaningStaff are hostel-scoped; Students aren't restricted this way.
    if (req.user.role === 'Student') {
      return next();
    }

    const resource = await loader(req);
    if (!resource) {
      throw new AppError('Resource not found', 404);
    }

    // Determine the hostel ID of the target resource:
    // If the resource is a sub-document (Room, Booking, CleaningTask, etc.), it has .hostelId.
    // If the resource IS the Hostel document itself, its primary key is ._id.
    const resourceHostelId = resource.hostelId
      ? resource.hostelId.toString()
      : resource._id
      ? resource._id.toString()
      : null;

    // Check if the current admin is the creator/owner of this hostel
    const isOwner =
      (resource.ownerAdminId && resource.ownerAdminId.toString() === req.user.id) ||
      (resource.adminId && resource.adminId.toString() === req.user.id);

    // Auto-sync: if the admin created/owns this hostel but req.user.hostelId is missing or desynced
    if (isOwner && (!req.user.hostelId || req.user.hostelId !== resourceHostelId)) {
      req.user.hostelId = resourceHostelId;
      await User.findByIdAndUpdate(req.user.id, { hostelId: resourceHostelId }).catch(() => {});
    }

    if (resourceHostelId !== req.user.hostelId && !isOwner) {
      throw new AppError('You cannot access resources outside your assigned hostel', 403);
    }

    return next();
  });
}

module.exports = scopeToOwnHostel;
