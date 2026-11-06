const catchAsync = require('../utils/catchAsync');
const { success } = require('../utils/response');
const complaintService = require('../services/complaint.service');

const complaintController = {
  create: catchAsync(async (req, res) => {
    const complaint = await complaintService.create(req.body, req.user.id);
    return success(res, 201, complaint, 'Complaint registered');
  }),

  getById: catchAsync(async (req, res) => {
    const complaint = await complaintService.getById(req.params.id, req.user);
    return success(res, 200, complaint);
  }),

  myComplaints: catchAsync(async (req, res) => {
    const complaints = await complaintService.listForResident(req.user.id);
    return success(res, 200, complaints);
  }),

  assignedToMe: catchAsync(async (req, res) => {
    const complaints = await complaintService.listAssignedToStaff(req.user.id);
    return success(res, 200, complaints);
  }),

  markFixed: catchAsync(async (req, res) => {
    const complaint = await complaintService.markFixed(req.params.id, req.user.id, req.body);
    return success(res, 200, complaint, 'Complaint submitted for admin verification');
  }),

  confirmResolved: catchAsync(async (req, res) => {
    const complaint = await complaintService.confirmResolved(req.params.id, req.user.id);
    return success(res, 200, complaint, 'Resolution confirmed');
  }),

  reopen: catchAsync(async (req, res) => {
    const complaint = await complaintService.reopen(req.params.id, req.user.id);
    return success(res, 200, complaint, 'Complaint reopened');
  }),

  listAll: catchAsync(async (req, res) => {
    const complaints = await complaintService.listAll(req.query, req.user);
    return success(res, 200, complaints);
  }),

  assign: catchAsync(async (req, res) => {
    const complaint = await complaintService.assign(req.params.id, req.body.staffId, req.user);
    return success(res, 200, complaint, 'Complaint assigned to staff');
  }),

  updateStatus: catchAsync(async (req, res) => {
    const complaint = await complaintService.updateStatus(req.params.id, req.body.status, req.user);
    return success(res, 200, complaint, 'Complaint status updated');
  }),
};

module.exports = complaintController;

