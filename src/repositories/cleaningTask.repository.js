const CleaningTask = require('../models/CleaningTask');

const cleaningTaskRepository = {
  async create(data, session) {
    if (session) return (await CleaningTask.create([data], { session }))[0];
    return CleaningTask.create(data);
  },
  findById(id) {
    return CleaningTask.findById(id).populate('roomId').populate('assignedStaffId', 'name email');
  },
  findByStaff(staffId, statusFilter) {
    const filter = { assignedStaffId: staffId };
    if (statusFilter) filter.status = statusFilter;
    return CleaningTask.find(filter)
      .populate('roomId', 'roomNumber floor layoutType')
      .sort({ scheduledTime: 1 });
  },
  findByRoomIds(roomIds, statusFilter) {
    const filter = { roomId: { $in: roomIds } };
    if (statusFilter) filter.status = statusFilter;
    return CleaningTask.find(filter)
      .populate('roomId', 'roomNumber layoutType')
      .populate('assignedStaffId', 'name email phone')
      .sort({ scheduledTime: -1 });
  },
};

module.exports = cleaningTaskRepository;
