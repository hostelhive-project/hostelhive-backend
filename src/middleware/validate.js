const AppError = require('../utils/AppError');

/**
 * Validates request data (body, query, or params) against a Joi schema.
 * Formats field-level errors and human-readable messages without raw quotes.
 */
function validate(schema, source = 'body') {
  return function validateRequest(req, res, next) {
    const targetData = req[source] || {};
    const { error, value } = schema.validate(targetData, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const fieldErrors = {};
      const cleanDetails = [];

      for (const item of error.details) {
        const field = item.path.join('.') || 'field';
        // Strip escaped or raw double quotes: '"password" length must...' -> 'Password length must...'
        let cleanMsg = item.message.replace(/["']/g, '');
        // Capitalize the first letter
        cleanMsg = cleanMsg.charAt(0).toUpperCase() + cleanMsg.slice(1);

        if (!fieldErrors[field]) {
          fieldErrors[field] = cleanMsg;
        }
        cleanDetails.push(cleanMsg);
      }

      const primaryMessage = cleanDetails[0] || 'Validation failed. Please check your input.';
      const appError = new AppError(primaryMessage, 400, cleanDetails);
      appError.errors = fieldErrors;
      return next(appError);
    }

    req[source] = value;
    return next();
  };
}

module.exports = validate;

