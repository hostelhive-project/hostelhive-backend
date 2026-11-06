const mongoose = require('mongoose');

// Added over the ERD: persistent global request budget for optional Groq cleaning assessments.
const schema = new mongoose.Schema({
  _id: { type: String }, // UTC calendar date; shared across workers and hostels.
  requests: { type: Number, default: 0 },
  nextAllowedAt: { type: Date, default: () => new Date(0) },
  expiresAt: { type: Date, required: true },
}, { versionKey: false });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('CleaningAssessmentBudget', schema);
