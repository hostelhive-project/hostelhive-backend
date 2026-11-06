const ImageKit = require('imagekit');
const crypto = require('crypto');
const path = require('path');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const imageContent = require('../utils/imageContent');

let imagekitInstance = null;
let initAttempted = false;

/**
 * Initializes the ImageKit SDK client if credentials are configured in .env.
 * Uploads require configured storage; simulation is restricted to explicitly
 * enabled development/test public images, never identity documents.
 */
function getImageKitClient() {
  if (imagekitInstance) return imagekitInstance;

  const { publicKey, privateKey, urlEndpoint } = env.integrations.imagekit || {};

  if (publicKey && privateKey && urlEndpoint) {
    try {
      imagekitInstance = new ImageKit({
        publicKey,
        privateKey,
        urlEndpoint,
      });
      // eslint-disable-next-line no-console
      console.log(`[imagekit] ImageKit client successfully initialized with endpoint: ${urlEndpoint}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[imagekit] Failed to initialize ImageKit client:', err.message);
      imagekitInstance = null;
    }
  } else if (!initAttempted) {
    initAttempted = true;
    // eslint-disable-next-line no-console
    console.warn(
      '[imagekit] Image storage credentials are missing. Real uploads are unavailable.'
    );
  }

  return imagekitInstance;
}

/**
 * Uploads an image buffer directly to ImageKit CDN.
 *
 * @param {Object} options
 * @param {Buffer} options.fileBuffer - Raw file buffer from Multer memory storage
 * @param {string} options.fileName - Original file name
 * @param {string} [options.folder='/hostels'] - ImageKit storage folder
 * @returns {Promise<{ url: string, fileId: string, name: string }>}
 */
async function uploadToImageKit({ fileBuffer, fileName, folder = '/hostels', isPrivate = false }) {
  const client = module.exports.getImageKitClient();
  const cleanExt = imageContent(fileBuffer).extension;
  const baseName = path.basename(fileName, cleanExt).replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeFileName = `${Date.now()}-${baseName}${cleanExt}`;

  if (client) {
    const uploadResult = await client.upload({
      file: fileBuffer,
      fileName: safeFileName,
      folder,
      useUniqueFileName: true,
      isPrivateFile: isPrivate,
    });

    return {
      url: uploadResult.url,
      fileId: uploadResult.fileId,
      name: uploadResult.name,
      thumbnailUrl: uploadResult.thumbnailUrl,
    };
  }

  if (isPrivate || env.nodeEnv === 'production' || (env.nodeEnv !== 'test' && process.env.ALLOW_SIMULATED_UPLOADS !== 'true')) {
    throw new AppError('Image storage is not configured. Please contact the administrator.', 503);
  }
  // Explicit development/test simulation only; callers retain its flag.
  const endpoint = (env.integrations.imagekit?.urlEndpoint || 'https://ik.imagekit.io/hostelhive').replace(/\/+$/, '');
  const cleanFolder = folder.replace(/^\/+/, '');
  const simUrl = `${endpoint}/${cleanFolder}/${safeFileName}`;

  return {
    url: simUrl,
    fileId: `sim-ik-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    name: safeFileName,
    isSimulated: true,
  };
}

/**
 * Deletes a file from ImageKit by fileId.
 *
 * @param {string} fileId
 * @returns {Promise<boolean>}
 */
async function deleteFromImageKit(fileId) {
  if (!fileId || fileId.startsWith('sim-ik-')) return true;

  const client = getImageKitClient();
  if (!client) return true;

  try {
    await client.deleteFile(fileId);
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[imagekit] Failed to delete file ${fileId}:`, err.message);
    return false;
  }
}

module.exports = {
  getImageKitClient,
  uploadToImageKit,
  deleteFromImageKit,
};
