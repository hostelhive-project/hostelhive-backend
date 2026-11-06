const catchAsync = require('../utils/catchAsync');
const { success } = require('../utils/response');
const roomService = require('../services/room.service');

const roomController = {
  create: catchAsync(async (req, res) => {
    const room = await roomService.create({ ...req.body, hostelId: req.params.id });
    return success(res, 201, room, 'Room created');
  }),

  getById: catchAsync(async (req, res) => {
    const room = await roomService.getById(req.params.id);
    return success(res, 200, room);
  }),

  update: catchAsync(async (req, res) => {
    const room = await roomService.update(req.params.id, req.body);
    return success(res, 200, room, 'Room updated');
  }),

  updateStatus: catchAsync(async (req, res) => {
    const room = await roomService.updateStatus(req.params.id, req.body);
    return success(res, 200, room);
  }),

  remove: catchAsync(async (req, res) => {
    await roomService.remove(req.params.id);
    return success(res, 200, null, 'Room removed successfully');
  }),
};

module.exports = roomController;
