const Joi = require('joi');

const checkoutSchema = Joi.object({
  invoiceId: Joi.string().hex().length(24).required(),
});

module.exports = { checkoutSchema };
