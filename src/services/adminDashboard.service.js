const mongoose = require('mongoose');
const { Room: Room } = require('../repositories/data.repository');
const { Booking: Booking } = require('../repositories/data.repository');
const { Payment: Payment } = require('../repositories/data.repository');
const { Complaint: Complaint } = require('../repositories/data.repository');
const { CleaningTask: CleaningTask } = require('../repositories/data.repository');
const { User: User } = require('../repositories/data.repository');

/**
 * Powers the "Admin Dashboard" wireframe (§7.3.24): rent collected this
 * month, occupancy %, open complaints, staff status. All read-only
 * aggregations scoped to a single hostel (req.user.hostelId).
 */
const adminDashboardService = {
  async getSummary(hostelId) {
    if (!hostelId) {
      return {
        rentCollectedThisMonth: 0,
        occupancy: { occupied: 0, capacity: 0, percent: 0 },
        openComplaints: 0,
        staff: { total: 0, currentlyOnTask: 0 },
        roomCount: 0,
      };
    }

    const targetHostelId = typeof hostelId === 'string' && mongoose.Types.ObjectId.isValid(hostelId)
      ? new mongoose.Types.ObjectId(hostelId)
      : hostelId;

    const rooms = await Room.find({ hostelId });
    const totalCapacity = rooms.reduce((sum, r) => sum + r.capacity, 0);
    const totalOccupied = rooms.reduce((sum, r) => sum + r.occupiedCount, 0);


    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Rent collected: Payment carries a denormalized hostelId (see
    // models/Payment.js). In aggregate stages, we match using targetHostelId (ObjectId)
    // so MongoDB correctly aggregates revenue.
    const [rentCollectedAgg] = await Payment.aggregate([
      {
        $match: {
          hostelId: targetHostelId,
          paymentStatus: 'Paid',
          transactionDate: { $gte: monthStart },
        },
      },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const [adjustments] = await require('../repositories/paymentAdjustment.repository').totalForPeriod(targetHostelId, monthStart);

    const openComplaintsCount = await Complaint.countDocuments({
      hostelId: targetHostelId,
      status: { $in: ['Submitted', 'InReview', 'AwaitingAdminVerification'] },
    });

    const staff = await User.find({ hostelId, role: 'CleaningStaff' }).select('_id');
    const staffIds = staff.map((s) => s._id);
    const tasksInProgress = await CleaningTask.countDocuments({
      assignedStaffId: { $in: staffIds },
      status: 'InProgress',
    });

    return {
      rentCollectedThisMonth: (rentCollectedAgg?.total || 0) + (adjustments?.total || 0),
      occupancy: {
        occupied: totalOccupied,
        capacity: totalCapacity,
        percent: totalCapacity > 0 ? Math.round((totalOccupied / totalCapacity) * 100) : 0,
      },
      openComplaints: openComplaintsCount,
      staff: {
        total: staffIds.length,
        currentlyOnTask: tasksInProgress, // best available proxy for "clocked in" — no attendance model exists yet
      },
      roomCount: rooms.length,
    };
  },

  async getRecentActivity(hostelId, limit = 10) {
    if (!hostelId) {
      return { recentBookings: [], recentComplaints: [] };
    }

    const targetHostelId = typeof hostelId === 'string' && mongoose.Types.ObjectId.isValid(hostelId)
      ? new mongoose.Types.ObjectId(hostelId)
      : hostelId;

    const rooms = await Room.find({ hostelId }).select('_id');
    const roomIds = rooms.map((r) => r._id);

    const recentBookings = await Booking.find({ roomId: { $in: roomIds } })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .select('status updatedAt studentId roomId residentCode')
      .populate('studentId', 'name email phone residentCode')
      .populate('roomId', 'roomNumber layoutType');

    const recentComplaints = await Complaint.find({
      hostelId: targetHostelId,
    })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .select('status severityTier updatedAt description title category');

    return { recentBookings, recentComplaints };
  },
};

module.exports = adminDashboardService;
