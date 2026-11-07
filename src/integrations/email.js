const env = require('../config/env');
const AppError = require('../utils/AppError');
const { parseEmailSender } = require('../utils/emailSender');

function brevoFailure(code) {
  const error = new Error('Brevo email delivery failed.');
  error.emailDeliveryCode = code;
  return error;
}

async function sendBrevoEmail(message) {
  const sender = parseEmailSender(env.email.from);
  if (!env.email.brevoApiKey || !sender) throw brevoFailure('BREVO_NOT_CONFIGURED');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.email.apiTimeoutMs);
  try {
    // Fixed HTTPS endpoint and no redirects keep the API key with Brevo only.
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      redirect: 'error',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': env.email.brevoApiKey,
      },
      signal: controller.signal,
      body: JSON.stringify({
        sender,
        to: [{ email: message.to }],
        subject: message.subject,
        textContent: message.text,
        htmlContent: message.html,
      }),
    });
    if (response.status !== 201) {
      // Release the response without reading/logging provider bodies or recipients.
      await response.body?.cancel();
      throw brevoFailure(`BREVO_HTTP_${response.status}`);
    }
    const result = await response.json();
    if (typeof result?.messageId !== 'string' || !result.messageId.trim()) {
      throw brevoFailure('BREVO_INVALID_RESPONSE');
    }
    // Acceptance is not proof of inbox delivery; use Brevo's transactional logs.
    // No automatic retries: an ambiguous timeout may already have sent it.
  } finally {
    clearTimeout(timeout);
  }
}

async function sendOtpEmail(email, otp, purpose) {
  const isPasswordReset = purpose === 'password-reset';
  const isStaffInvite = purpose === 'staff-invite';
  const subject = isPasswordReset
    ? 'HostelHive password reset code'
    : isStaffInvite
      ? 'Activate your HostelHive staff account'
      : 'Verify your HostelHive email';
  const action = isPasswordReset
    ? 'reset your password'
    : isStaffInvite
      ? 'activate your cleaning staff account'
      : 'verify your email address';
  const staffInviteInstructions = isStaffInvite
    ? ' Open the HostelHive mobile app, choose “Have a staff invitation? Activate your account”, enter this code, and set your password.'
    : '';

  try {
    const message = {
      to: email,
      subject,
      text: `Your HostelHive code to ${action} is ${otp}. It expires in 90 seconds.${staffInviteInstructions} If you did not request this, ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#0b1329"><h2>HostelHive</h2><p>Use this code to ${action}:</p><p style="font-size:30px;font-weight:bold;letter-spacing:8px">${otp}</p><p>This code expires in 90 seconds.${isStaffInvite ? ' Open the HostelHive mobile app, choose “Have a staff invitation? Activate your account”, enter this code, and set your password.' : ''}</p><p>If you did not request this, you can ignore this email.</p></div>`,
    };
    await sendBrevoEmail(message);
  } catch (error) {
    // Do not expose keys, OTPs, recipients or provider response bodies.
    const code = error.emailDeliveryCode || (error.name === 'AbortError' ? 'BREVO_TIMEOUT' : 'BREVO_ERROR');
    // eslint-disable-next-line no-console
    console.error('[email] Could not send OTP email:', code);
    throw new AppError('Could not send the email right now. Check the email configuration and try again.', 503);
  }
}

module.exports = { sendOtpEmail };
