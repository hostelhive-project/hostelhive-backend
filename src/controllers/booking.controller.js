const catchAsync = require('../utils/catchAsync');
const { success } = require('../utils/response');
const bookingService = require('../services/booking.service');

const bookingController = {
  create: catchAsync(async (req, res) => {
    const booking = await bookingService.requestBooking({ ...req.body, studentId: req.user.id });
    return success(res, 201, booking, 'Booking request submitted');
  }),

  getById: catchAsync(async (req, res) => {
    const booking = await bookingService.getById(req.params.id, req.user);
    return success(res, 200, booking);
  }),

  myBookings: catchAsync(async (req, res) => {
    const bookings = await bookingService.listForStudent(req.user.id);
    return success(res, 200, bookings);
  }),

  pendingForHostel: catchAsync(async (req, res) => {
    const bookings = await bookingService.listPendingForHostel(req.params.hostelId);
    return success(res, 200, bookings);
  }),

  listForHostel: catchAsync(async (req, res) => {
    const bookings = await bookingService.listForHostel(req.params.hostelId, req.query.status);
    return success(res, 200, bookings);
  }),

  residentsForHostel: catchAsync(async (req, res) => {
    const residents = await bookingService.listResidentsForHostel(req.params.hostelId);
    return success(res, 200, residents);
  }),

  approve: catchAsync(async (req, res) => {
    const booking = await bookingService.approve(req.params.id);
    return success(res, 200, booking, 'Booking approved and room allocated');
  }),

  reject: catchAsync(async (req, res) => {
    const booking = await bookingService.reject(req.params.id, req.body.reason);
    return success(res, 200, booking, 'Booking rejected');
  }),

  checkIn: catchAsync(async (req, res) => {
    const booking = await bookingService.checkIn(req.params.id, req.user);
    return success(res, 200, booking, 'Resident checked in');
  }),

  cancel: catchAsync(async (req, res) => {
    const booking = await bookingService.cancelByStudent(req.params.id, req.user.id);
    return success(res, 200, booking, 'Booking cancelled');
  }),

  checkOut: catchAsync(async (req, res) => {
    const booking = await bookingService.checkOut(req.params.id, req.user);
    return success(res, 200, booking, 'Resident checked out');
  }),
};

module.exports = bookingController;
