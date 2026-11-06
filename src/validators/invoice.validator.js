const Joi = require('joi');

const generateInvoiceSchema = Joi.object({
  messFeeAmount: Joi.any().strip(),
  billingMonth: Joi.string()
    .pattern(/^\d{4}-(0[1-9]|1[0-2])$/)
    .messages({
      'string.pattern.base': 'billingMonth must use the YYYY-MM format.',
    }),
}).unknown(false);

const offlinePaymentSchema = Joi.object({ paymentMethod: Joi.string().valid('Cash', 'BankTransfer', 'JazzCash', 'EasyPaisa').default('Cash') });
module.exports = { generateInvoiceSchema, offlinePaymentSchema };
