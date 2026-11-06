const dataRepository = require('../repositories/data.repository');
const unitOfWork = require('../repositories/unitOfWork');
const AppError = require('../utils/AppError');
const cleaningTaskRepository = require('../repositories/cleaningTask.repository');
const notificationService = require('./notification.service');
const outboxRepository = require('../repositories/outbox.repository');
const env = require('../config/env');
const { CleaningTask } = require('../repositories/data.repository');
const { Room } = require('../repositories/data.repository');
const { User } = require('../repositories/data.repository');
const { Hostel } = require('../repositories/data.repository');

function isDirectiveActiveToday(date) {
  if (!date) return false;
  const d = new Date(date);
  const now = new Date();
  const sameLocalDay = d.toDateString() === now.toDateString();
  const sameUTCDay =
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate();
  return sameLocalDay || sameUTCDay;
}

const cleaningTaskService = {
  async assign(data, user = null) {
    const { task, room } = await unitOfWork(async (session) => {
      const room = await Room.findOneAndUpdate({ _id: data.roomId }, { $inc: { bookingRevision: 1 } }, { new: true, session });
      if (!room) throw new AppError('Room not found', 404);

      const staff = await User.findOneAndUpdate({ _id: data.assignedStaffId, role: 'CleaningStaff', isActive: true, emailVerified: true },
        { $inc: { bookingRevision: 1 } }, { new: true, session });
      if (!staff || staff.role !== 'CleaningStaff' || !staff.isActive || !staff.emailVerified) {
        throw new AppError('Assigned user must be active, email-verified CleaningStaff', 400);
      }

      if (user && user.role === 'Admin' && user.hostelId && room.hostelId.toString() !== user.hostelId.toString()) {
        throw new AppError('Cannot assign cleaning task for a room outside your hostel', 403);
      }

      if (!staff.hostelId || staff.hostelId.toString() !== room.hostelId.toString()) {
        throw new AppError('Staff member does not belong to the hostel of this room', 400);
      }

      const task = await cleaningTaskRepository.create({ ...data, status: 'Scheduled' }, session);
      return { task, room };
    });

    await notificationService.notify({
      userId: data.assignedStaffId,
      type: 'TaskAssigned',
      title: 'New cleaning task assigned',
      body: `You've been assigned a ${data.taskType} task for room ${room.roomNumber}.`,
      relatedEntityId: task._id,
    });

    return task;
  },

  async getById(id, user = null) {
    const task = await cleaningTaskRepository.findById(id);
    if (!task) throw new AppError('Task not found', 404);

    if (!user || !['Admin', 'CleaningStaff'].includes(user.role)) {
      throw new AppError('You do not have permission to view this task', 403);
    }

    const staffIdStr = task.assignedStaffId?._id
      ? task.assignedStaffId._id.toString()
      : task.assignedStaffId?.toString();

    if (user.role === 'CleaningStaff' && staffIdStr !== user.id) {
      throw new AppError('You can only view tasks assigned to you', 403);
    }

    if (user.role === 'Admin') {
      const room = await Room.findById(task.roomId);
      if (!user.hostelId || !room || room.hostelId.toString() !== user.hostelId.toString()) {
        throw new AppError('You cannot view cleaning tasks outside your assigned hostel', 403);
      }
    }

    return task;
  },

  listForStaff(staffId, statusFilter) {
    return cleaningTaskRepository.findByStaff(staffId, statusFilter);
  },

  async start(taskId, staffId, { beforeImageUri } = {}) {
    const task = await CleaningTask.findById(taskId);
    if (!task) throw new AppError('Task not found', 404);
    if (task.assignedStaffId.toString() !== staffId) {
      throw new AppError('You can only start tasks assigned to you', 403);
    }
    if (task.status !== 'Scheduled' && task.status !== 'Delayed') {
      throw new AppError(`Cannot start a task with status "${task.status}"`, 409);
    }

    const finalBeforeImage = beforeImageUri || task.beforeImageUri;
    if (!finalBeforeImage) {
      throw new AppError('A before-cleaning photo (beforeImageUri) is required to start this task', 400);
    }

    task.status = 'InProgress';
    task.startedAt = new Date();
    if (beforeImageUri) {
      task.beforeImageUri = beforeImageUri;
    }
    await dataRepository.save(task);
    return task.populate('roomId', 'roomNumber floor layoutType');
  },

  /**
   * TC-TASK-01: afterImageUri is required proof-of-work on completion —
   * enforced here, not just at the schema level, so the error message is
   * actionable rather than a generic Mongoose validation dump.
   */
  async complete(taskId, staffId, { afterImageUri, staffNotes }) {
    const task = await CleaningTask.findById(taskId);
    if (!task) throw new AppError('Task not found', 404);
    if (task.assignedStaffId.toString() !== staffId) {
      throw new AppError('You can only complete tasks assigned to you', 403);
    }
    if (task.status !== 'InProgress') {
      throw new AppError('Only an InProgress task can be marked complete', 409);
    }
    if (!afterImageUri) {
      throw new AppError('An after-cleaning photo (afterImageUri) is required to complete this task', 400);
    }

    // Persist completion and its durable background request together; never wait for Groq here.
    const completed = await unitOfWork(async (session) => {
      const queuedAt = new Date();
      const updated = await cleaningTaskRepository.completeForStaff(taskId, staffId, {
        status: 'Completed', completedAt: queuedAt, afterImageUri,
        ...(staffNotes ? { staffNotes } : {}),
        cleaningAssessment: {
          status: env.integrations.cleaningAi.enabled ? 'Pending' : 'Unavailable',
          queuedAt, model: env.integrations.cleaningAi.model,
          reason: env.integrations.cleaningAi.enabled ? null : 'disabled',
        },
      }, session);
      if (!updated) throw new AppError('This task has already changed. Refresh before completing it.', 409);
      if (env.integrations.cleaningAi.enabled) {
        await outboxRepository.enqueue(`cleaning-ai:${taskId}`, 'CleaningAssessment', { taskId }, session);
      }
      return updated;
    });
    return completed.populate('roomId', 'roomNumber floor layoutType');
  },

  async delay(taskId, staffId, reason) {
    const task = await CleaningTask.findById(taskId);
    if (!task) throw new AppError('Task not found', 404);
    if (task.assignedStaffId.toString() !== staffId) {
      throw new AppError('You can only update tasks assigned to you', 403);
    }
    if (!['Scheduled', 'InProgress'].includes(task.status)) {
      throw new AppError(`Cannot delay a task with status "${task.status}"`, 409);
    }
    task.status = 'Delayed';
    task.delayReason = reason || 'No reason provided';
    await dataRepository.save(task);
    return task;
  },

  // Resource loader for hostelScope.middleware — resolves via the task's room.
  loaderById: async (req) => {
    const task = await CleaningTask.findById(req.params.id).populate('roomId', 'hostelId');
    if (!task || !task.roomId) return null;
    return { hostelId: task.roomId.hostelId };
  },

  async listForHostel(hostelId, statusFilter) {
    const rooms = await Room.find({ hostelId }).select('_id');
    const roomIds = rooms.map((r) => r._id);
    return cleaningTaskRepository.findByRoomIds(roomIds, statusFilter);
  },

  async broadcastDirective(adminUser, directiveText) {
    let hostelId = adminUser.hostelId;
    if (!hostelId) {
      const hostel = await Hostel.findOne({ ownerAdminId: adminUser.id }).select('_id');
      if (hostel) {
        hostelId = hostel._id.toString();
      }
    }

    if (!hostelId) {
      throw new AppError('Admin must be assigned to a hostel to broadcast a directive', 400);
    }

    const trimmedText = directiveText.trim();

    // 1. Update/persist directive on the hostel
    await Hostel.findByIdAndUpdate(hostelId, {
      cleaningDirective: {
        text: trimmedText,
        updatedAt: new Date(),
        updatedBy: adminUser.id,
      },
    });

    // 2. Find all active CleaningStaff belonging to this hostel
    const staffList = await User.find({
      hostelId,
      role: 'CleaningStaff',
      isActive: true,
    });

    // 3. Dispatch Announcement notification to each staff member
    for (const staff of staffList) {
      await notificationService.notify({
        userId: staff._id,
        type: 'Announcement',
        title: 'Cleaning Directive',
        body: trimmedText,
        relatedEntityId: null,
      });
    }

    return {
      directive: trimmedText,
      recipientCount: staffList.length,
      message:
        staffList.length === 0
          ? 'No cleaning staff are currently assigned to this hostel.'
          : `Directive broadcast to ${staffList.length} cleaning staff member${staffList.length > 1 ? 's' : ''}.`,
    };
  },

  async getDirective(target) {
    let hostelId = null;
    if (typeof target === 'string') {
      hostelId = target;
    } else if (target && typeof target === 'object') {
      hostelId = target.hostelId;
      if (!hostelId && target.id) {
        const hostel = await Hostel.findOne({ ownerAdminId: target.id }).select('_id');
        if (hostel) hostelId = hostel._id.toString();
      }
    }

    if (!hostelId) {
      return {
        directive: null,
        rawDirective: null,
        updatedAt: null,
        isToday: false,
      };
    }

    const hostel = await Hostel.findById(hostelId).select('cleaningDirective');
    if (!hostel || !hostel.cleaningDirective || !hostel.cleaningDirective.text) {
      return {
        directive: null,
        rawDirective: null,
        updatedAt: null,
        isToday: false,
      };
    }

    const isActive = isDirectiveActiveToday(hostel.cleaningDirective.updatedAt);

    return {
      directive: isActive ? hostel.cleaningDirective.text : null,
      rawDirective: hostel.cleaningDirective.text,
      updatedAt: hostel.cleaningDirective.updatedAt,
      updatedBy: hostel.cleaningDirective.updatedBy || null,
      isToday: isActive,
    };
  },
};

module.exports = cleaningTaskService;
