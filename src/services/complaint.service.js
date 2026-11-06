const dataRepository = require('../repositories/data.repository');
const AppError = require('../utils/AppError');
const complaintRepository = require('../repositories/complaint.repository');
const userRepository = require('../repositories/user.repository');
const audit = require('./blockchain.service');
const unitOfWork = require('../repositories/unitOfWork');
const notificationService = require('./notification.service');
const { Complaint } = require('../repositories/data.repository');
const { Booking } = require('../repositories/data.repository');
const { Room } = require('../repositories/data.repository');
const { Hostel } = require('../repositories/data.repository');
const { User } = require('../repositories/data.repository');

/**
 * Resolves the authenticated admin's hostel ID.
 * Returns the cached req.user.hostelId if set, or finds the hostel owned by the admin
 * (and auto-syncs User.hostelId so subsequent calls are fast).
 */
async function getAdminHostelId(user) {
  if (!user) return null;
  if (user.hostelId) return user.hostelId.toString();

  const userId = user.id || user._id;
  const ownedHostel = await Hostel.findOne({ ownerAdminId: userId });
  if (ownedHostel) {
    const hId = ownedHostel._id.toString();
    user.hostelId = hId;
    await User.findByIdAndUpdate(userId, { hostelId: ownedHostel._id }).catch(() => {});
    return hId;
  }
  return null;
}

