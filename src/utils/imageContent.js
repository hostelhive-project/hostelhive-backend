const AppError = require('./AppError');

module.exports = function imageContent(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new AppError('An image file is required.', 400);
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { extension: '.png', mime: 'image/png' };
  if (buffer.length >= 4 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return { extension: '.jpg', mime: 'image/jpeg' };
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return { extension: '.webp', mime: 'image/webp' };
  throw new AppError('The file contents are not a supported JPG, PNG or WEBP image.', 400);
};
