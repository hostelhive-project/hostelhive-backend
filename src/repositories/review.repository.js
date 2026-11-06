const mongoose = require('mongoose');
const Review = require('../models/Review');

const reviewRepository = {
  create(data) {
    return Review.create(data);
  },
  findByHostel(hostelId) {
    return Review.find({ hostelId }).populate('residentId', 'name').sort({ createdAt: -1 });
  },
  findOneByResidentAndHostel(residentId, hostelId) {
    return Review.findOne({ residentId, hostelId });
  },
  aggregateRatingForHostel(hostelId) {
    const targetHostelId = typeof hostelId === 'string' && mongoose.Types.ObjectId.isValid(hostelId)
      ? new mongoose.Types.ObjectId(hostelId)
      : hostelId;

    return Review.aggregate([
      { $match: { hostelId: targetHostelId } },
      { $group: { _id: '$hostelId', avgRating: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);
  },
};

module.exports = reviewRepository;

