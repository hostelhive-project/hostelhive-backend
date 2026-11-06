const catchAsync = require('../utils/catchAsync');
const { success } = require('../utils/response');
const reviewService = require('../services/review.service');
const hostelService = require('../services/hostel.service');

const reviewController = {
  create: catchAsync(async (req, res) => {
    const review = await reviewService.create({ ...req.body, hostelId: req.params.hostelId }, req.user.id);
    return success(res, 201, review, 'Review submitted');
  }),

  listForHostel: catchAsync(async (req, res) => {
    await hostelService.getPublicById(req.params.hostelId);
    const reviews = await reviewService.listForHostel(req.params.hostelId);
    return success(res, 200, reviews);
  }),
};

module.exports = reviewController;
