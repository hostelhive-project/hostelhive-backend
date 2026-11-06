/**
 * Generates a unique, short, human-readable uppercase code from a hostel name.
 * Examples:
 * - "Royal Residency" -> "ROY"
 * - "T2M Smart Hostel" -> "T2M"
 * - "Laf Hostel" -> "LAF"
 *
 * Deterministic collision-safe strategy:
 * If "ROY" already exists for another hostel, generates "ROY2", "ROY3", etc.
 *
 * @param {string} name - Name of the hostel
 * @param {string|mongoose.Types.ObjectId} [existingId=null] - Current hostel ID (excluded from collision check on updates)
 * @returns {Promise<string>} Unique uppercase hostel code
 */
async function generateUniqueHostelCode(name, existingId = null) {
  const clean = (name || '').trim();
  const words = clean.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(Boolean);

  let base = '';
  if (words.length > 0 && words[0].length >= 3) {
    base = words[0].slice(0, 3).toUpperCase();
  } else if (words.length > 0) {
    base = words.join('').slice(0, 3).toUpperCase();
  }

  // Fallback if base is less than 3 chars
  if (base.length < 3) {
    base = (base + 'HST').slice(0, 3).toUpperCase();
  }

  // Ensure uppercase alphanumeric
  base = base.replace(/[^A-Z0-9]/g, '');

  let code = base;
  let counter = 2;
  // Lazy loading avoids the Hostel schema validation hook's initialization cycle.
  const { Hostel } = require('../repositories/data.repository');

  // Collision safety loop
  for (;;) {
    const conflict = await Hostel.findOne({
      hostelCode: code,
      ...(existingId ? { _id: { $ne: existingId } } : {}),
    }).select('_id');

    if (!conflict) {
      break;
    }
    code = `${base}${counter}`;
    counter++;
  }

  return code;
}

module.exports = {
  generateUniqueHostelCode,
};

