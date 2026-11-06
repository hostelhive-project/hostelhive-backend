const mongoose = require('mongoose');

const { Schema } = mongoose;

const BOOKING_STATUSES = ['Pending', 'Approved', 'Rejected', 'Cancelled', 'CheckedIn', 'CheckedOut'];

const bookingSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    roomId: { type: Schema.Types.ObjectId, ref: 'Room', required: true },
    monthlyRent: { type: Number, default: null, min: 0 },
    status: { type: String, enum: BOOKING_STATUSES, default: 'Pending' },
    bookingDate: { type: Date, default: Date.now },

    // Added — captured on the Booking Screen wireframe, absent from the original ERD.
    emergencyContact: { type: String, trim: true },
    cnicFrontUrl: { type: String },
    cnicBackUrl: { type: String },
    termsAcceptedAt: { type: Date },

    rejectionReason: { type: String, default: null },
    approvedAt: { type: Date, default: null },
    checkedInAt: { type: Date, default: null },
    checkedOutAt: { type: Date, default: null },
    residentCode: { type: String, trim: true, default: null },
  },
  { timestamps: true,
    toJSON: { transform: require('../utils/privateMedia').bookingDocuments },
    toObject: { transform: require('../utils/privateMedia').bookingDocuments },
  }
);

bookingSchema.index({ roomId: 1, status: 1 });
bookingSchema.index({ studentId: 1 });

module.exports = mongoose.model('Booking', bookingSchema);
module.exports.BOOKING_STATUSES = BOOKING_STATUSES;
