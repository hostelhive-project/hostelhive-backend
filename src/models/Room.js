const mongoose = require('mongoose');

const { Schema } = mongoose;

const LAYOUT_TYPES = ['Single', 'Shared-2', 'Shared-4'];

const roomSchema = new Schema(
  {
    hostelId: { type: Schema.Types.ObjectId, ref: 'Hostel', required: true },
    roomNumber: { type: String, required: true, trim: true },
    layoutType: { type: String, enum: LAYOUT_TYPES, required: true },
    capacity: { type: Number, required: true, min: 1 },
    occupiedCount: { type: Number, default: 0, min: 0 },
    bookingRevision: { type: Number, default: 0, select: false },
    manuallyLocked: { type: Boolean, default: false },
    // Concurrency mutex — prevents two students finalizing a booking on the same slot at once.
    isLocked: { type: Boolean, default: false },
    uiColorTag: { type: String, default: '#22C55E' },
    monthlyRent: { type: Number, default: null, min: 0 },
  },
  { timestamps: true }
);

roomSchema.index({ hostelId: 1, isLocked: 1 });
roomSchema.pre('validate', function enforceCapacity(next) {
  if (this.occupiedCount > this.capacity) {
    return next(new Error('occupiedCount cannot exceed capacity'));
  }
  return next();
});

module.exports = mongoose.model('Room', roomSchema);
module.exports.LAYOUT_TYPES = LAYOUT_TYPES;
