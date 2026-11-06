const Joi = require('joi');

const sendMessageSchema = Joi.object({
  message: Joi.string().min(1).max(1000).required(),
  sessionId: Joi.string().uuid().allow(null),
  hostelId: Joi.string().hex().length(24).allow(null),
});

module.exports = { sendMessageSchema };
