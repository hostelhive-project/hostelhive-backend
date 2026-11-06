const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * NOTE on `role`:
 * The original ERD/class diagram included "Resident" as a 4th role choosable
 * at registration. Per the backend understanding doc (Part 6, Conflict #2),
 * that's wrong — the SRS and wireframes describe "Resident" as a *status* a
 * Student reaches after a booking is approved + checked in, not something
 * anyone registers as. We keep the role enum to 3 values and derive
 * residency from an active Booking (status: CheckedIn) at query time.
 */
const ROLES = ['Student', 'Admin', 'CleaningStaff'];

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email address'],
    },
    passwordHash: { type: String, required: true, select: false },
    sessionVersion: { type: Number, default: 0, select: false },
    bookingRevision: { type: Number, default: 0, select: false },
    role: { type: String, enum: ROLES, required: true, default: 'Student' },
    // Existing accounts predate email confirmation; new self-registrations set this false.
    emailVerified: { type: Boolean, default: true },
    emailOtpPurpose: { type: String, enum: ['signup', 'password-reset', 'staff-invite'], select: false },
    emailOtpHash: { type: String, select: false },
    emailOtpExpiresAt: { type: Date, select: false },
    emailOtpSentAt: { type: Date, select: false },
    emailOtpAttempts: { type: Number, default: 0, select: false },

    // Added — present on the Student Registration wireframe but missing from the original ERD.
    phone: { type: String, trim: true },
    regNumber: { type: String, trim: true }, // student reg#, staff ID, or CNIC depending on role
    registrationTermsAcceptedAt: { type: Date, default: null },
    registrationTermsVersion: { type: String, default: null },
    profileImageUrl: { type: String, default: null },

    // Added — scopes Admin/CleaningStaff to a single hostel branch (multi-hostel RBAC, NFR-09).
    // Admin: nullable at registration, auto-assigned when they create their hostel
    // (see hostelController.create) — avoids the chicken-and-egg problem of
    // requiring a hostelId that can't exist yet. CleaningStaff: required, since
    // staff are only ever added to an already-existing hostel.
    hostelId: {
      type: Schema.Types.ObjectId,
      ref: 'Hostel',
      required: function requiredForStaffRoles() {
        return this.role === 'CleaningStaff';
      },
      default: null,
    },

    isActive: { type: Boolean, default: true },

    // Permanent HostelHive Resident ID (e.g. RES-000001).
    // Assigned upon first successful CheckIn; remains immutable across room changes and checkouts.
    residentCode: { type: String, trim: true },

    // Added — the frontend's FCM registration token, used to deliver push
    // notifications (see integrations/firebase.js). Null means "no push,
    // in-app inbox only," which is a fully valid state, not an error.
    deviceToken: { type: String, default: null },
  },
  { timestamps: true }
);

userSchema.index({ role: 1, hostelId: 1 });

// Never leak the hash even if a query accidentally selects it.
userSchema.methods.toJSON = function toJSON() {
  const obj = this.toObject();
  delete obj.passwordHash;
  delete obj.sessionVersion;
  delete obj.bookingRevision;
  delete obj.emailOtpPurpose;
  delete obj.emailOtpHash;
  delete obj.emailOtpExpiresAt;
  delete obj.emailOtpSentAt;
  delete obj.emailOtpAttempts;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
module.exports.ROLES = ROLES;
