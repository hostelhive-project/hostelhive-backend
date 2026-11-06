const mongoose = require('mongoose');
// Added: server-owned upload identity and private-document ownership.
module.exports = mongoose.model('UploadedFile', new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  fileId: { type: String, required: true, unique: true },
  url: { type: String, required: true, unique: true },
  isPrivate: { type: Boolean, default: false },
  size: { type: Number, required: true },
}, { timestamps: true }));
