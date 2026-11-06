const Joi = require('joi');
const { phoneJoiRule } = require('./phone.validator');

const updateProfileSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100),
  phone: Joi.string().trim().custom(phoneJoiRule).allow('', null).messages({
    'any.invalid': 'Please enter a valid phone number (e.g. +92 300 1234567).',
  }),
  profileImageUrl: Joi.string().uri().allow('', null),
  deviceToken: Joi.string().max(500).allow('', null),
}).min(1);

const createStaffSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  email: Joi.string().trim().email().required(),
  phone: Joi.string().trim().custom(phoneJoiRule).allow('', null).messages({
    'any.invalid': 'Please enter a valid phone number (e.g. +92 300 1234567).',
  }),
});

const updateStaffSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100),
  phone: Joi.string().trim().custom(phoneJoiRule).allow('', null).messages({
    'any.invalid': 'Please enter a valid phone number (e.g. +92 300 1234567).',
  }),
}).min(1);

const updateStaffInvitationSchema = Joi.object({
  email: Joi.string().trim().email().required(),
});

const deleteStaffSchema = Joi.object({}).max(0);

module.exports = {
  updateProfileSchema,
  createStaffSchema,
  updateStaffSchema,
  updateStaffInvitationSchema,
  deleteStaffSchema,
};

