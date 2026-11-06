const multer = require('multer');
const AppError = require('../utils/AppError');

// In-memory buffer storage: files are streamed straight to ImageKit CDN without touching local disk
const storage = multer.memoryStorage();

// Supported image MIME types
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

const fileFilter = (req, file, cb) => {
  const mime = (file.mimetype || '').toLowerCase();
  if (ALLOWED_MIME_TYPES.includes(mime)) {
    cb(null, true);
  } else {
    cb(
      new AppError(
        'This image format is not supported. Please upload JPG, PNG, or WEBP images only.',
        400
      ),
      false
    );
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB per file
    fields: 4, fieldSize: 4096, parts: 12,
  },
});

module.exports = {
  uploadSingle: (fieldName = 'image') => upload.single(fieldName),
  uploadMultiple: (fieldName = 'images', maxCount = 10) => upload.array(fieldName, maxCount),
};
