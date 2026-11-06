const env = require('../config/env');
const repository = require('../repositories/cleaningAssessment.repository');
const photos = require('./cleaningPhotos.service');
const groq = require('../integrations/groqVision');
const { PROMPT_VERSION, parseAssessment } = require('../utils/cleaningAssessment');

// Only the outbox worker calls this service. No public endpoint accepts prompts, models or scores.
async function processAssessment({ taskId }) {
  const task = await repository.claim(taskId);
  if (!task) {
    const existing = await repository.find(taskId);
    // A previous worker may still own an unexpired claim. Never complete its job prematurely.
    return existing?.status === 'Completed' && ['Pending', 'Processing'].includes(existing.cleaningAssessment?.status)
      ? { retryAt: new Date(Date.now() + 125000) } : {};
  }
  const finish = (result) => repository.finish(task, { ...result, startedAt: null });
  const unavailable = (reason) => finish({ status: 'Unavailable', score: null, reason });
  const config = env.integrations.cleaningAi;
  if (!config.enabled) { await unavailable('disabled'); return {}; }
  if (!env.integrations.groq.apiKey) { await unavailable('not_configured'); return {}; }
  if (config.dailyLimit === 0) { await unavailable('daily_limit'); return {}; }
  if (task.cleaningAssessment.attempts >= 2) { await unavailable('attempt_limit'); return {}; }
  if (Date.now() - new Date(task.cleaningAssessment.queuedAt).getTime() > 30 * 60000) {
    await unavailable('queue_timeout'); return {};
  }
  let pair;
  try { pair = await photos.loadPair(task); }
  catch (error) {
    const reason = ['missing_photos', 'unsupported_photo'].includes(error.message) ? error.message : 'photo_unavailable';
    await finish({ status: 'Unavailable', score: null, reason });
    return {};
  }
  const budget = await repository.reserve(config.dailyLimit);
  if (!budget.allowed) {
    if (budget.exhausted) { await unavailable('daily_limit'); return {}; }
    await finish({ status: 'Pending', reason: 'queued' });
    return { retryAt: budget.retryAt };
  }
  const attempt = await repository.beginAttempt(task);
  if (!attempt) return { retryAt: new Date(Date.now() + 125000) };
  let result;
  try {
    result = parseAssessment(await groq.assessCleaning(pair.before, pair.after), { identicalPhotos: pair.identicalPhotos });
  } catch (error) {
    // Retry only temporary failures once. Invalid responses or configuration errors are unavailable.
    const retryable = error.retryable || error.name === 'AbortError' || error.name === 'TypeError';
    if (retryable && attempt.cleaningAssessment.attempts < 2) {
      await finish({ status: 'Pending', score: null, reason: 'temporary_failure', pairHash: pair.pairHash });
      return { retryAt: new Date(Date.now() + 65000) };
    }
    await unavailable(error.status === 429 ? 'provider_limit' : 'provider_error');
    return {};
  }
  // Persistence failures are handled by the durable worker, not mistaken for provider errors.
  await finish({ ...result, pairHash: pair.pairHash, model: config.model,
    promptVersion: PROMPT_VERSION, assessedAt: new Date() });
  return {};
}

module.exports = { processAssessment };
