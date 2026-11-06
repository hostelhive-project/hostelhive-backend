const Joi = require('joi');
const { phoneJoiRule } = require('./phone.validator');

const createBookingSchema = Joi.object({
  roomId: Joi.string().hex().length(24).required(),
  emergencyContact: Joi.string()
    .trim()
    .custom(phoneJoiRule)
    .required()
    .messages({
      'any.required': 'Emergency contact phone number is required.',
      'string.empty': 'Emergency contact phone number is required.',
      'any.invalid': 'Please enter a valid emergency contact phone number.',
    }),
  cnicFrontUrl: Joi.string().uri().allow('', null),
  cnicBackUrl: Joi.string().uri().allow('', null),
  termsAcceptedAt: Joi.date().iso().allow(null),
});

const rejectBookingSchema = Joi.object({
  reason: Joi.string().max(300).allow('', null),
});

module.exports = { createBookingSchema, rejectBookingSchema };
