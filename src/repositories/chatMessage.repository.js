const mongoose = require('mongoose');
const ChatMessage = require('../models/ChatMessage');

const chatMessageRepository = {
  create(data) {
    return ChatMessage.create(data);
  },
  /**
   * Returns the most recent `limit` messages for a session, oldest-first —
   * ready to drop straight into the AI API's `messages` array as history.
   */
  async findRecentForSession(userId, sessionId, limit = 20) {
    const recent = await ChatMessage.find({ userId, sessionId }).sort({ createdAt: -1 }).limit(limit);
    return recent.reverse();
  },
  findSessionsForUser(userId) {
    const targetUserId = typeof userId === 'string' && mongoose.Types.ObjectId.isValid(userId)
      ? new mongoose.Types.ObjectId(userId)
      : userId;

    return ChatMessage.aggregate([
      { $match: { userId: targetUserId } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$sessionId',
          lastMessage: { $first: '$message' },
          lastMessageAt: { $first: '$createdAt' },
        },
      },
      { $sort: { lastMessageAt: -1 } },
    ]);
  },
};

module.exports = chatMessageRepository;

