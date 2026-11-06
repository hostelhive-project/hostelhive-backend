const mongoose = require('mongoose');

const { Schema } = mongoose;

const SEVERITY_TIERS = ['Low', 'Medium', 'High', 'Critical'];
const COMPLAINT_STATUSES = ['Submitted', 'InReview', 'AwaitingAdminVerification', 'Resolved'];
const complaintStatusHistorySchema = new Schema({
  status: { type: String, enum: COMPLAINT_STATUSES, required: true },
  changedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  changedAt: { type: Date, required: true, default: Date.now },
}, { _id: false });

const complaintSchema = new Schema(
  {
    residentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    hostelId: { type: Schema.Types.ObjectId, ref: 'Hostel', required: true },
    roomId: { type: Schema.Types.ObjectId, ref: 'Room', default: null },
    roomNumberAtSubmission: { type: String, trim: true, default: null },
    assignedStaffId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    title: { type: String, trim: true, default: '' },
    category: { type: String, trim: true, default: 'GENERAL' },
    description: { type: String, required: true, trim: true },
    photoUrls: { type: [String], default: [] },
    severityTier: { type: String, enum: SEVERITY_TIERS, required: true },
    status: { type: String, enum: COMPLAINT_STATUSES, default: 'Submitted' },
    statusHistory: { type: [complaintStatusHistorySchema], default: [] },
    repairNote: { type: String, trim: true, default: '' },
    repairProofImageUrl: { type: String, default: null },
    residentConfirmedAt: { type: Date, default: null },

    // Added — Sprint 8 evolution notes + Abstract both state that "severe" complaints
    // get written to the blockchain ledger like payments do; the class diagram never
    // added the method. We log Critical-severity complaints the same way as Payments.
    blockchainRef: { type: String, default: null },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' } }
);

complaintSchema.index({ hostelId: 1, status: 1 });
complaintSchema.index({ hostelId: 1, severityTier: 1 });
complaintSchema.index({ status: 1, severityTier: 1 });
complaintSchema.index({ residentId: 1 });
complaintSchema.index({ assignedStaffId: 1, createdAt: -1 });

module.exports = mongoose.model('Complaint', complaintSchema);
module.exports.SEVERITY_TIERS = SEVERITY_TIERS;
module.exports.COMPLAINT_STATUSES = COMPLAINT_STATUSES;

