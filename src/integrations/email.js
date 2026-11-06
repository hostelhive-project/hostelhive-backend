const nodemailer = require('nodemailer');
const env = require('../config/env');
const AppError = require('../utils/AppError');

let transporter;

function getTransporter() {
  const user = (env.email.user || '').trim();
  const password = (env.email.password || '').replace(/\s/g, '');
  if (!user || !password) {
    throw new AppError('Email delivery is not configured. Set EMAIL_USER and EMAIL_APP_PASSWORD.', 503);
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.email.host,
      port: env.email.port,
      secure: env.email.port === 465,
      auth: {
        user,
        pass: password,
      },
    });
  }

  return transporter;
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
    await getTransporter().sendMail({
      from: env.email.from || `HostelHive <${(env.email.user || '').trim()}>`,
      to: email,
      subject,
      text: `Your HostelHive code to ${action} is ${otp}. It expires in 90 seconds.${staffInviteInstructions} If you did not request this, ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#0b1329"><h2>HostelHive</h2><p>Use this code to ${action}:</p><p style="font-size:30px;font-weight:bold;letter-spacing:8px">${otp}</p><p>This code expires in 90 seconds.${isStaffInvite ? ' Open the HostelHive mobile app, choose “Have a staff invitation? Activate your account”, enter this code, and set your password.' : ''}</p><p>If you did not request this, you can ignore this email.</p></div>`,
    });
  } catch (error) {
    // Do not expose SMTP credentials or provider details to API clients.
    // eslint-disable-next-line no-console
    console.error('[email] Could not send OTP email:', error.message);
    throw new AppError('Could not send the email right now. Check the email configuration and try again.', 503);
  }
}

module.exports = { sendOtpEmail };
