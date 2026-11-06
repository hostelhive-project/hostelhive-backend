const catchAsync = require('../utils/catchAsync');
const { success } = require('../utils/response');
const cleaningTaskService = require('../services/cleaningTask.service');

const cleaningTaskController = {
  assign: catchAsync(async (req, res) => {
    const task = await cleaningTaskService.assign(req.body, req.user);
    return success(res, 201, task, 'Cleaning task assigned');
  }),

  getById: catchAsync(async (req, res) => {
    const task = await cleaningTaskService.getById(req.params.id, req.user);
    return success(res, 200, task);
  }),

  myTasks: catchAsync(async (req, res) => {
    const tasks = await cleaningTaskService.listForStaff(req.user.id, req.query.status);
    return success(res, 200, tasks);
  }),

  start: catchAsync(async (req, res) => {
    const task = await cleaningTaskService.start(req.params.id, req.user.id, req.body);
    return success(res, 200, task, 'Task marked in progress');
  }),

  complete: catchAsync(async (req, res) => {
    const task = await cleaningTaskService.complete(req.params.id, req.user.id, req.body);
    return success(res, 200, task, 'Task marked complete');
  }),

  delay: catchAsync(async (req, res) => {
    const task = await cleaningTaskService.delay(req.params.id, req.user.id, req.body.reason);
    return success(res, 200, task, 'Task marked delayed');
  }),

  listForHostel: catchAsync(async (req, res) => {
    const tasks = await cleaningTaskService.listForHostel(req.params.hostelId, req.query.status);
    return success(res, 200, tasks);
  }),

  broadcastDirective: catchAsync(async (req, res) => {
    const result = await cleaningTaskService.broadcastDirective(req.user, req.body.directive);
    return success(res, 200, result, result.message);
  }),

  getDirective: catchAsync(async (req, res) => {
    const result = await cleaningTaskService.getDirective(req.user);
    return success(res, 200, result);
  }),
};

module.exports = cleaningTaskController;
