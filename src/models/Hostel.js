const mongoose = require('mongoose');

const { Schema } = mongoose;

const hostelSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    resourceRevision: { type: Number, default: 0, select: false },
    // Added for draft setup. Missing status on legacy records means published.
    publicationStatus: { type: String, enum: ['Draft', 'Published'], default: 'Published' },
    location: { type: String, required: true, trim: true },
    priceTier: { type: Number, required: true },
    facilities: { type: [String], default: [] },

    // Dedicated banner image stored separately from gallery images
    bannerImage: { type: String, default: '' },
    // Gallery / additional photos of the hostel (rooms, mess, washrooms, etc.)
    images: { type: [String], default: [] },
    ratingAvg: { type: Number, default: 0, min: 0, max: 5 },
    reviewCount: { type: Number, default: 0 },

    // Added — scopes this hostel to the Admin who manages it (multi-hostel RBAC).
    // Per project decision: there is no separate "Owner" entity — the Admin
    // manages the hostel (and its Stripe Connect account) entirely on the
    // real-world owner's behalf.
    ownerAdminId: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    // Added — Stripe Connect. This hostel's connected account receives
    // resident payments directly; HostelHive never holds the money, only
    // records that a payment happened (see payment.service.js). Null until
    // the Admin completes onboarding via POST /api/hostels/:id/stripe/onboard.
    stripeAccountId: { type: String, default: null },
    stripeOnboardingComplete: { type: Boolean, default: false },

    // Property operational details used across Admin Web, Student hostel details,
    // and chatbot grounding (single source of truth for timings, rules, and contact)
    propertyInfo: {
      gateOpenTime: { type: String, default: '' }, // e.g. "06:00"
      gateCloseTime: { type: String, default: '' }, // e.g. "23:00"
      houseRules: { type: [String], default: [] },
      receptionContact: { type: String, default: '' },
      nearbyLandmarks: { type: String, default: '' },
    },

    // Chatbot-specific / private knowledge (WiFi password, emergency contact, additional notes)
    // Legacy fields preserved for backward compatibility
    chatbotInfo: {
      wifiPassword: { type: String, default: '' },
      emergencyContact: { type: String, default: '' },
      additionalInfo: { type: String, default: '' },
      checkInTime: { type: String, default: '' }, // legacy
      checkOutTime: { type: String, default: '' }, // legacy
      rules: { type: [String], default: [] }, // legacy fallback
      contactNumber: { type: String, default: '' }, // legacy fallback
      nearbyLandmarks: { type: String, default: '' }, // legacy fallback
      updatedAt: { type: Date, default: null },
    },

    // Daily active cleaning directive broadcast by Admin to cleaning staff
    cleaningDirective: {
      text: { type: String, default: null },
      updatedAt: { type: Date, default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    },

    // Permanent, human-readable uppercase code (e.g. "ROY", "T2M", "LAF").
    // Immutable after creation, used for resident codes (<hostelCode>-RES-<counter>).
    hostelCode: {
      type: String,
      trim: true,
      uppercase: true,
    },
  },
  { timestamps: true }
);

hostelSchema.index({ location: 1, priceTier: 1 });
hostelSchema.index({ name: 'text', location: 'text' });
hostelSchema.index({ hostelCode: 1 }, { unique: true });
// One Admin owns one hostel; this also closes the concurrent bootstrap race.
hostelSchema.index({ ownerAdminId: 1 }, { unique: true });

hostelSchema.pre('validate', async function () {
  if (!this.hostelCode && this.name) {
    const { generateUniqueHostelCode } = require('../utils/hostelCode');
    this.hostelCode = await generateUniqueHostelCode(this.name, this._id);
  }
});

module.exports = mongoose.model('Hostel', hostelSchema);
