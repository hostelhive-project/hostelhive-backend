const mongoose = require('mongoose');

const { Schema } = mongoose;

const TASK_TYPES = ['Routine', 'DeepClean', 'Emergency'];
const TASK_STATUSES = ['Scheduled', 'InProgress', 'Completed', 'Delayed'];

// Added: advisory assessment of visible photo evidence, independent of task completion.
const assessmentSchema = new Schema({
  // ManualReview is accepted only for legacy records; current processing produces a rating or Unavailable.
  status: { type: String, enum: ['Pending', 'Processing', 'Assessed', 'ManualReview', 'Unavailable'], required: true },
  score: { type: Number, min: 0, max: 10, default: null },
  breakdown: {
    waste: { type: Number, min: 0, max: 3, default: null },
    floor: { type: Number, min: 0, max: 3, default: null },
    surfaces: { type: Number, min: 0, max: 3, default: null },
    tidiness: { type: Number, min: 0, max: 1, default: null },
  },
  estimated: { type: Boolean, default: false },
  imageQuality: { type: String, enum: ['Good', 'Limited', 'Unusable'], default: null },
  evidenceCoverage: { type: Number, min: 0, max: 100, default: null },
  comparison: { type: String, enum: ['Improved', 'Similar', 'Worse', 'Unclear'], default: 'Unclear' },
  summary: { type: String, maxlength: 600, default: '' },
  improvements: [{ type: String, maxlength: 240 }],
  issues: [{ type: String, maxlength: 240 }],
  limitations: [{ type: String, maxlength: 240 }],
  reason: { type: String, maxlength: 80, default: null },
  model: { type: String, maxlength: 120 },
  promptVersion: { type: String, default: 'cleaning-v2' },
  pairHash: { type: String, default: null },
  attempts: { type: Number, default: 0, min: 0, max: 2 },
  queuedAt: { type: Date, required: true },
  startedAt: { type: Date, default: null },
  assessedAt: { type: Date, default: null },
}, { _id: false });

const cleaningTaskSchema = new Schema(
  {
    roomId: { type: Schema.Types.ObjectId, ref: 'Room', required: true },
    assignedStaffId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    taskType: { type: String, enum: TASK_TYPES, required: true },
    status: { type: String, enum: TASK_STATUSES, default: 'Scheduled' },
    scheduledTime: { type: Date, required: true },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    staffNotes: { type: String, default: '' },
    beforeImageUri: { type: String, default: null },
    afterImageUri: { type: String, default: null },
    uiStatusBadgeColor: { type: String, default: '#F59E0B' },
    delayReason: { type: String, default: null },
    cleaningAssessment: { type: assessmentSchema, default: undefined },
  },
  { timestamps: true }
);

cleaningTaskSchema.index({ assignedStaffId: 1, status: 1 });
cleaningTaskSchema.index({ roomId: 1 });

module.exports = mongoose.model('CleaningTask', cleaningTaskSchema);
module.exports.TASK_TYPES = TASK_TYPES;
module.exports.TASK_STATUSES = TASK_STATUSES;
