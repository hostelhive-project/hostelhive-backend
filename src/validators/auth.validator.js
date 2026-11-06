const Joi = require('joi');

const { phoneJoiRule } = require('./phone.validator');

const registerSchema = Joi.object({
  name: Joi.string()
    .trim()
    .min(2)
    .max(100)
    .required()
    .messages({
      'string.empty': 'Full name is required.',
      'string.min': 'Full name must be at least 2 characters long.',
      'any.required': 'Full name is required.',
    }),
  email: Joi.string()
    .trim()
    .email()
    .required()
    .messages({
      'string.empty': 'Email address is required.',
      'string.email': 'Please enter a valid email address (e.g. name@property.com).',
      'any.required': 'Email address is required.',
    }),
  password: Joi.string()
    .min(8)
    .max(128)
    .required()
    .messages({
      'string.empty': 'Password is required.',
      'string.min': 'Password must be at least 8 characters long.',
      'any.required': 'Password is required.',
    }),
  role: Joi.string().valid('Student', 'Admin').default('Student'),
  termsAccepted: Joi.boolean().valid(true).when('role', {
    is: 'Student',
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
  phone: Joi.string()
    .trim()
    .custom(phoneJoiRule)
    .allow('', null)
    .messages({
      'any.invalid': 'Please enter a valid phone number (e.g. +92 300 1234567).',
    }),
  regNumber: Joi.string().trim().max(50).allow('', null),
  hostelId: Joi.forbidden(),
});

const loginSchema = Joi.object({
  email: Joi.string()
    .trim()
    .email()
    .required()
    .messages({
      'string.empty': 'Email address is required.',
      'string.email': 'Please enter a valid email address.',
      'any.required': 'Email address is required.',
    }),
  password: Joi.string()
    .required()
    .messages({
      'string.empty': 'Password cannot be empty.',
      'any.required': 'Password is required.',
    }),
});

const refreshSchema = Joi.object({
  refreshToken: Joi.string().required().messages({
    'string.empty': 'Refresh token is required.',
    'any.required': 'Refresh token is required.',
  }),
});

const emailOtpSchema = Joi.object({
  email: Joi.string().trim().email().required(),
  otp: Joi.string().pattern(/^\d{6}$/).required().messages({
    'string.pattern.base': 'Enter the 6-digit code sent to your email.',
  }),
});

const emailSchema = Joi.object({
  email: Joi.string().trim().email().required(),
});

const resetPasswordSchema = emailOtpSchema.append({
  newPassword: Joi.string().min(8).max(128).required().messages({
    'string.min': 'Password must be at least 8 characters long.',
  }),
});

const activateStaffInviteSchema = emailOtpSchema.append({
  newPassword: Joi.string().min(8).max(128).required().messages({
    'string.min': 'Password must be at least 8 characters long.',
  }),
});

const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().min(1).max(128).required().messages({
    'string.empty': 'Current password is required.',
    'any.required': 'Current password is required.',
  }),
  newPassword: Joi.string().min(8).max(128).required().messages({
    'string.min': 'New password must be at least 8 characters long.',
    'any.required': 'New password is required.',
  }),
});

module.exports = {
  registerSchema,
  loginSchema,
  refreshSchema,
  emailOtpSchema,
  emailSchema,
  resetPasswordSchema,
  activateStaffInviteSchema,
  changePasswordSchema,
};

