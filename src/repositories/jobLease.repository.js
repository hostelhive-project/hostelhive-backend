const JobLease = require('../models/JobLease');
module.exports = {
  async claim(name, owner) {
    try {
      return await JobLease.findOneAndUpdate({ _id: name, $or: [{ expiresAt: { $lte: new Date() } }, { owner }] },
        { $set: { owner, expiresAt: new Date(Date.now() + 60000) } }, { upsert: true, new: true });
    } catch (error) { if (error.code === 11000) return null; throw error; }
  },
  renew: (name, owner) => JobLease.updateOne({ _id: name, owner }, { $set: { expiresAt: new Date(Date.now() + 60000) } }),
  release: (name, owner) => JobLease.deleteOne({ _id: name, owner }),
};
