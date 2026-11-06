const CleaningTask = require('../models/CleaningTask');
const Budget = require('../models/CleaningAssessmentBudget');

function ownedClaim(task) {
  return { _id: task._id, status: 'Completed',
    'cleaningAssessment.status': 'Processing', 'cleaningAssessment.startedAt': task.cleaningAssessment.startedAt };
}

module.exports = {
  find: (taskId) => CleaningTask.findById(taskId).select('status cleaningAssessment').lean(),
  claim: (taskId) => CleaningTask.findOneAndUpdate({ _id: taskId, status: 'Completed', $or: [
    { 'cleaningAssessment.status': 'Pending' },
    { 'cleaningAssessment.status': 'Processing', 'cleaningAssessment.startedAt': { $lte: new Date(Date.now() - 120000) } },
  ] }, { $set: { 'cleaningAssessment.status': 'Processing', 'cleaningAssessment.startedAt': new Date() } }, { new: true }),

  beginAttempt: (task) => CleaningTask.findOneAndUpdate({ ...ownedClaim(task), 'cleaningAssessment.attempts': { $lt: 2 } },
    { $inc: { 'cleaningAssessment.attempts': 1 } }, { new: true }),

  finish: (task, result) => CleaningTask.updateOne(ownedClaim(task), { $set: Object.fromEntries(
    Object.entries(result).map(([key, value]) => [`cleaningAssessment.${key}`, value])
  ) }, { runValidators: true }),

  async reserve(limit, now = new Date()) {
    const id = now.toISOString().slice(0, 10);
    try {
      await Budget.updateOne({ _id: id }, { $setOnInsert: {
        requests: 0, nextAllowedAt: new Date(0), expiresAt: new Date(now.getTime() + 35 * 86400000),
      } }, { upsert: true });
    } catch (error) { if (error.code !== 11000) throw error; }
    const reserved = await Budget.findOneAndUpdate({ _id: id, requests: { $lt: limit }, nextAllowedAt: { $lte: now } },
      { $inc: { requests: 1 }, $set: { nextAllowedAt: new Date(now.getTime() + 65000) } }, { new: true });
    if (reserved) return { allowed: true };
    const budget = await Budget.findById(id).lean();
    if (!budget || budget.requests >= limit) return { allowed: false, exhausted: true };
    return { allowed: false, retryAt: budget.nextAllowedAt };
  },
};
