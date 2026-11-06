const unitOfWork = require('../repositories/unitOfWork');
const { CleaningTask, Complaint } = require('../repositories/data.repository');
const AppError = require('../utils/AppError');
const roomRepository = require('../repositories/room.repository');
const { Room: Room } = require('../repositories/data.repository');
const { Booking: Booking } = require('../repositories/data.repository');
const hostelRepository = require('../repositories/hostel.repository');

const roomService = {
  async create(data) {
    return unitOfWork(async (session) => {
      const { Hostel } = require('../repositories/data.repository');
      if (!await Hostel.findOneAndUpdate({ _id: data.hostelId }, { $inc: { resourceRevision: 1 } }, { new: true, session })) throw new AppError('Hostel not found', 404);
      if (await Room.exists({ hostelId: data.hostelId, roomNumber: data.roomNumber.trim() }).session(session)) throw new AppError('This room number already exists in this hostel.', 409);
      return (await Room.create([data], { session }))[0];
    });
  },

  listByHostel(hostelId, opts) {
    return roomRepository.findByHostel(hostelId, opts);
  },

  async getCatalog(hostelId) {
    const hostel = await hostelRepository.findPublicById(hostelId);
    if (!hostel) throw new AppError('Hostel not found', 404);
    const types = await roomRepository.roomCatalog(hostelId, hostel.priceTier);
    types.sort((a, b) => Room.LAYOUT_TYPES.indexOf(a.layoutType) - Room.LAYOUT_TYPES.indexOf(b.layoutType));
    const rents = types.map((type) => type.startingRent).filter((rent) => rent !== null);
    return {
      summary: {
        totalRooms: types.reduce((total, type) => total + type.totalRooms, 0),
        availableRooms: types.reduce((total, type) => total + type.availableRooms, 0),
        availableBeds: types.reduce((total, type) => total + type.availableBeds, 0),
        startingRent: rents.length ? Math.min(...rents) : null,
      },
      types,
    };
  },

  async getOptions(hostelId, options) {
    const hostel = await hostelRepository.findPublicById(hostelId);
    if (!hostel) throw new AppError('Hostel not found', 404);
    return roomRepository.roomOptions(hostelId, hostel.priceTier, options);
  },

  async getById(id) {
    const room = await roomRepository.findById(id);
    if (!room) throw new AppError('Room not found', 404);
    if (!await hostelRepository.findPublicById(room.hostelId)) throw new AppError('Room not found', 404);
    return room;
  },

  async update(id, updates) {
    if (updates.capacity !== undefined) {
      const current = await roomRepository.findById(id);
      if (!current) throw new AppError('Room not found', 404);
      if (updates.capacity < current.occupiedCount) {
        throw new AppError('Room capacity cannot be lower than its current occupied count.', 409);
      }
    }
    if (updates.roomNumber) {
      const current = await roomRepository.findById(id);
      if (current) {
        const conflict = await Room.findOne({
          _id: { $ne: id },
          hostelId: current.hostelId,
          roomNumber: updates.roomNumber.trim(),
        });
        if (conflict) {
          throw new AppError(`Room "${updates.roomNumber}" already exists in this hostel.`, 409);
        }
      }
    }
    const room = await roomRepository.updateById(id, updates);
    if (!room) {
      const current = await roomRepository.findById(id);
      if (!current) throw new AppError('Room not found', 404);
      if (updates.capacity !== undefined && updates.capacity < current.occupiedCount) {
        throw new AppError('Room capacity cannot be lower than its current occupied count.', 409);
      }
      throw new AppError('Room could not be updated.', 409);
    }
    return room;
  },

  async updateStatus(id, { isLocked, uiColorTag }) {
    const patch = {};
    if (isLocked !== undefined) { patch.isLocked = isLocked; patch.manuallyLocked = isLocked; }
    if (uiColorTag !== undefined) patch.uiColorTag = uiColorTag;
    const room = await roomRepository.updateById(id, patch);
    if (!room) throw new AppError('Room not found', 404);
    return room;
  },

  async remove(id) {
    return unitOfWork(async (session) => {
      const room = await Room.findById(id).session(session);
      if (!room) throw new AppError('Room not found', 404);
      if (room.occupiedCount > 0 || await Booking.exists({ roomId: id }).session(session) ||
          await CleaningTask.exists({ roomId: id }).session(session) || await Complaint.exists({ roomId: id }).session(session)) {
        throw new AppError('This room has resident, billing or work history and cannot be deleted.', 409);
      }
      return Room.findByIdAndDelete(id, { session });
    });
  },

  loaderById: (req) => roomRepository.findById(req.params.id),
};

module.exports = roomService;

