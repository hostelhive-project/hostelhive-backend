const env = require('../config/env');

function canonicalUrl(value) {
  if (!value) return null;
  const url = new URL(value); url.search = ''; url.hash = ''; return url.toString();
}
function signDocumentUrl(value) {
  if (!value) return value;
  try {
    const base = canonicalUrl(value);
    const endpoint = env.integrations.imagekit.urlEndpoint.replace(/\/+$/, '');
    if (!base.startsWith(endpoint + '/cnic/')) return null;
    const client = require('../integrations/imagekit').getImageKitClient();
    return client ? client.url({ src: base, signed: true, expireSeconds: 900 }) : null;
  } catch { return null; }
}
function bookingDocuments(_document, result) {
  for (const key of ['cnicFrontUrl', 'cnicBackUrl']) if (result[key]) result[key] = signDocumentUrl(result[key]);
  return result;
}
module.exports = { canonicalUrl, signDocumentUrl, bookingDocuments };
