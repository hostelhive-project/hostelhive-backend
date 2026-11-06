const AppError = require('../utils/AppError');
const integration = require('../integrations/imagekit');
const repository = require('../repositories/upload.repository');
const imageContent = require('../utils/imageContent');
const { canonicalUrl, signDocumentUrl } = require('../utils/privateMedia');

module.exports = {
  async upload(file, user, folder = '/hostels') {
    if (!file) throw new AppError('Please select an image file to upload.', 400);
    const allowed = ['/hostels', '/profiles', '/cnic', '/complaints', '/cleaning'];
    if (!allowed.includes(folder)) throw new AppError('Unsupported upload folder.', 400);
    if (folder === '/cnic' && user.role !== 'Student') throw new AppError('Only students can upload identity documents.', 403);
    if (folder === '/hostels' && user.role !== 'Admin') throw new AppError('Only administrators can upload property images.', 403);
    const type = imageContent(file.buffer);
    const privateFile = folder === '/cnic';
    const result = await integration.uploadToImageKit({ fileBuffer: file.buffer,
      fileName: 'image' + type.extension, folder: privateFile ? `${folder}/${user.id}` : folder, isPrivate: privateFile });
    if (result.isSimulated) return { ...result, isSimulated: true };
    const url = canonicalUrl(result.url);
    try {
      await repository.create({ ownerId: user.id, fileId: result.fileId, url, isPrivate: privateFile, size: file.size || file.buffer.length });
    } catch (error) {
      // Do not leave an untracked upload after a metadata persistence failure.
      await integration.deleteFromImageKit(result.fileId).catch(() => {});
      throw error;
    }
    return { ...result, url: privateFile ? signDocumentUrl(url) : url, isPrivate: privateFile };
  },
  async resolveOwnedDocument(userId, value) {
    if (!value) return value;
    let url;
    try { url = canonicalUrl(value); } catch { throw new AppError('Invalid identity-document URL.', 400); }
    if (!await repository.ownedPrivate(userId, url)) throw new AppError('Re-upload your identity document using this account before submitting.', 400);
    return url;
  },
};
