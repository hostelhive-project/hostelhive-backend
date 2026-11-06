const Joi = require('joi');
const { phoneJoiRule } = require('./phone.validator');

const propertyInfoSchema = Joi.object({
  gateOpenTime: Joi.string()
    .pattern(/^([01]\d|2[0-3]):[0-5]\d$/)
    .allow('', null)
    .messages({ 'string.pattern.base': 'gateOpenTime must be in HH:mm format (e.g. 06:00)' }),
  gateCloseTime: Joi.string()
    .pattern(/^([01]\d|2[0-3]):[0-5]\d$/)
    .allow('', null)
    .messages({ 'string.pattern.base': 'gateCloseTime must be in HH:mm format (e.g. 23:00)' }),
  houseRules: Joi.array().items(Joi.string().trim().max(300)).default([]),
  receptionContact: Joi.string()
    .trim()
    .custom(phoneJoiRule, 'Phone number validation')
    .allow('', null)
    .messages({
      'any.invalid': 'receptionContact must be a valid phone number (e.g. +92 300 1234567)',
    }),
  nearbyLandmarks: Joi.string().max(500).allow('', null),
});

const createHostelSchema = Joi.object({
  publicationStatus: Joi.string().valid('Draft', 'Published'),
  name: Joi.string().min(2).max(150).required(),
  location: Joi.string().min(2).max(200).required(),
  priceTier: Joi.number().min(0).required(),
  facilities: Joi.array().items(Joi.string()).default([]),
  bannerImage: Joi.string().uri().allow('', null).default(''),
  images: Joi.array()
    .items(Joi.string().uri())
    .max(5)
    .default([])
    .messages({
      'array.max': 'images cannot contain more than 5 images',
    }),
  propertyInfo: propertyInfoSchema.optional(),
});

const updateHostelSchema = createHostelSchema.keys({ publicationStatus: Joi.forbidden() }).fork(
  ['name', 'location', 'priceTier'],
  (s) => s.optional()
).min(1);

const createRoomSchema = Joi.object({
  roomNumber: Joi.string().required(),
  layoutType: Joi.string().valid('Single', 'Shared-2', 'Shared-4').required(),
  capacity: Joi.number().integer().min(1).required(),
  monthlyRent: Joi.number().min(0).optional().allow(null),
});

const updateRoomSchema = Joi.object({
  roomNumber: Joi.string(),
  layoutType: Joi.string().valid('Single', 'Shared-2', 'Shared-4'),
  capacity: Joi.number().integer().min(1),
  monthlyRent: Joi.number().min(0).optional().allow(null),
}).min(1);

const roomStatusSchema = Joi.object({
  isLocked: Joi.boolean(),
  occupiedCount: Joi.forbidden(),
  uiColorTag: Joi.string(),
}).min(1);

const chatbotInfoSchema = Joi.object({
  wifiPassword: Joi.string().max(100).allow('', null),
  emergencyContact: Joi.string()
    .trim()
    .custom(phoneJoiRule, 'Phone number validation')
    .allow('', null)
    .messages({
      'any.invalid': 'emergencyContact must be a valid phone number (e.g. +92 300 1234567)',
    }),
  additionalInfo: Joi.string().max(2000).allow('', null),
  // Legacy fields preserved for backward compatibility
  checkInTime: Joi.string().max(30).allow('', null),
  checkOutTime: Joi.string().max(30).allow('', null),
  rules: Joi.array().items(Joi.string().max(300)),
  contactNumber: Joi.string()
    .trim()
    .custom(phoneJoiRule, 'Phone number validation')
    .allow('', null)
    .messages({
      'any.invalid': 'contactNumber must be a valid phone number (e.g. +92 300 1234567)',
    }),
  nearbyLandmarks: Joi.string().max(500).allow('', null),
});

const exploreHostelsQuerySchema = Joi.object({
  q: Joi.string().trim().max(100).allow(''),
  location: Joi.string().trim().max(200).allow(''),
  maxPrice: Joi.number().min(0),
  facilities: Joi.alternatives().try(
    Joi.array().items(Joi.string().trim().max(100)).max(20),
    Joi.string().trim().max(1000)
  ),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(30).default(12),
  sort: Joi.string().valid('rating', 'price-asc', 'price-desc').default('rating'),
});

const roomCatalogParamsSchema = Joi.object({
  id: Joi.string().hex().length(24).required(),
});
const publishHostelSchema = Joi.object({});

const roomOptionsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(30).default(10),
  layoutType: Joi.string().valid('Single', 'Shared-2', 'Shared-4'),
  available: Joi.boolean().default(false),
  q: Joi.string().trim().max(100).allow(''),
  sort: Joi.string().valid('room-number', 'rent-asc', 'rent-desc').default('room-number'),
});

module.exports = {
  publishHostelSchema,
  roomCatalogParamsSchema,
  roomOptionsQuerySchema,
  createHostelSchema,
  updateHostelSchema,
  createRoomSchema,
  updateRoomSchema,
  roomStatusSchema,
  chatbotInfoSchema,
  exploreHostelsQuerySchema,
};
