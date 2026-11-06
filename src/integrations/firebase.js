const env = require('../config/env');

let messaging = null;
let initAttempted = false;

/**
 * Lazily initializes firebase-admin only if credentials are present in .env.
 * FCM is free (no cost concern), but it's still optional infrastructure —
 * the in-app Notification inbox (see notification.service.js) is the real,
 * always-working feature. Push is a best-effort bonus on top of it: if
 * Firebase isn't configured, or a push send fails, we log and move on
 * rather than let it break the underlying notification write.
 */
function getMessaging() {
  if (initAttempted) return messaging;
  initAttempted = true;

  const { projectId, clientEmail, privateKey } = env.integrations.firebase;
  if (!projectId || !clientEmail || !privateKey) {
    // eslint-disable-next-line no-console
    console.warn('[firebase] Not configured — push notifications disabled, in-app inbox still works.');
    return null;
  }

  try {
    // Required only if Firebase is actually configured — keeps it out of
    // the dependency tree's "always loaded" path.
    // eslint-disable-next-line global-require
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey: privateKey.replace(/\\n/g, '\n'),
        }),
      });
    }
    messaging = admin.messaging();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[firebase] Failed to initialize:', err.message);
    messaging = null;
  }

  return messaging;
}

/**
 * Sends a push notification if a device token is provided and Firebase is
 * configured. Swallows all errors — push is best-effort, never a reason to
 * fail the caller's request.
 */
async function sendPush({ deviceToken, title, body, data = {} }) {
  if (!deviceToken) return { sent: false, reason: 'no device token on file' };

  const client = getMessaging();
  if (!client) return { sent: false, reason: 'firebase not configured' };

  try {
    await client.send({ token: deviceToken, notification: { title, body }, data });
    return { sent: true };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[firebase] Push send failed:', err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendPush };
