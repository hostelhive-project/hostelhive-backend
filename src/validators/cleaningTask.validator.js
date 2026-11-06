const Joi = require('joi');

const assignTaskSchema = Joi.object({
  roomId: Joi.string().hex().length(24).required(),
  assignedStaffId: Joi.string().hex().length(24).required(),
  taskType: Joi.string().valid('Routine', 'DeepClean', 'Emergency').required(),
  scheduledTime: Joi.date().iso().required(),
});

const completeTaskSchema = Joi.object({
  afterImageUri: Joi.string().uri().required(),
  staffNotes: Joi.string().max(1000).allow('', null),
});

const delayTaskSchema = Joi.object({
  reason: Joi.string().max(300).allow('', null),
});

const startTaskSchema = Joi.object({
  beforeImageUri: Joi.string().uri().optional(),
});

const broadcastDirectiveSchema = Joi.object({
  directive: Joi.string().trim().min(3).max(500).required(),
});

module.exports = {
  assignTaskSchema,
  completeTaskSchema,
  delayTaskSchema,
  startTaskSchema,
  broadcastDirectiveSchema,
};
