const UploadedFile = require('../models/UploadedFile');
module.exports = {
  create: (data) => UploadedFile.create(data),
  ownedPrivate: (ownerId, url) => UploadedFile.findOne({ ownerId, url, isPrivate: true }),
};
