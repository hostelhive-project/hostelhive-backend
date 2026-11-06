const { Room, Booking } = require('../repositories/data.repository');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const userRepository = require('../repositories/user.repository');
const unitOfWork = require('../repositories/unitOfWork');
const authService = require('./auth.service');
const { User: User } = require('../repositories/data.repository');
const { CleaningTask, Complaint } = require('../repositories/data.repository');

const SELF_UPDATABLE_FIELDS = ['name', 'phone', 'profileImageUrl', 'deviceToken'];

const userService = {
  async getForViewer(id, viewer) {
    const isSelf = id === viewer.id;
    if (!isSelf) {
      if (viewer.role !== 'Admin') {
        throw new AppError('You can only view your own profile', 403);
      }
      const targetUser = await this.getById(id);
      if (targetUser.role === 'Admin') {
        throw new AppError('You can only view your own administrator profile', 403);
      }
      if (targetUser.role === 'CleaningStaff') {
        if (targetUser.hostelId?.toString() !== viewer.hostelId) {
          throw new AppError('You cannot view staff profiles outside your assigned hostel', 403);
        }
      } else if (targetUser.role === 'Student') {
        const rooms = await Room.find({ hostelId: viewer.hostelId }).select('_id');
        const hasBooking = await Booking.exists({
          studentId: targetUser._id,
          roomId: { $in: rooms.map((r) => r._id) },
        });
        if (!hasBooking) {
          throw new AppError('You can only view profiles for residents affiliated with your hostel', 403);
        }
      }
      const profile = targetUser.toJSON();
      delete profile.deviceToken;
      return profile;
    }
    const user = await this.getById(id);
    return user;
  },
  async getById(id) {
    const user = await userRepository.findById(id);
    if (!user) throw new AppError('User not found', 404);
    return user;
  },

  /**
   * UC-03 Profile Management. A user may only update their own allow-listed
   * fields — role/email/hostelId changes are intentionally excluded here and
   * should go through a separate admin-only endpoint if ever needed.
   */
  async updateSelf(id, updates) {
    const safeUpdates = {};
    for (const field of SELF_UPDATABLE_FIELDS) {
      if (updates[field] !== undefined) safeUpdates[field] = updates[field];
    }
    const user = await userRepository.updateById(id, safeUpdates);
    if (!user) throw new AppError('User not found', 404);
    return user;
  },

  async listStaffForHostel(hostelId) {
    return User.find({
      hostelId,
      role: 'CleaningStaff',
      $or: [
        { isActive: true },
        { isActive: false, emailVerified: false },
      ],
    });
  },

  async createStaff(adminUser, { name, email, phone }) {
    if (!adminUser.hostelId) {
      throw new AppError('Admin must be assigned to a hostel to create staff', 400);
    }
    const existing = await userRepository.findByEmail(email);
    if (existing) {
      throw new AppError('An account with this email already exists', 409);
    }
    // The temporary random password is never shared or used; invitees set their own password
    // after proving access to this email address.
    const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), env.bcryptSaltRounds);
    const staff = await userRepository.create({
      name,
      email,
      passwordHash,
      role: 'CleaningStaff',
      phone: phone || null,
      hostelId: adminUser.hostelId,
      emailVerified: false,
      isActive: false,
    });

    try {
      await authService.sendStaffInviteCode(staff);
    } catch (error) {
      await userRepository.deletePendingStaffInvite(staff._id, staff.hostelId);
      throw error;
    }

    return staff;
  },

  async updateStaff(adminUser, staffId, updates) {
    if (!adminUser.hostelId) {
      throw new AppError('Admin must be assigned to a hostel to manage staff', 400);
    }

    const staff = await userRepository.findActiveStaffByIdInHostel(staffId, adminUser.hostelId);
    if (!staff) throw new AppError('Active cleaning staff member not found in your hostel', 404);

    const safeUpdates = {};
    if (updates.name !== undefined) safeUpdates.name = updates.name;
    if (updates.phone !== undefined) safeUpdates.phone = updates.phone || null;

    const updatedStaff = await userRepository.updateActiveStaffByIdInHostel(
      staffId,
      adminUser.hostelId,
      safeUpdates
    );
    if (!updatedStaff) throw new AppError('Active cleaning staff member not found in your hostel', 404);
    return updatedStaff;
  },

  async updateStaffInvitation(adminUser, staffId, { email }) {
    if (!adminUser.hostelId) {
      throw new AppError('Admin must be assigned to a hostel to manage staff invitations', 400);
    }

    const invitation = await userRepository.findPendingStaffInviteByIdInHostel(
      staffId,
      adminUser.hostelId
    );
    if (!invitation) throw new AppError('Pending staff invitation not found in your hostel', 404);

    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail === invitation.email) {
      throw new AppError('The email is unchanged. Use resend to send another verification code.', 400);
    }

    const existing = await userRepository.findByEmail(normalizedEmail);
    if (existing && existing._id.toString() !== invitation._id.toString()) {
      throw new AppError('An account with this email already exists', 409);
    }

    invitation.email = normalizedEmail;
    await authService.sendStaffInviteCode(invitation);
    return invitation;
  },

  async resendStaffInvitation(adminUser, staffId) {
    if (!adminUser.hostelId) {
      throw new AppError('Admin must be assigned to a hostel to manage staff invitations', 400);
    }

    const invitation = await userRepository.findPendingStaffInviteByIdInHostel(
      staffId,
      adminUser.hostelId
    );
    if (!invitation) throw new AppError('Pending staff invitation not found in your hostel', 404);

    await authService.resendStaffInviteCode(invitation);
    return invitation;
  },

  async cancelStaffInvitation(adminUser, staffId) {
    if (!adminUser.hostelId) {
      throw new AppError('Admin must be assigned to a hostel to manage staff invitations', 400);
    }

    const result = await userRepository.deletePendingStaffInvite(staffId, adminUser.hostelId);
    if (result.deletedCount === 0) {
      throw new AppError('Pending staff invitation not found in your hostel', 404);
    }
  },

  async deleteStaff(adminUser, staffId) {
    if (!adminUser.hostelId) {
      throw new AppError('Admin must be assigned to a hostel to manage staff', 400);
    }

    return unitOfWork(async (session) => {
      // Assignment also writes this staff record, so removal cannot pass its
      // unfinished-work check concurrently with a new assignment.
      const staff = await User.findOneAndUpdate({ _id: staffId, hostelId: adminUser.hostelId,
        role: 'CleaningStaff', isActive: true }, { $set: { isActive: false, deviceToken: null },
        $inc: { sessionVersion: 1, bookingRevision: 1 } }, { new: true, session });
      if (!staff) throw new AppError('Active cleaning staff member not found in your hostel', 404);
      if (await CleaningTask.exists({ assignedStaffId: staffId, status: { $in: ['Scheduled', 'InProgress', 'Delayed'] } }).session(session)) {
        throw new AppError('Reassign or complete this staff member\'s unfinished cleaning tasks before deleting them', 409);
      }
      if (await Complaint.exists({ assignedStaffId: staffId, status: { $ne: 'Resolved' } }).session(session)) {
        throw new AppError('Reassign or resolve this staff member\'s unfinished complaints before removing them', 409);
      }
      return staff;
    });
  },
};

module.exports = userService;
