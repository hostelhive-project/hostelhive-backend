const catchAsync = require('../utils/catchAsync');
const { success } = require('../utils/response');
const AppError = require('../utils/AppError');
const uploadService = require('../services/upload.service');
module.exports = {
  uploadSingle: catchAsync(async (req, res) => {
    const result = await uploadService.upload(req.file, req.user, req.body.folder || '/hostels');
    return success(res, 200, result, result.isSimulated ? 'Development simulation: no file was stored' : 'Image uploaded successfully');
  }),
  uploadMultiple: catchAsync(async (req, res) => {
    if (!req.files?.length) throw new AppError('Please select images to upload.', 400);
    const files = [];
    for (const file of req.files) files.push(await uploadService.upload(file, req.user, '/hostels'));
    return success(res, 200, { files, urls: files.map(file => file.url), isSimulated: files.some(file => file.isSimulated) },
      files.some(file => file.isSimulated) ? 'Development simulation: no files were stored' : 'Images uploaded successfully');
  }),
};
