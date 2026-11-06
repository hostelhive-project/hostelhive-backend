const mongoose = require('mongoose');
const catchAsync = require('../utils/catchAsync');
const { success } = require('../utils/response');
const AppError = require('../utils/AppError');
const blockchainService = require('../services/blockchain.service');

const blockchainController = {
  verify: catchAsync(async (req, res) => {
    const { sourceType, sourceId } = req.params;

    if (!['Payment', 'Complaint'].includes(sourceType)) {
      throw new AppError('Invalid source type. Blockchain records are only maintained for "Payment" and "Complaint".', 400);
    }

    if (!mongoose.Types.ObjectId.isValid(sourceId)) {
      throw new AppError('Invalid source identifier format.', 400);
    }

    return success(res, 200, await blockchainService.verify(sourceType, sourceId, req.user));
  }),
};

module.exports = blockchainController;
