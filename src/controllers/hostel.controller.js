const catchAsync = require('../utils/catchAsync');
const { success } = require('../utils/response');
const hostelService = require('../services/hostel.service');
const roomService = require('../services/room.service');


const hostelController = {
  create: catchAsync(async (req, res) => {
    return success(res, 201, await hostelService.createForOwner(req.body, req.user), 'Hostel created');
  }),

  search: catchAsync(async (req, res) => {
    const hostels = await hostelService.search(req.query);
    return success(res, 200, hostels);
  }),

  searchExplore: catchAsync(async (req, res) => {
    const result = await hostelService.searchExplore(req.query);
    return success(res, 200, result);
  }),

  getById: catchAsync(async (req, res) => {
    const hostel = await hostelService.getForViewer(req.params.id, await require('../services/auth.service').resolveOptionalUser(req.headers.authorization || ''));
    return success(res, 200, hostel);
  }),

  update: catchAsync(async (req, res) => {
    const hostel = await hostelService.update(req.params.id, req.body);
    return success(res, 200, hostel, 'Hostel updated');
  }),

  remove: catchAsync(async (req, res) => {
    await hostelService.remove(req.params.id);
    return success(res, 200, null, 'Hostel and associated rooms deleted');
  }),

  listRooms: catchAsync(async (req, res) => {
    await hostelService.getForViewer(req.params.id, await require('../services/auth.service').resolveOptionalUser(req.headers.authorization || ''));
    const rooms = await roomService.listByHostel(req.params.id, {
      availableOnly: req.query.available === 'true',
    });
    return success(res, 200, rooms);
  }),

  roomCatalog: catchAsync(async (req, res) => {
    return success(res, 200, await roomService.getCatalog(req.params.id));
  }),

  roomOptions: catchAsync(async (req, res) => {
    return success(res, 200, await roomService.getOptions(req.params.id, req.query));
  }),

  publish: catchAsync(async (req, res) => success(res, 200, await hostelService.publish(req.params.id), 'Hostel published')),

  // Admin's "one-page form" that grounds the AI chatbot's answers for this
  // hostel — see chatbot.service.js's buildSystemPrompt().
  // AI Chatbot Knowledge — updates chatbot-specific knowledge (wifiPassword, emergencyContact, additionalInfo)
  updateChatbotInfo: catchAsync(async (req, res) => {
    return success(res, 200, await hostelService.updateChatbotInfo(req.params.hostelId, req.body));
  }),

  getChatbotInfo: catchAsync(async (req, res) => {
    return success(res, 200, await hostelService.getChatbotInfo(req.params.hostelId, await require('../services/auth.service').resolveOptionalUser(req.headers.authorization || '')));
  }),
};

module.exports = hostelController;
