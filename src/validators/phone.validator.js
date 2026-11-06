const { parsePhoneNumberFromString } = require('libphonenumber-js');

/**
 * Validates whether a phone number is valid according to international format rules.
 * Defaults to 'PK' (Pakistan) unless input starts with '+' or specifies country.
 */
function isValidPhone(value, defaultCountry = 'PK') {
  if (!value) return false;
  const str = String(value).trim();
  if (!str) return false;
  try {
    const parsed = parsePhoneNumberFromString(str, defaultCountry);
    return !!(parsed && parsed.isValid());
  } catch {
    return false;
  }
}

/**
 * Normalizes a phone number to standard E.164 format (+923012345678).
 */
function normalizePhoneToE164(value, defaultCountry = 'PK') {
  if (!value) return value;
  const str = String(value).trim();
  if (!str) return '';
  try {
    const parsed = parsePhoneNumberFromString(str, defaultCountry);
    if (parsed && parsed.isValid()) {
      return parsed.number;
    }
  } catch {
    // fallback
  }
  return value;
}

/**
 * Joi custom validator rule for phone numbers.
 * Validates using libphonenumber-js and normalizes the validated value to E.164.
 */
const phoneJoiRule = (value, helpers) => {
  if (value === null || value === undefined || value === '') {
    return value;
  }
  const str = String(value).trim();
  if (!str) return '';
  try {
    const parsed = parsePhoneNumberFromString(str, 'PK');
    if (!parsed || !parsed.isValid()) {
      return helpers.error('any.invalid');
    }
    return parsed.number; // Returns normalized E.164
  } catch {
    return helpers.error('any.invalid');
  }
};

module.exports = {
  isValidPhone,
  normalizePhoneToE164,
  phoneJoiRule,
};

