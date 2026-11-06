const User = require('../models/User');

const userRepository = {
  create(data) {
    return User.create(data);
  },
  findByEmail(email, { withPassword = false, withOtp = false } = {}) {
    const query = User.findOne({ email: email.trim().toLowerCase() }).select('+sessionVersion');
    if (withPassword) query.select('+passwordHash');
    if (withOtp) {
      query.select('+emailOtpPurpose +emailOtpHash +emailOtpExpiresAt +emailOtpSentAt +emailOtpAttempts');
    }
    return query;
  },
  findById(id, { withPassword = false } = {}) {
    const query = User.findById(id).select('+sessionVersion');
    if (withPassword) query.select('+passwordHash');
    return query;
  },
  updateById(id, updates) {
    return User.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
  },
  replacePendingSignup(email, data) {
    return User.findOneAndUpdate(
      { email, emailVerified: false, role: { $in: ['Student', 'Admin'] } },
      { $set: data }, { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).select('+sessionVersion +emailOtpHash +emailOtpPurpose +emailOtpExpiresAt +emailOtpAttempts');
  },
  setOtp(id, updates, cutoff = null) {
    return User.findOneAndUpdate({ _id: id, ...(cutoff ? {
      $or: [{ emailOtpSentAt: { $lte: cutoff } }, { emailOtpSentAt: null }],
    } : {}) }, { $set: updates }, { new: true, runValidators: true });
  },
  clearOtpIfCurrent(id, hash) {
    return User.updateOne({ _id: id, emailOtpHash: hash }, { $unset: {
      emailOtpHash: '', emailOtpPurpose: '', emailOtpExpiresAt: '', emailOtpSentAt: '',
    }, $set: { emailOtpAttempts: 0 } });
  },
  recordOtpFailure(id, hash) {
    return User.updateOne({ _id: id, emailOtpHash: hash, emailOtpAttempts: { $lt: 5 } }, { $inc: { emailOtpAttempts: 1 } });
  },
  consumeOtp(user, purpose, updates, revoke = false) {
    return User.findOneAndUpdate({ _id: user._id, emailOtpHash: user.emailOtpHash,
      emailOtpPurpose: purpose, emailOtpExpiresAt: { $gt: new Date() }, emailOtpAttempts: { $lt: 5 },
    }, { $set: { ...updates, emailOtpAttempts: 0 }, $unset: {
      emailOtpHash: '', emailOtpPurpose: '', emailOtpExpiresAt: '', emailOtpSentAt: '',
    }, ...(revoke ? { $inc: { sessionVersion: 1 } } : {}) }, { new: true, runValidators: true }).select('+sessionVersion');
  },
  revokeSessions(id) {
    return User.findByIdAndUpdate(id, { $inc: { sessionVersion: 1 }, $set: { deviceToken: null } }, { new: true });
  },
  replacePassword(id, expectedHash, passwordHash) {
    return User.findOneAndUpdate({ _id: id, passwordHash: expectedHash }, {
      $set: { passwordHash }, $inc: { sessionVersion: 1 },
      $unset: { emailOtpHash: '', emailOtpPurpose: '', emailOtpExpiresAt: '', emailOtpSentAt: '' },
    }, { new: true });
  },
  findPendingStaffInviteByIdInHostel(id, hostelId) {
    return User.findOne({
      _id: id,
      hostelId,
      role: 'CleaningStaff',
      isActive: false,
      emailVerified: false,
    });
  },
  deletePendingStaffInvite(id, hostelId) {
    return User.deleteOne({
      _id: id,
      ...(hostelId ? { hostelId } : {}),
      role: 'CleaningStaff',
      isActive: false,
      emailVerified: false,
    });
  },
  findActiveStaffByIdInHostel(id, hostelId) {
    return User.findOne({ _id: id, hostelId, role: 'CleaningStaff', isActive: true });
  },
  findActiveAdminsByHostel(hostelId, ownerAdminId = null) {
    const hostelFilters = [{ hostelId }];
    if (ownerAdminId) hostelFilters.push({ _id: ownerAdminId });
    return User.find({ role: 'Admin', isActive: true, $or: hostelFilters }).select('_id');
  },
  updateActiveStaffByIdInHostel(id, hostelId, updates) {
    return User.findOneAndUpdate(
      { _id: id, hostelId, role: 'CleaningStaff', isActive: true },
      updates,
      { new: true, runValidators: true }
    );
  },
};

module.exports = userRepository;
