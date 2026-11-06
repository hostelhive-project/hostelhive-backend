const AppError = require('../utils/AppError');
const reviewRepository = require('../repositories/review.repository');
const { Booking: Booking } = require('../repositories/data.repository');
const { Room: Room } = require('../repositories/data.repository');
const { Hostel: Hostel } = require('../repositories/data.repository');

const reviewService = {
  /**
   * Requires the reviewer to have an actual (or past) CheckedIn booking at
   * this hostel — prevents drive-by reviews, matches the "Resident" framing
   * in the SRS stakeholder table (Table 2: reviews are a resident benefit).
   */
  async create({ hostelId, rating, comment }, residentId) {
    const existing = await reviewRepository.findOneByResidentAndHostel(residentId, hostelId);
    if (existing) throw new AppError('You have already reviewed this hostel', 409);

    const roomsInHostel = await Room.find({ hostelId }).select('_id');
    const roomIds = roomsInHostel.map((r) => r._id);
    const hasStayed = await Booking.exists({
      studentId: residentId,
      roomId: { $in: roomIds },
      status: { $in: ['CheckedIn', 'CheckedOut'] },
    });
    if (!hasStayed) {
      throw new AppError('You can only review a hostel you have stayed at', 403);
    }

    const review = await reviewRepository.create({ hostelId, residentId, rating, comment });
    await reviewService.recalculateHostelRating(hostelId);
    return review;
  },

  listForHostel(hostelId) {
    return reviewRepository.findByHostel(hostelId);
  },

  async recalculateHostelRating(hostelId) {
    const [agg] = await reviewRepository.aggregateRatingForHostel(hostelId);
    await Hostel.findByIdAndUpdate(hostelId, {
      ratingAvg: agg ? Math.round(agg.avgRating * 10) / 10 : 0,
      reviewCount: agg ? agg.count : 0,
    });
  },
};

module.exports = reviewService;
