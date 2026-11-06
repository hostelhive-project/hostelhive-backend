const Complaint = require('../models/Complaint');

const complaintRepository = {
  async create(data, session) {
    if (session) return (await Complaint.create([data], { session }))[0];
    return Complaint.create(data);
  },
  findById(id) {
    return Complaint.findById(id)
      .populate('residentId', 'name email phone')
      .populate('assignedStaffId', 'name email')
      .populate('hostelId', 'name location')
      .populate('roomId', 'roomNumber layoutType');
  },
  findByResident(residentId) {
    return Complaint.find({ residentId })
      .populate('assignedStaffId', 'name email')
      .populate('hostelId', 'name location')
      .populate('roomId', 'roomNumber layoutType')
      .sort({ createdAt: -1 });
  },
  findByAssignedStaff(staffId) {
    return Complaint.find({ assignedStaffId: staffId })
      .populate('residentId', 'name email phone')
      .populate('assignedStaffId', 'name email')
      .populate('hostelId', 'name location')
      .populate('roomId', 'roomNumber layoutType')
      .sort({ createdAt: -1 });
  },
  findAll({ status, severityTier, category, hostelId } = {}) {
    const filter = {};
    if (hostelId) filter.hostelId = hostelId;
    if (status) filter.status = status;
    if (severityTier) filter.severityTier = severityTier;
    if (category) filter.category = category;
    return Complaint.find(filter)
      .populate('residentId', 'name email phone')
      .populate('assignedStaffId', 'name email')
      .populate('hostelId', 'name location')
      .populate('roomId', 'roomNumber layoutType')
      .sort({ createdAt: -1 });
  },
  markAwaitingAdminVerification(id, staffId, evidence = {}) {
    const changedAt = new Date();
    const updates = {
      $set: {
        status: 'AwaitingAdminVerification',
        ...(evidence.repairNote !== undefined ? { repairNote: evidence.repairNote || '' } : {}),
        ...(evidence.repairProofImageUrl !== undefined
          ? { repairProofImageUrl: evidence.repairProofImageUrl || null }
          : {}),
      },
      $push: {
        statusHistory: {
          status: 'AwaitingAdminVerification',
          changedBy: staffId,
          changedAt,
        },
      },
    };
    return Complaint.findOneAndUpdate(
      { _id: id, assignedStaffId: staffId, status: 'InReview' },
      updates,
      { new: true, runValidators: true }
    )
      .populate('residentId', 'name email phone')
      .populate('assignedStaffId', 'name email')
      .populate('hostelId', 'name location')
      .populate('roomId', 'roomNumber layoutType');
  },
  confirmResolvedByResident(id, residentId) {
    return Complaint.findOneAndUpdate(
      { _id: id, residentId, status: 'Resolved', residentConfirmedAt: null },
      { $set: { residentConfirmedAt: new Date() } },
      { new: true, runValidators: true }
    )
      .populate('assignedStaffId', 'name email')
      .populate('hostelId', 'name location')
      .populate('roomId', 'roomNumber layoutType');
  },
  reopenByResident(id, residentId) {
    const changedAt = new Date();
    return Complaint.findOneAndUpdate(
      { _id: id, residentId, status: 'Resolved' },
      {
        $set: {
          status: 'InReview',
          residentConfirmedAt: null,
          repairNote: '',
          repairProofImageUrl: null,
        },
        $push: { statusHistory: { status: 'InReview', changedBy: residentId, changedAt } },
      },
      { new: true, runValidators: true }
    )
      .populate('residentId', 'name email phone')
      .populate('assignedStaffId', 'name email')
      .populate('hostelId', 'name location')
      .populate('roomId', 'roomNumber layoutType');
  },
};

module.exports = complaintRepository;

