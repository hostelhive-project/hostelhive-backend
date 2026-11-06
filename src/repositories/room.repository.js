const Room = require('../models/Room');
const { Types } = require('mongoose');

// Browse availability is a snapshot; booking approval still enforces capacity atomically.
const availableExpression = { $and: [
  { $eq: ['$isLocked', false] },
  { $lt: ['$occupiedCount', '$capacity'] },
] };

function catalogStages(hostelId, fallbackRent) {
  return [
    { $match: { hostelId: new Types.ObjectId(hostelId) } },
    { $addFields: {
      effectiveRent: { $ifNull: ['$monthlyRent', fallbackRent] },
      isAvailable: availableExpression,
    } },
  ];
}

const roomRepository = {
  findById(id) {
    return Room.findById(id);
  },
  findByHostel(hostelId, { availableOnly = false } = {}) {
    const filter = { hostelId };
    if (availableOnly) {
      filter.isLocked = false;
      filter.$expr = { $lt: ['$occupiedCount', '$capacity'] };
    }
    return Room.find(filter);
  },
  roomCatalog(hostelId, fallbackRent) {
    return Room.aggregate([
      ...catalogStages(hostelId, fallbackRent),
      { $group: {
        _id: '$layoutType',
        totalRooms: { $sum: 1 },
        availableRooms: { $sum: { $cond: ['$isAvailable', 1, 0] } },
        availableBeds: { $sum: { $cond: ['$isAvailable', { $subtract: ['$capacity', '$occupiedCount'] }, 0] } },
        startingRent: { $min: { $cond: ['$isAvailable', '$effectiveRent', null] } },
      } },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, layoutType: '$_id', totalRooms: 1, availableRooms: 1, availableBeds: 1, startingRent: 1 } },
    ]);
  },
  async roomOptions(hostelId, fallbackRent, { page, limit, layoutType, available, q, sort }) {
    const filter = {};
    if (layoutType) filter.layoutType = layoutType;
    if (available) filter.isAvailable = true;
    if (q) filter.roomNumber = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const sorts = {
      'room-number': { roomNumber: 1, _id: 1 },
      'rent-asc': { effectiveRent: 1, roomNumber: 1, _id: 1 },
      'rent-desc': { effectiveRent: -1, roomNumber: 1, _id: 1 },
    };
    const [result] = await Room.aggregate([
      ...catalogStages(hostelId, fallbackRent),
      { $match: filter },
      { $facet: {
        items: [{ $sort: sorts[sort] }, { $skip: (page - 1) * limit }, { $limit: limit }],
        count: [{ $count: 'total' }],
      } },
    ]);
    const total = result.count[0]?.total || 0;
    return { items: result.items, page, limit, total, totalPages: Math.ceil(total / limit), hasMore: page * limit < total };
  },
  updateById(id, updates) {
    if (updates.capacity !== undefined) {
      // Keep the capacity invariant atomic with concurrent booking approvals,
      // which increment occupiedCount directly in MongoDB.
      return Room.findOneAndUpdate(
        { _id: id, $expr: { $lte: ['$occupiedCount', updates.capacity] } },
        { $set: updates },
        { new: true, runValidators: true }
      );
    }
    return Room.findByIdAndUpdate(id, { $set: updates }, { new: true, runValidators: true });
  },
};

module.exports = roomRepository;
