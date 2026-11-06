const crypto = require('crypto');
const env = require('../config/env');
const uploads = require('../repositories/upload.repository');
const imageContent = require('../utils/imageContent');

const MAX_BYTES = 5 * 1024 * 1024;

async function loadPhoto(value, staffId) {
  // Never fetch an arbitrary URL from a submitted task, or forward private CNIC images to Groq.
  let url, endpoint;
  try { url = new URL(value); endpoint = new URL(env.integrations.imagekit.urlEndpoint); }
  catch { throw new Error('unsupported_photo'); }
  const cleaningPath = `${endpoint.pathname.replace(/\/$/, '')}/cleaning/`;
  if (url.protocol !== 'https:' || url.origin !== endpoint.origin || !url.pathname.startsWith(cleaningPath) ||
      url.username || url.password || url.search || url.hash) throw new Error('unsupported_photo');
  const record = await uploads.ownedPublic(staffId, url.href);
  if (!record || record.size > MAX_BYTES || record.size <= 0) throw new Error('unsupported_photo');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let reader;
  try {
    const response = await fetch(url.href, { signal: controller.signal, redirect: 'error' });
    if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_BYTES) {
      await response.body?.cancel();
      throw new Error('photo_unavailable');
    }
    reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    let result = await reader.read();
    while (!result.done) {
      const chunk = result.value;
      size += chunk.byteLength;
      if (size > MAX_BYTES) throw new Error('unsupported_photo');
      chunks.push(Buffer.from(chunk));
      result = await reader.read();
    }
    const buffer = Buffer.concat(chunks);
    const { mime } = imageContent(buffer);
    return { hash: crypto.createHash('sha256').update(buffer).digest('hex'), dataUrl: `data:${mime};base64,${buffer.toString('base64')}` };
  } finally {
    clearTimeout(timeout);
    if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
}

async function loadPair(task) {
  if (!task.beforeImageUri || !task.afterImageUri) throw new Error('missing_photos');
  // Sequential reads bound memory and avoid dangling downloads after the first failure.
  const before = await loadPhoto(task.beforeImageUri, task.assignedStaffId);
  const after = task.beforeImageUri === task.afterImageUri ? before : await loadPhoto(task.afterImageUri, task.assignedStaffId);
  return { before: before.dataUrl, after: after.dataUrl,
    identicalPhotos: before.hash === after.hash,
    pairHash: crypto.createHash('sha256').update(`${before.hash}:${after.hash}`).digest('hex') };
}

module.exports = { loadPair };
