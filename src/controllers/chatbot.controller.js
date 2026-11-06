const catchAsync = require('../utils/catchAsync');
const { success } = require('../utils/response');
const chatbotService = require('../services/chatbot.service');

const chatbotController = {
  sendMessage: catchAsync(async (req, res) => {
    const result = await chatbotService.sendMessage(req.user.id, req.body);
    return success(res, 200, result);
  }),

  getHistory: catchAsync(async (req, res) => {
    const history = await chatbotService.getHistory(req.user.id, req.query.sessionId);
    return success(res, 200, history);
  }),

  listSessions: catchAsync(async (req, res) => {
    const sessions = await chatbotService.listSessions(req.user.id);
    return success(res, 200, sessions);
  }),
};

module.exports = chatbotController;
