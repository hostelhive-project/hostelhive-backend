const mongoose = require('mongoose');

const { Schema } = mongoose;

const TASK_TYPES = ['Routine', 'DeepClean', 'Emergency'];
const TASK_STATUSES = ['Scheduled', 'InProgress', 'Completed', 'Delayed'];

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
  },
  { timestamps: true }
);

cleaningTaskSchema.index({ assignedStaffId: 1, status: 1 });
cleaningTaskSchema.index({ roomId: 1 });

module.exports = mongoose.model('CleaningTask', cleaningTaskSchema);
module.exports.TASK_TYPES = TASK_TYPES;
module.exports.TASK_STATUSES = TASK_STATUSES;
