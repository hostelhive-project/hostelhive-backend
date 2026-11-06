const Booking = require('../models/Booking');

const bookingRepository = {
  async releaseRoom(roomId, session) {
    const Room = require('../models/Room');
    const room = await Room.findOneAndUpdate({ _id: roomId, occupiedCount: { $gt: 0 } }, [
      { $set: { manuallyLocked: { $ifNull: ['$manuallyLocked', { $and: ['$isLocked', { $lt: ['$occupiedCount', '$capacity'] }] }] }, occupiedCount: { $subtract: ['$occupiedCount', 1] } } },
      { $set: { isLocked: { $or: ['$manuallyLocked', { $gte: ['$occupiedCount', '$capacity'] }] } } },
    ], { new: true, session });
    if (!room) throw new (require('../utils/AppError'))('Room occupancy is inconsistent. Ask the administrator to reconcile it.', 409);
    return room;
  },
  findById(id) {
    return Booking.findById(id).populate('roomId').populate('studentId', 'name email phone residentCode');
  },
  findByStudent(studentId) {
    return Booking.find({ studentId }).populate('roomId').sort({ createdAt: -1 });
  },
  findPendingForHostelRooms(roomIds) {
    return Booking.find({ roomId: { $in: roomIds }, status: 'Pending' })
      .populate('roomId')
      .populate('studentId', 'name email phone residentCode')
      .sort({ createdAt: 1 });
  },
  findByHostelRooms(roomIds, statusFilter) {
    const filter = { roomId: { $in: roomIds } };
    if (statusFilter) filter.status = statusFilter;
    return Booking.find(filter)
      .populate('roomId')
      .populate('studentId', 'name email phone residentCode')
      .sort({ createdAt: -1 });
  },
};

module.exports = bookingRepository;
