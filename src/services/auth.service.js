const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const { signAccessToken, signRefreshToken, verifyRefreshToken, verifyAccessToken } = require('../utils/jwt');
const userRepository = require('../repositories/user.repository');
const emailIntegration = require('../integrations/email');
const authSessionRepository = require('../repositories/authSession.repository');
const { verifyRefreshToken: decodeRefreshToken } = require('../utils/jwt');

const OTP_EXPIRY_MS = 90 * 1000;
const OTP_RESEND_DELAY_MS = 90 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const REGISTRATION_TERMS_VERSION = 'v1';

function otpHash(email, purpose, otp) {
  return crypto
    .createHmac('sha256', env.jwt.secret || env.jwt.refreshSecret)
    .update(`${email}:${purpose}:${otp}`)
    .digest('hex');
}

function otpMatches(email, purpose, otp, expectedHash) {
  const candidate = Buffer.from(otpHash(email, purpose, otp), 'hex');
  const expected = Buffer.from(expectedHash || '', 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function generateOtp() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

async function issueOtp(user, purpose, { respectCooldown = true } = {}) {
  const now = new Date();
  if (
    respectCooldown &&
    user.emailOtpSentAt &&
    now.getTime() - user.emailOtpSentAt.getTime() < OTP_RESEND_DELAY_MS
  ) {
    throw new AppError('Please wait 90 seconds before requesting another code.', 429);
  }

  const otp = generateOtp();
  const hash = otpHash(user.email, purpose, otp);
  const updated = await userRepository.setOtp(user._id, {
    email: user.email, emailOtpPurpose: purpose, emailOtpHash: hash,
    emailOtpExpiresAt: new Date(now.getTime() + OTP_EXPIRY_MS), emailOtpSentAt: now, emailOtpAttempts: 0,
  }, respectCooldown ? new Date(now.getTime() - OTP_RESEND_DELAY_MS) : null);
  if (!updated) throw new AppError('Please wait 90 seconds before requesting another code.', 429);
  try {
    await emailIntegration.sendOtpEmail(user.email, otp, purpose);
  } catch (error) {
    await userRepository.clearOtpIfCurrent(user._id, hash);
    throw error;
  }
}

async function validateOtp(user, purpose, otp) {
  if (user.emailOtpAttempts >= OTP_MAX_ATTEMPTS) {
    throw new AppError('Too many incorrect codes. Request a new code and try again.', 429);
  }

  const isValid =
    user.emailOtpPurpose === purpose &&
    user.emailOtpExpiresAt &&
    user.emailOtpExpiresAt.getTime() > Date.now() &&
    user.emailOtpHash &&
    otpMatches(user.email, purpose, otp, user.emailOtpHash);

  if (!isValid) {
    await userRepository.recordOtpFailure(user._id, user.emailOtpHash);
    throw new AppError('The code is invalid or expired. Request a new code and try again.', 400);
  }
}

async function issueTokens(user) {
  const payload = { sub: user._id.toString(), role: user.role, ver: user.sessionVersion || 0 };
  const id = crypto.randomUUID();
  const refreshToken = signRefreshToken({ ...payload, jti: id });
  const decoded = decodeRefreshToken(refreshToken);
  await authSessionRepository.create({ _id: id, userId: user._id,
    tokenHash: crypto.createHash('sha256').update(refreshToken).digest('hex'), expiresAt: new Date(decoded.exp * 1000),
  });
  return { accessToken: signAccessToken(payload), refreshToken };
}

const authService = {
  async resolveOptionalUser(header) {
  const parts = header.trim().split(/\s+/);
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer' && parts[1]) {
    try {
      const decoded = verifyAccessToken(parts[1]);
      const user = await userRepository.findById(decoded.sub).select('+sessionVersion');
      if (user && user.isActive && user.emailVerified && (decoded.ver || 0) === (user.sessionVersion || 0)) {
        return {
          id: user._id.toString(),
          _id: user._id.toString(),
          role: user.role,
          hostelId: user.hostelId ? user.hostelId.toString() : null,
        };
      }
    } catch {
      // ignore
    }
  }
  return null;
},
  /**
   * Self-registration stores an unverified account and emails a one-time code.
   * Tokens are issued only after verifyEmail confirms that code.
   */
  async register({ name, email, password, role, phone, regNumber, hostelId, termsAccepted }) {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await userRepository.findByEmail(normalizedEmail, { withOtp: true });
    if (existing) {
      if (existing.emailVerified) {
        throw new AppError('An account with this email already exists', 409);
      }
      if (existing.role === 'CleaningStaff' && !existing.isActive) {
        throw new AppError('This email has a pending staff invitation. Use “Have a staff invitation?” on the sign-in screen to activate it.', 409);
      }
    }

    const passwordHash = await bcrypt.hash(password, env.bcryptSaltRounds);
    const otp = generateOtp();
    const hash = otpHash(normalizedEmail, 'signup', otp);
    const now = new Date();
    // Credentials and their challenge are replaced together. An older code
    // cannot activate a password supplied by a different registration attempt.
    const user = await userRepository.replacePendingSignup(normalizedEmail, {
      name,
      email: normalizedEmail,
      passwordHash,
      role,
      phone,
      regNumber,
      registrationTermsAcceptedAt: termsAccepted === true ? new Date() : null,
      registrationTermsVersion: termsAccepted === true ? REGISTRATION_TERMS_VERSION : null,
      hostelId: hostelId || null,
      emailVerified: false,
      emailOtpPurpose: 'signup', emailOtpHash: hash, emailOtpExpiresAt: new Date(now.getTime() + OTP_EXPIRY_MS),
      emailOtpSentAt: now, emailOtpAttempts: 0,
    });

    try { await emailIntegration.sendOtpEmail(normalizedEmail, otp, 'signup'); }
    catch (error) { await userRepository.clearOtpIfCurrent(user._id, hash); throw error; }
    return { email: normalizedEmail, requiresEmailVerification: true };
  },

  async verifyEmail({ email, otp }) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await userRepository.findByEmail(normalizedEmail, { withOtp: true });
    if (!user || user.emailVerified) {
      throw new AppError('The code is invalid or expired. Request a new code and try again.', 400);
    }

    await validateOtp(user, 'signup', otp);
    const verified = await userRepository.consumeOtp(user, 'signup', { emailVerified: true });
    if (!verified) throw new AppError('The code is invalid or expired. Request a new code and try again.', 400);
    return { user: verified, tokens: await issueTokens(verified) };
  },

  async sendStaffInviteCode(user) {
    await issueOtp(user, 'staff-invite', { respectCooldown: false });
  },

  async resendStaffInviteCode(user) {
    await issueOtp(user, 'staff-invite');
  },

  async activateStaffInvite({ email, otp, newPassword }) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await userRepository.findByEmail(normalizedEmail, { withOtp: true });
    if (!user || user.role !== 'CleaningStaff' || user.isActive || user.emailVerified) {
      throw new AppError('The invitation code is invalid or expired. Request a new code and try again.', 400);
    }

    await validateOtp(user, 'staff-invite', otp);
    const activated = await userRepository.consumeOtp(user, 'staff-invite', {
      passwordHash: await bcrypt.hash(newPassword, env.bcryptSaltRounds), emailVerified: true, isActive: true,
    });
    if (!activated) throw new AppError('The code is invalid or expired. Request a new code and try again.', 400);
    return { user: activated, tokens: await issueTokens(activated) };
  },

  async resendVerificationCode({ email }) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await userRepository.findByEmail(normalizedEmail, { withOtp: true });
    if (user && !user.emailVerified) {
      try {
        const purpose = user.role === 'CleaningStaff' && !user.isActive ? 'staff-invite' : 'signup';
        await issueOtp(user, purpose);
      } catch (error) {
        if (error.statusCode !== 429) throw error;
      }
    }
  },

  async requestPasswordReset({ email }) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await userRepository.findByEmail(normalizedEmail, { withOtp: true });
    if (!user || !user.emailVerified) return;

    try {
      await issueOtp(user, 'password-reset');
    } catch (error) {
      // Keep the response generic when a code was recently sent to this address.
      if (error.statusCode !== 429) throw error;
    }
  },

  async resetPassword({ email, otp, newPassword }) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await userRepository.findByEmail(normalizedEmail, { withOtp: true });
    if (!user || !user.emailVerified) {
      throw new AppError('The code is invalid or expired. Request a new code and try again.', 400);
    }

    await validateOtp(user, 'password-reset', otp);
    const reset = await userRepository.consumeOtp(user, 'password-reset', {
      passwordHash: await bcrypt.hash(newPassword, env.bcryptSaltRounds),
    }, true);
    if (!reset) throw new AppError('The code is invalid or expired. Request a new code and try again.', 400);
    await authSessionRepository.revokeAll(user._id);
  },

  async changePassword({ userId, currentPassword, newPassword }) {
    const user = await userRepository.findById(userId, { withPassword: true });
    if (!user || !user.isActive || !user.emailVerified) {
      throw new AppError('Account not found or has been deactivated.', 401);
    }

    const currentPasswordMatches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!currentPasswordMatches) {
      throw new AppError('Current password is incorrect.', 400);
    }

    const newPasswordMatches = await bcrypt.compare(newPassword, user.passwordHash);
    if (newPasswordMatches) {
      throw new AppError('New password must be different from your current password.', 400);
    }

    const updated = await userRepository.replacePassword(user._id, user.passwordHash, await bcrypt.hash(newPassword, env.bcryptSaltRounds));
    if (!updated) throw new AppError('Your credentials changed. Sign in again before changing your password.', 409);
    await authSessionRepository.revokeAll(user._id);
  },

  /**
   * SDS Fig 3, Flow A: verify credentials against stored hash -> issue signed JWT.
   */
  async login({ email, password }) {
    const user = await userRepository.findByEmail(email, { withPassword: true });
    if (!user) {
      throw new AppError('Invalid email or password', 401);
    }
    if (!user.isActive) {
      throw new AppError('This account has been deactivated', 403);
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      throw new AppError('Invalid email or password', 401);
    }
    if (!user.emailVerified) {
      throw new AppError('Please verify your email address before logging in.', 403);
    }

    return { user, tokens: await issueTokens(user) };
  },

  async refresh(refreshToken) {
    let decoded;
    try {
      decoded = verifyRefreshToken(refreshToken);
    } catch (err) {
      throw new AppError('Invalid or expired refresh token', 401);
    }

    const user = await userRepository.findById(decoded.sub);
    if (!user || !user.isActive || !user.emailVerified) {
      throw new AppError('Account not found or deactivated', 401);
    }

    if ((decoded.ver || 0) !== (user.sessionVersion || 0) || !decoded.jti) {
      throw new AppError('Your session has been revoked. Please sign in again.', 401);
    }
    const consumed = await authSessionRepository.consume(decoded.jti, user._id,
      crypto.createHash('sha256').update(refreshToken).digest('hex'));
    if (!consumed) throw new AppError('This refresh token is expired or has already been used. Please sign in again.', 401);
    return issueTokens(user);
  },
  async logout(userId) {
    await userRepository.revokeSessions(userId);
    await authSessionRepository.revokeAll(userId);
  },
};

module.exports = authService;
