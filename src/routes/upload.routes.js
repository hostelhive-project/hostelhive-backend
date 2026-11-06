const router = require('express').Router();
const uploadController = require('../controllers/upload.controller');
const { uploadSingle, uploadMultiple } = require('../middleware/upload.middleware');
const authenticate = require('../middleware/auth.middleware');
const requireRole = require('../middleware/rbac.middleware');
const capacity = require('../middleware/uploadCapacity.middleware');
const rateLimit = require('express-rate-limit');
const validate = require('../middleware/validate');
const { uploadMetadataSchema } = require('../validators/upload.validator');
router.use(authenticate, rateLimit({ windowMs: 15 * 60 * 1000, max: 30,
  keyGenerator: (req) => req.user.id, standardHeaders: true, legacyHeaders: false }), capacity);

// Upload single image (Admin, Student, CleaningStaff)
router.post(
  '/image',
  authenticate,
  requireRole('Admin', 'Student', 'CleaningStaff'),
  uploadSingle('image'),
  validate(uploadMetadataSchema),
  uploadController.uploadSingle
);

// Upload multiple hostel gallery images (Admin only, up to 10 at once)
router.post(
  '/images',
  authenticate,
  requireRole('Admin'),
  uploadMultiple('images', 5),
  validate(uploadMetadataSchema),
  uploadController.uploadMultiple
);

module.exports = router;
