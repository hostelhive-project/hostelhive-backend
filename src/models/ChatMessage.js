const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * Added collection. The "Support Assistant Screen" wireframe shows a persisted
 * chat thread, and EP-09/US-15 require the AI assistant, but no entity existed
 * to store conversation history in the original design.
 */
const chatMessageSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sessionId: { type: String, required: true },
    hostelId: { type: Schema.Types.ObjectId, ref: 'Hostel', default: null },
    sender: { type: String, enum: ['User', 'Bot'], required: true },
    message: { type: String, required: true },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: false } }
);

chatMessageSchema.index({ userId: 1, sessionId: 1, createdAt: 1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
