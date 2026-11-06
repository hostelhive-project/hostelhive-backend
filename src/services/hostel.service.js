const unitOfWork = require('../repositories/unitOfWork');
const { Complaint, Review, User } = require('../repositories/data.repository');
const AppError = require('../utils/AppError');
const hostelRepository = require('../repositories/hostel.repository');
const { Room: Room } = require('../repositories/data.repository');
const { Hostel: Hostel } = require('../repositories/data.repository');
const { Booking: Booking } = require('../repositories/data.repository');

const hostelService = {
  async createForOwner(data, user) {
    return unitOfWork(async (session) => {
      if (await Hostel.exists({ ownerAdminId: user.id }).session(session)) throw new AppError('Admin is already managing a hostel.', 409);
      if (await Hostel.exists({ name: data.name.trim() }).session(session)) throw new AppError('A hostel with this name already exists.', 409);
      const [hostel] = await Hostel.create([{ ...data, ownerAdminId: user.id }], { session });
      await User.updateOne({ _id: user.id }, { $set: { hostelId: hostel._id } }, { session });
      return hostel;
    });
  },
  async getChatbotInfo(hostelId, user) {
    const hostel = await this.getById(hostelId);
    if (!hostel) throw new AppError('Hostel not found', 404);

    if (hostel.publicationStatus === 'Draft' && !(user?.role === 'Admin' && hostel.ownerAdminId?.toString() === user.id)) {
      throw new AppError('Hostel not found', 404);
    }
    let isResidentOrOwner = false;
    if (user) {
      if (user.role === 'Admin' && hostel.ownerAdminId?.toString() === user.id) {
        isResidentOrOwner = true;
      } else if (user.role === 'Student') {
        const rooms = await Room.find({ hostelId: hostel._id }).select('_id');
        const hasCheckedIn = await Booking.exists({
          studentId: user.id,
          roomId: { $in: rooms.map((r) => r._id) },
          status: 'CheckedIn',
        });
        if (hasCheckedIn) isResidentOrOwner = true;
      }
    }

    const prop = hostel.propertyInfo
      ? (hostel.propertyInfo.toObject ? hostel.propertyInfo.toObject() : { ...hostel.propertyInfo })
      : {};
    const chat = hostel.chatbotInfo
      ? (hostel.chatbotInfo.toObject ? hostel.chatbotInfo.toObject() : { ...hostel.chatbotInfo })
      : {};

    // Single source of truth is propertyInfo, with legacy fallback if not yet configured
    const gateOpenTime = prop.gateOpenTime || '';
    const gateCloseTime = prop.gateCloseTime || '';
    const houseRules = prop.houseRules?.length ? prop.houseRules : (chat.rules || []);
    const receptionContact = prop.receptionContact || chat.contactNumber || '';
    const nearbyLandmarks = prop.nearbyLandmarks || chat.nearbyLandmarks || '';

    const responseData = {
      gateOpenTime,
      gateCloseTime,
      houseRules,
      receptionContact,
      nearbyLandmarks,
      // Legacy backward-compatibility aliases:
      rules: houseRules,
      contactNumber: receptionContact,
    };

    if (isResidentOrOwner) {
      responseData.wifiPassword = chat.wifiPassword || '';
      responseData.emergencyContact = chat.emergencyContact || '';
      responseData.additionalInfo = chat.additionalInfo || '';
    }

    return responseData;
  },
  async updateChatbotInfo(hostelId, updates) {
    const existing = await this.getById(hostelId);
    const existingChat = existing.chatbotInfo
      ? (existing.chatbotInfo.toObject ? existing.chatbotInfo.toObject() : { ...existing.chatbotInfo })
      : {};

    const updatedChatbotInfo = {
      ...existingChat,
      wifiPassword: updates.wifiPassword !== undefined ? updates.wifiPassword : existingChat.wifiPassword,
      emergencyContact: updates.emergencyContact !== undefined ? updates.emergencyContact : existingChat.emergencyContact,
      additionalInfo: updates.additionalInfo !== undefined ? updates.additionalInfo : existingChat.additionalInfo,
      updatedAt: new Date(),
    };

    const hostel = await this.update(hostelId, {
      chatbotInfo: updatedChatbotInfo,
    });
    return hostel.chatbotInfo;
  },
  search(filters) {
    return hostelRepository.search(filters);
  },

  searchExplore(filters) {
    return hostelRepository.searchExplore(filters);
  },

  async getById(id) {
    const hostel = await hostelRepository.findById(id);
    if (!hostel) throw new AppError('Hostel not found', 404);
    return hostel;
  },

  async getPublicById(id) {
    const hostel = await hostelRepository.findPublicById(id);
    if (!hostel) throw new AppError('Hostel not found', 404);
    return hostel;
  },

  async getForViewer(id, viewer) {
    if (viewer?.role === 'Admin') {
      const owned = await hostelRepository.findById(id);
      if (owned && owned.ownerAdminId.toString() === viewer.id) return owned;
    }
    return this.getPublicById(id);
  },

  async publish(id) {
    const hostel = await hostelRepository.findById(id);
    if (!hostel) throw new AppError('Hostel not found', 404);
    if (!hostel.name?.trim() || !hostel.location?.trim() || !Number.isFinite(hostel.priceTier) || hostel.priceTier < 0) {
      throw new AppError('Complete the property name, address and valid base rent before publishing.', 400);
    }
    return hostelRepository.updateById(id, { publicationStatus: 'Published' });
  },

  async update(id, updates) {
    if (updates.name) {
      const conflict = await Hostel.findOne({
        _id: { $ne: id },
        name: updates.name.trim(),
      });
      if (conflict) {
        throw new AppError(`A hostel named "${updates.name}" already exists.`, 409);
      }
    }
    // hostelCode is immutable after creation
    delete updates.hostelCode;
    const hostel = await hostelRepository.updateById(id, updates);
    if (!hostel) throw new AppError('Hostel not found', 404);
    return hostel;
  },

  async remove(id) {
    return unitOfWork(async (session) => {
      const hostel = await Hostel.findById(id).session(session);
      if (!hostel) throw new AppError('Hostel not found', 404);
      const rooms = await Room.find({ hostelId: id }).session(session);
      const roomIds = rooms.map(room => room._id);
      if (rooms.some(room => room.occupiedCount > 0) || await Booking.exists({ roomId: { $in: roomIds } }).session(session) ||
          await Complaint.exists({ hostelId: id }).session(session) || await Review.exists({ hostelId: id }).session(session) ||
          await require('../repositories/data.repository').CleaningTask.exists({ roomId: { $in: roomIds } }).session(session) ||
          await User.exists({ hostelId: id, _id: { $ne: hostel.ownerAdminId } }).session(session)) {
        throw new AppError('This hostel has account, resident, billing or work history and cannot be deleted.', 409);
      }
      await Room.deleteMany({ hostelId: id }, { session });
      await User.updateOne({ _id: hostel.ownerAdminId, hostelId: id }, { $set: { hostelId: null } }, { session });
      return Hostel.findByIdAndDelete(id, { session });
    });
  },

  // Resource loader for hostelScope.middleware
  loaderById: (req) => hostelRepository.findById(req.params.id),
  // Same, but for routes nested with :hostelId instead of :id (rooms, reviews, stripe)
  loaderByHostelIdParam: (req) => hostelRepository.findById(req.params.hostelId),
};

module.exports = hostelService;
