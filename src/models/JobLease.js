const mongoose = require('mongoose');
// Added: coordinate durable workers across multiple API processes.
module.exports = mongoose.model('JobLease', new mongoose.Schema({
  _id: String, owner: String, expiresAt: Date,
}));
