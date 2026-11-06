const dataRepository = require('../repositories/data.repository');
const unitOfWork = require('../repositories/unitOfWork');
const AppError = require('../utils/AppError');
const bookingRepository = require('../repositories/booking.repository');
const notificationService = require('./notification.service');
const { Room } = require('../repositories/data.repository');
const { Booking } = require('../repositories/data.repository');
const { Hostel } = require('../repositories/data.repository');
const { User } = require('../repositories/data.repository');
const hostelRepository = require('../repositories/hostel.repository');
const { generateNextResidentCodeForHostel } = require('../utils/residentCode');
const { generateUniqueHostelCode } = require('../utils/hostelCode');

/**
 * Implements the corrected booking pipeline (AGENTS.md Deviation #1):
 * Pending -> Approved -> CheckedIn -> CheckedOut, with room allocation happening only
 * on admin approval, not at request time.
 */
const bookingService = {
  async requestBooking({ studentId, roomId, emergencyContact, cnicFrontUrl, cnicBackUrl, termsAcceptedAt }) {
    const uploads = require('./upload.service');
    cnicFrontUrl = await uploads.resolveOwnedDocument(studentId, cnicFrontUrl);
    cnicBackUrl = await uploads.resolveOwnedDocument(studentId, cnicBackUrl);
    return unitOfWork(async (session) => {
      const student = await User.findOneAndUpdate(
        { _id: studentId, role: 'Student', isActive: true, emailVerified: true },
        { $inc: { bookingRevision: 1 } }, { new: true, session }
      );
      if (!student) throw new AppError('An active, verified student account is required.', 403);
      const room = await Room.findOneAndUpdate({ _id: roomId }, { $inc: { bookingRevision: 1 } }, { new: true, session });
      if (!room) throw new AppError('The requested room does not exist.', 404);
      if (!await hostelRepository.findPublicById(room.hostelId)) throw new AppError('This property is not available for booking.', 404);
      if (room.isLocked || room.occupiedCount >= room.capacity) throw new AppError('This room is locked or at full capacity.', 409);
      const existing = await Booking.findOne({ studentId, status: { $in: ['Pending', 'Approved', 'CheckedIn'] } }).session(session);
      if (existing) throw new AppError('You already have a pending, approved or checked-in booking.', 409);
      const hostel = await Hostel.findById(room.hostelId).session(session);
      const [booking] = await Booking.create([{
        studentId, roomId, monthlyRent: room.monthlyRent ?? hostel.priceTier, status: 'Pending',
        emergencyContact, cnicFrontUrl, cnicBackUrl, termsAcceptedAt,
      }], { session });
      return booking;
    });
  },

  async getById(id, user = null) {
    const booking = await bookingRepository.findById(id);
    if (!booking) throw new AppError('Booking not found.', 404);

    if (!user || !['Student', 'Admin'].includes(user.role)) {
      throw new AppError('You do not have permission to view this booking.', 403);
    }

    const studentIdStr = booking.studentId?._id
      ? booking.studentId._id.toString()
      : booking.studentId?.toString();

    if (user.role === 'Student' && studentIdStr !== user.id) {
      throw new AppError('You can only view your own booking details.', 403);
    }

    if (user.role === 'Admin') {
      const room = await Room.findById(booking.roomId);
      if (!user.hostelId || !room || room.hostelId.toString() !== user.hostelId.toString()) {
        throw new AppError('You cannot view bookings outside your assigned hostel.', 403);
      }
    }

    return booking;
  },

  listForStudent(studentId) {
    return bookingRepository.findByStudent(studentId);
  },

  /**
   * Lists Pending bookings for every room belonging to a given hostel —
   * powers the Admin "Room Allocation" screen.
   */
  async listPendingForHostel(hostelId) {
    const rooms = await Room.find({ hostelId }).select('_id');
    return bookingRepository.findPendingForHostelRooms(rooms.map((r) => r._id));
  },

  async listForHostel(hostelId, statusFilter) {
    const rooms = await Room.find({ hostelId }).select('_id');
    return bookingRepository.findByHostelRooms(rooms.map((r) => r._id), statusFilter);
  },

  async listResidentsForHostel(hostelId) {
    const rooms = await Room.find({ hostelId }).select('_id roomNumber layoutType');
    const roomMap = new Map(rooms.map((r) => [r._id.toString(), r]));
    const roomIds = rooms.map((r) => r._id);

    const bookings = await Booking.find({ roomId: { $in: roomIds }, status: 'CheckedIn' })
      .populate('roomId')
      .populate('studentId', 'name email phone residentCode')
      .sort({ updatedAt: -1 });

    return bookings.map((b) => {
      const doc = b.toObject ? b.toObject() : { ...b };
      const room = b.roomId || roomMap.get(b.roomId?.toString() || b.roomId?._id?.toString()) || null;
      const effectiveResidentCode = b.residentCode || b.studentId?.residentCode || null;
      const studentObj = b.studentId
        ? (b.studentId.toObject ? b.studentId.toObject() : { ...b.studentId })
        : null;
      if (studentObj) {
        studentObj.residentCode = effectiveResidentCode;
      }
      return {
        ...doc,
        studentId: studentObj || b.studentId,
        roomId: room,
        // Backwards compatibility alias fields
        student: studentObj || b.studentId,
        room,
        checkInDate: b.checkedInAt || b.updatedAt,
        residentCode: effectiveResidentCode,
      };
    });
  },

  /**
   * Admin approval: atomically increments Room.occupiedCount only if the
   * room still has space (guards the exact race condition TC-ROOM-01
   * describes — two admins approving two different pending requests for
   * the last open slot at the same time). Auto-locks the room once full.
   */
  async approve(bookingId) {
    const booking = await unitOfWork(async (session) => {
      const booking = await Booking.findById(bookingId).session(session);
      if (!booking) throw new AppError('Booking not found', 404);
      if (booking.status !== 'Pending') {
        throw new AppError(`Cannot approve a booking with status "${booking.status}"`, 409);
      }

      const updatedRoom = await Room.findOneAndUpdate(
        { _id: booking.roomId, isLocked: false, $expr: { $lt: ['$occupiedCount', '$capacity'] } },
        [
          {
            $set: {
              occupiedCount: { $add: ['$occupiedCount', 1] },
            },
          },
          {
            $set: {
              isLocked: { $gte: ['$occupiedCount', '$capacity'] },
            },
          },
        ],
        { new: true, session }
      );

      if (!updatedRoom) {
        throw new AppError('Room filled up before this booking could be approved', 409);
      }

      booking.status = 'Approved';
      booking.approvedAt = new Date();
      booking.rejectionReason = null;
      await dataRepository.save(booking, { session });

      return booking;
    });
    await notificationService.notify({
      userId: booking.studentId,
      type: 'BookingUpdate',
      title: 'Booking approved',
      body: 'Your room booking has been approved. You can now check in and pay your first invoice.',
      relatedEntityId: booking._id,
    });

    return booking;
  },

  async reject(bookingId, reason) {
    const booking = await unitOfWork(async (session) => {
      const booking = await Booking.findById(bookingId).session(session);
      if (!booking) throw new AppError('Booking not found', 404);
      if (booking.status !== 'Pending') {
        throw new AppError(`Cannot reject a booking with status "${booking.status}"`, 409);
      }
      booking.status = 'Rejected';
      booking.rejectionReason = reason || 'Rejected by admin';
      await dataRepository.save(booking, { session });

      return booking;
    });
    await notificationService.notify({
      userId: booking.studentId,
      type: 'BookingUpdate',
      title: 'Booking rejected',
      body: `Your room booking request was not approved. Reason: ${booking.rejectionReason}`,
      relatedEntityId: booking._id,
    });

    return booking;
  },

  /**
   * Marks a booking CheckedIn. In the full flow this should only be reachable
   * once the first Invoice/Payment for the booking is settled — enforced at
   * the payment webhook (see payment.service.js), not here, since check-in
   * can also be a manual admin action for cash-paying edge cases.
   */
  async checkIn(bookingId, user = null) {
    const booking = await unitOfWork(async (session) => {
      const booking = await Booking.findById(bookingId).session(session);
      if (!booking) throw new AppError('Booking not found', 404);
      if (booking.status !== 'Approved') {
        throw new AppError('Only an Approved booking can be checked in', 409);
      }

      const room = await Room.findById(booking.roomId).session(session);
      if (!room) {
        throw new AppError('Room not found for this booking', 404);
      }

      if (user) {
        if (user.role !== 'Admin') {
          throw new AppError('Only an admin can check in a resident', 403);
        }
        if (user.hostelId && room.hostelId.toString() !== user.hostelId.toString()) {
          throw new AppError('You cannot check in residents outside your assigned hostel', 403);
        }
      }

      // Resolve hostel and hostelCode
      const hostel = await Hostel.findById(room.hostelId).session(session);
      if (!hostel) {
        throw new AppError('Hostel not found for this booking', 404);
      }
      let hostelCode = hostel.hostelCode;
      if (!hostelCode) {
        hostelCode = await generateUniqueHostelCode(hostel.name, hostel._id);
        hostel.hostelCode = hostelCode;
        await dataRepository.save(hostel, { session });
      }

      // Check if student already has a residentCode for this hostel from a prior booking (e.g. Return to Same Hostel)
      let assignedCode = booking.residentCode;
      if (!assignedCode) {
        const hostelRoomIds = await Room.find({ hostelId: hostel._id }).session(session).distinct('_id');
        const priorBooking = await Booking.findOne({
          studentId: booking.studentId,
          roomId: { $in: hostelRoomIds },
          residentCode: { $exists: true, $ne: null },
        }).session(session).sort({ createdAt: 1 });

        if (priorBooking && priorBooking.residentCode) {
          assignedCode = priorBooking.residentCode;
        } else {
          assignedCode = await generateNextResidentCodeForHostel(hostel._id, hostelCode);
        }
      }

      booking.status = 'CheckedIn';
      booking.checkedInAt = new Date();
      booking.residentCode = assignedCode;
      await dataRepository.save(booking, { session });

      // Mirror to student for current active resident profile
      const student = await User.findById(booking.studentId).session(session);
      if (student) {
        student.residentCode = assignedCode;
        await dataRepository.save(student, { session });
      }

      await booking.populate('roomId');
      await booking.populate('studentId', 'name email phone residentCode');

      return booking;
    });
    await require('./invoice.service').generateForBooking(booking._id).catch((error) => {
      console.error('[booking] Initial invoice will be retried by reconciliation:', error.message);
    });
    return booking;
  },

  async checkOut(bookingId, user = null) {
    const booking = await unitOfWork(async (session) => {
      const booking = await Booking.findById(bookingId).session(session);
      if (!booking) throw new AppError('Booking not found', 404);
      if (booking.status !== 'CheckedIn') {
        throw new AppError('Only a CheckedIn booking can be checked out', 409);
      }

      if (user) {
        if (user.role !== 'Admin') {
          throw new AppError('Only an admin can check out a resident', 403);
        }
        const room = await Room.findById(booking.roomId).session(session);
        if (room && user.hostelId && room.hostelId.toString() !== user.hostelId.toString()) {
          throw new AppError('You cannot check out residents outside your assigned hostel', 403);
        }
      }

      // Atomically decrement Room.occupiedCount and unlock room
      await bookingRepository.releaseRoom(booking.roomId, session);

      booking.status = 'CheckedOut';
      booking.checkedOutAt = new Date();
      await dataRepository.save(booking, { session });

      return booking;
    });
    await notificationService.notify({
      userId: booking.studentId,
      type: 'BookingUpdate',
      title: 'Checkout completed',
      body: 'Your checkout has been successfully processed.',
      relatedEntityId: booking._id,
    });

    return booking;
  },

  async cancelByStudent(bookingId, studentId) {
    const booking = await unitOfWork(async (session) => {
      const booking = await Booking.findById(bookingId).session(session);
      if (!booking) throw new AppError('Booking not found', 404);
      if (booking.studentId.toString() !== studentId) {
        throw new AppError('You can only cancel your own booking', 403);
      }
      if (!['Pending', 'Approved'].includes(booking.status)) {
        throw new AppError(`Cannot cancel a booking with status "${booking.status}"`, 409);
      }

      // If it had already been approved (room slot reserved), release it.
      if (booking.status === 'Approved') {
        await bookingRepository.releaseRoom(booking.roomId, session);
      }

      booking.status = 'Cancelled';
      booking.rejectionReason = 'Cancelled by student';
      await dataRepository.save(booking, { session });

      return booking;
    });
    return booking;
  },

  // Resource loader for hostelScope.middleware — resolves a Booking's hostel via its Room.
  loaderById: async (req) => {
    const booking = await Booking.findById(req.params.id || req.params.bookingId).populate('roomId', 'hostelId');
    if (!booking || !booking.roomId) return null;
    return { hostelId: booking.roomId.hostelId };
  },
};

module.exports = bookingService;
