const { Counter: Counter } = require('../repositories/data.repository');

/**
 * Atomically generates the next permanent HostelHive Resident ID scoped to a specific hostel.
 * Format: <HOSTEL_CODE>-RES-<6_DIGIT_COUNTER> (e.g. "ROY-RES-000001", "T2M-RES-000001")
 * If the counter exceeds 999999, it continues naturally (e.g. "ROY-RES-1000000") without truncation.
 *
 * @param {string|mongoose.Types.ObjectId} hostelId - The unique ID of the hostel
 * @param {string} hostelCode - The uppercase short code of the hostel (e.g. "ROY", "T2M")
 * @returns {Promise<string>} Formatted resident code
 */
async function generateNextResidentCodeForHostel(hostelId, hostelCode) {
  const counterKey = `residentCode:${hostelId.toString()}`;

  const counter = await Counter.findByIdAndUpdate(
    counterKey,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  const seqStr = String(counter.seq);
  const paddedSeq = seqStr.length >= 6 ? seqStr : seqStr.padStart(6, '0');
  const codePrefix = (hostelCode || 'RES').toUpperCase();

  return `${codePrefix}-RES-${paddedSeq}`;
}

/**
 * Fallback global resident code generator.
 * @returns {Promise<string>}
 */
async function generateNextResidentCode() {
  const counter = await Counter.findByIdAndUpdate(
    'residentCode',
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  const seqStr = String(counter.seq);
  const paddedSeq = seqStr.length >= 6 ? seqStr : seqStr.padStart(6, '0');
  return `RES-${paddedSeq}`;
}

module.exports = {
  generateNextResidentCodeForHostel,
  generateNextResidentCode,
};