const complaintService = {
  async create(data, residentId) {
    const activeBooking = await Booking.findOne({
      studentId: residentId,
      status: 'CheckedIn',
    }).sort({ createdAt: -1 });

    if (!activeBooking) {
      throw new AppError('Only checked-in residents can file complaints.', 403);
    }

    const room = await Room.findById(activeBooking.roomId);
    if (!room || !room.hostelId) {
      throw new AppError('Hostel room association not found for your booking.', 404);
    }

    const derivedHostelId = room.hostelId;

    if (data.hostelId && data.hostelId.toString() !== derivedHostelId.toString()) {
      throw new AppError('You can only submit complaints for your assigned hostel.', 403);
    }

    const complaintData = {
      residentId,
      hostelId: derivedHostelId,
      roomId: room._id,
      roomNumberAtSubmission: room.roomNumber,
      title: data.title ? data.title.trim() : '',
      category: data.category ? data.category.trim() : 'GENERAL',
      description: data.description ? data.description.trim() : '',
      photoUrls: data.photoUrls || [],
      severityTier: data.severityTier,
      status: 'Submitted',
      statusHistory: [{ status: 'Submitted', changedBy: residentId, changedAt: new Date() }],
    };

    return unitOfWork(async (session) => {
      const complaint = await complaintRepository.create(complaintData, session);
      if (complaint.severityTier === 'Critical') await audit.enqueue('Complaint', complaint, session);
      return complaint;
    });
  },

  async getById(id, user = null) {
    const complaint = await complaintRepository.findById(id);
    if (!complaint) throw new AppError('Complaint not found', 404);

    if (user) {
      const resIdStr = complaint.residentId?._id
        ? complaint.residentId._id.toString()
        : complaint.residentId?.toString();

      if (user.role === 'Student' && resIdStr !== user.id) {
        throw new AppError('You can only view your own complaints', 403);
      }

      const complaintHostelIdStr = complaint.hostelId?._id
        ? complaint.hostelId._id.toString()
        : complaint.hostelId?.toString();

      if (user.role === 'CleaningStaff') {
        const staffIdStr = user.id;
        const assignedStr = complaint.assignedStaffId?._id?.toString() || complaint.assignedStaffId?.toString();
        if (assignedStr !== staffIdStr || complaintHostelIdStr !== user.hostelId) {
          throw new AppError('You can only view complaints assigned to you in your hostel', 403);
        }
      }

      if (user.role === 'Admin') {
        const adminHostelId = await getAdminHostelId(user);
        if (!adminHostelId || !complaintHostelIdStr || complaintHostelIdStr !== adminHostelId) {
          throw new AppError('You cannot view complaints from another hostel', 403);
        }
      }
    }

    return complaint;
  },

  listForResident(residentId) {
    return complaintRepository.findByResident(residentId);
  },

  listAssignedToStaff(staffId) {
    return complaintRepository.findByAssignedStaff(staffId);
  },

  async markFixed(id, staffId, evidence = {}) {
    const complaint = await complaintRepository.findById(id);
    if (!complaint) throw new AppError('Complaint not found', 404);

    const assignedStaffId = complaint.assignedStaffId?._id || complaint.assignedStaffId;
    if (assignedStaffId?.toString() !== staffId.toString()) {
      throw new AppError('You can only submit complaints assigned to you for verification.', 403);
    }
    if (complaint.status !== 'InReview') {
      throw new AppError('Only complaints in review can be submitted for admin verification.', 409);
    }

    const updatedComplaint = await complaintRepository.markAwaitingAdminVerification(id, staffId, evidence);
    if (!updatedComplaint) {
      throw new AppError('The complaint status changed. Refresh it and try again.', 409);
    }

    const hostelId = complaint.hostelId?._id || complaint.hostelId;
    const hostel = hostelId ? await Hostel.findById(hostelId).select('ownerAdminId') : null;
    const admins = hostelId
      ? await userRepository.findActiveAdminsByHostel(hostelId, hostel?.ownerAdminId)
      : [];
    const roomNumber = complaint.roomNumberAtSubmission || complaint.roomId?.roomNumber;
    const roomLabel = roomNumber ? ` Room ${roomNumber}.` : '';
    const description = complaint.description.slice(0, 60);
    const suffix = complaint.description.length > 60 ? '…' : '';

    await Promise.all([
      ...admins.map((admin) => notificationService.notify({
        userId: admin._id,
        type: 'ComplaintUpdate',
        title: 'Repair awaiting verification',
        body: `Staff marked a complaint as fixed and it needs your review.${roomLabel} “${description}${suffix}”`,
        relatedEntityId: complaint._id,
      })),
      notificationService.notify({
        userId: complaint.residentId?._id || complaint.residentId,
        type: 'ComplaintUpdate',
        title: 'Repair awaiting verification',
        body: 'Staff marked your complaint as fixed. The hostel administrator will review it before it is resolved.',
        relatedEntityId: complaint._id,
      }),
    ]);

    return updatedComplaint;
  },

  async listAll(filters = {}, user = null) {
    if (user && user.role === 'Admin') {
      const adminHostelId = await getAdminHostelId(user);
      if (!adminHostelId) {
        // Unassigned admin has no hostel — return empty list
        return [];
      }
      return complaintRepository.findAll({ ...filters, hostelId: adminHostelId });
    }

    if (user && user.role === 'CleaningStaff') {
      if (!user.hostelId) return [];
      return complaintRepository.findByAssignedStaff(user.id);
    }

    return complaintRepository.findAll(filters);
  },

  async assign(id, staffId, user = null) {
    const adminHostelId = user?.role === 'Admin' ? await getAdminHostelId(user) : null;
    const complaint = await unitOfWork(async (session) => {
      const complaint = await Complaint.findById(id).session(session);
      if (!complaint) throw new AppError('Complaint not found', 404);

      if (user && user.role === 'Admin') {
        if (!adminHostelId || !complaint.hostelId || complaint.hostelId.toString() !== adminHostelId) {
          throw new AppError('You cannot manage complaints from another hostel', 403);
        }
      }

      const staff = await User.findOneAndUpdate({ _id: staffId, role: 'CleaningStaff', isActive: true, emailVerified: true },
        { $inc: { bookingRevision: 1 } }, { new: true, session });
      if (!staff || staff.role !== 'CleaningStaff' || !staff.isActive || !staff.emailVerified) {
        throw new AppError('Assigned user must be an active, email-verified cleaning staff member', 400);
      }
      if (!staff.hostelId || !complaint.hostelId || staff.hostelId.toString() !== complaint.hostelId.toString()) {
        throw new AppError('Staff member does not belong to this hostel', 400);
      }

      complaint.assignedStaffId = staffId;
      if (complaint.status !== 'InReview') {
        complaint.status = 'InReview';
        complaint.residentConfirmedAt = null;
        complaint.repairNote = '';
        complaint.repairProofImageUrl = null;
        complaint.statusHistory = complaint.statusHistory || [];
        if (user?.id) {
          complaint.statusHistory.push({
            status: 'InReview',
            changedBy: user.id,
            changedAt: new Date(),
          });
        }
      }
      await dataRepository.save(complaint, { session });
      if (complaint.severityTier === 'Critical' && !complaint.blockchainRef) await audit.enqueue('Complaint', complaint, session);
      return complaint;
    });

    await notificationService.notify({
      userId: staffId,
      type: 'ComplaintUpdate',
      title: 'Complaint assigned to you',
      body: `You've been assigned a complaint: "${complaint.description.slice(0, 60)}${complaint.description.length > 60 ? '…' : ''}"`,
      relatedEntityId: complaint._id,
    });

    return complaintRepository.findById(complaint._id);
  },

  /**
   * Sprint 8 evolution notes + Abstract both state that "severe" complaints
   * get blockchain-logged like payments (AGENTS.md Deviation, "Complaint
   * blockchain-logging"). We write the record the moment severity is set to
   * Critical, whether at creation or on a later status transition.
   */
  async updateStatus(id, status, user = null) {
    const complaint = await Complaint.findById(id);
    if (!complaint) throw new AppError('Complaint not found', 404);

    if (user && user.role === 'Admin') {
      const adminHostelId = await getAdminHostelId(user);
      if (!adminHostelId || !complaint.hostelId || complaint.hostelId.toString() !== adminHostelId) {
        throw new AppError('You cannot manage complaints from another hostel', 403);
      }
    }

    const previousStatus = complaint.status;

    if (status === 'AwaitingAdminVerification' && complaint.status !== 'AwaitingAdminVerification') {
      throw new AppError('Only the assigned staff member can submit a repair for admin verification.', 403);
    }
    if (
      status === 'Resolved' &&
      complaint.status !== 'AwaitingAdminVerification' &&
      complaint.status !== 'Resolved'
    ) {
      throw new AppError('The assigned staff member must submit the repair for verification before it can be resolved.', 409);
    }

    complaint.status = status;
    if (status === 'InReview' && previousStatus !== 'InReview') {
      complaint.residentConfirmedAt = null;
      complaint.repairNote = '';
      complaint.repairProofImageUrl = null;
    }
    if (previousStatus !== status && user?.id) {
      complaint.statusHistory = complaint.statusHistory || [];
      complaint.statusHistory.push({ status, changedBy: user.id, changedAt: new Date() });
    }

    if (complaint.severityTier === 'Critical' && !complaint.blockchainRef) {
      await audit.enqueue('Complaint', complaint);
    }

    await dataRepository.save(complaint);

    const statusLabel = status === 'InReview'
      ? 'In Review'
      : status === 'AwaitingAdminVerification'
      ? 'Awaiting Admin Verification'
      : status;

    const notifications = [notificationService.notify({
      userId: complaint.residentId,
      type: 'ComplaintUpdate',
      title: `Complaint ${statusLabel.toLowerCase()}`,
      body: `Your complaint ("${complaint.description.slice(0, 60)}${complaint.description.length > 60 ? '…' : ''}") is now ${statusLabel}.`,
      relatedEntityId: complaint._id,
    })];

    if (
      status === 'InReview' &&
      previousStatus === 'AwaitingAdminVerification' &&
      complaint.assignedStaffId
    ) {
      notifications.push(notificationService.notify({
        userId: complaint.assignedStaffId,
        type: 'ComplaintUpdate',
        title: 'Repair needs more work',
        body: `The administrator returned a complaint for further repair. Room ${complaint.roomNumberAtSubmission || 'not recorded'}.`,
        relatedEntityId: complaint._id,
      }));
    }

    await Promise.all(notifications);

    return complaintRepository.findById(complaint._id);
  },

  async confirmResolved(id, residentId) {
    const complaint = await complaintRepository.findById(id);
    if (!complaint) throw new AppError('Complaint not found', 404);
    const ownerId = complaint.residentId?._id || complaint.residentId;
    if (ownerId?.toString() !== residentId.toString()) {
      throw new AppError('You can only confirm resolution for your own complaints.', 403);
    }
    if (complaint.status !== 'Resolved') {
      throw new AppError('The administrator must resolve this complaint before you can confirm it.', 409);
    }
    if (complaint.residentConfirmedAt) return complaint;

    const updatedComplaint = await complaintRepository.confirmResolvedByResident(id, residentId);
    if (!updatedComplaint) {
      throw new AppError('The complaint changed. Refresh it and try again.', 409);
    }

    const hostelId = complaint.hostelId?._id || complaint.hostelId;
    const hostel = hostelId ? await Hostel.findById(hostelId).select('ownerAdminId') : null;
    const admins = hostelId
      ? await userRepository.findActiveAdminsByHostel(hostelId, hostel?.ownerAdminId)
      : [];
    await Promise.all(admins.map((admin) => notificationService.notify({
      userId: admin._id,
      type: 'ComplaintUpdate',
      title: 'Resident confirmed resolution',
      body: `The resident confirmed complaint ${complaint._id.toString().slice(-6).toUpperCase()} is resolved.`,
      relatedEntityId: complaint._id,
    })));

    return updatedComplaint;
  },

  async reopen(id, residentId) {
    const complaint = await complaintRepository.findById(id);
    if (!complaint) throw new AppError('Complaint not found', 404);
    const ownerId = complaint.residentId?._id || complaint.residentId;
    if (ownerId?.toString() !== residentId.toString()) {
      throw new AppError('You can only reopen your own complaints.', 403);
    }
    if (complaint.status !== 'Resolved') {
      throw new AppError('Only resolved complaints can be reopened.', 409);
    }

    const updatedComplaint = await complaintRepository.reopenByResident(id, residentId);
    if (!updatedComplaint) {
      throw new AppError('The complaint changed. Refresh it and try again.', 409);
    }

    const notifications = [];
    const assignedStaffId = complaint.assignedStaffId?._id || complaint.assignedStaffId;
    if (assignedStaffId) {
      notifications.push(notificationService.notify({
        userId: assignedStaffId,
        type: 'ComplaintUpdate',
        title: 'Resident reopened a complaint',
        body: `The resident reopened complaint ${complaint._id.toString().slice(-6).toUpperCase()}. Please review it again.`,
        relatedEntityId: complaint._id,
      }));
    }

    const hostelId = complaint.hostelId?._id || complaint.hostelId;
    const hostel = hostelId ? await Hostel.findById(hostelId).select('ownerAdminId') : null;
    const admins = hostelId
      ? await userRepository.findActiveAdminsByHostel(hostelId, hostel?.ownerAdminId)
      : [];
    notifications.push(...admins.map((admin) => notificationService.notify({
      userId: admin._id,
      type: 'ComplaintUpdate',
      title: 'Resident reopened a complaint',
      body: `A resident reopened complaint ${complaint._id.toString().slice(-6).toUpperCase()}.`,
      relatedEntityId: complaint._id,
    })));
    await Promise.all(notifications);

    return updatedComplaint;
  },

  // Resource loader for hostelScope.middleware — checks complaint.hostelId directly
  loaderById: async (req) => {
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint || !complaint.hostelId) return null;
    return { hostelId: complaint.hostelId };
  },
};

module.exports = complaintService;
