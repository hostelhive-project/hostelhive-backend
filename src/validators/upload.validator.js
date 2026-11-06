const Joi = require('joi');
module.exports = { uploadMetadataSchema: Joi.object({
  folder: Joi.string().valid('/hostels', '/profiles', '/cnic', '/complaints', '/cleaning').default('/hostels'),
}) };
