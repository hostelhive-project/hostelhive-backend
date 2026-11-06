const Joi = require('joi');

const createComplaintSchema = Joi.object({
  title: Joi.string().trim().max(200).optional().allow(''),
  category: Joi.string().trim().max(100).optional().allow(''),
  description: Joi.string().trim().min(5).max(2000).required(),
  severityTier: Joi.string().valid('Low', 'Medium', 'High', 'Critical').required(),
  hostelId: Joi.string().hex().length(24).optional(),
  residentId: Joi.string().hex().length(24).optional(),
  photoUrls: Joi.array().items(Joi.string().uri().max(2048)).max(3).default([]),
});

const assignComplaintSchema = Joi.object({
  staffId: Joi.string().hex().length(24).required(),
});

const updateStatusSchema = Joi.object({
  status: Joi.string().valid('Submitted', 'InReview', 'AwaitingAdminVerification', 'Resolved').required(),
});

const markFixedSchema = Joi.object({
  repairNote: Joi.string().trim().max(1000).allow('', null),
  repairProofImageUrl: Joi.string().uri().max(2048).allow('', null),
});

const residentComplaintActionSchema = Joi.object({}).max(0);

module.exports = {
  createComplaintSchema,
  assignComplaintSchema,
  updateStatusSchema,
  markFixedSchema,
  residentComplaintActionSchema,
};
