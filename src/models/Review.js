const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * Added collection. The SRS stakeholder table promises students "reviews" as
 * part of comparing hostels (Table 2), and US-05's context implies comparison
 * data, but no Review entity ever appeared in the ERD/class diagram/schema tables.
 */
const reviewSchema = new Schema(
  {
    hostelId: { type: Schema.Types.ObjectId, ref: 'Hostel', required: true },
    residentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: true }
);

reviewSchema.index({ hostelId: 1, residentId: 1 }, { unique: true }); // one review per resident per hostel

module.exports = mongoose.model('Review', reviewSchema);
