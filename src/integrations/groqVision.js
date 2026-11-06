const env = require('../config/env');
const { PROMPT } = require('../utils/cleaningAssessment');

// No SDK, browser key, paid fallback or changes to the existing text chatbot.
async function assessCleaning(before, after) {
  if (!env.integrations.groq.apiKey) throw new Error('Groq is not configured.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${env.integrations.groq.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.integrations.groq.apiKey}` },
      body: JSON.stringify({
        model: env.integrations.cleaningAi.model,
        temperature: 0.1, max_completion_tokens: 1200,
        ...(env.integrations.cleaningAi.model === 'qwen/qwen3.8-27b' ? { reasoning_effort: 'none' } : {}),
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: PROMPT },
          { role: 'user', content: [
            { type: 'text', text: 'BEFORE cleaning:' },
            { type: 'image_url', image_url: { url: before } },
            { type: 'text', text: 'AFTER cleaning. Compare only the visible evidence and return the specified JSON:' },
            { type: 'image_url', image_url: { url: after } },
          ] },
        ],
      }),
    });
    if (!response.ok) {
      // Do not persist provider response bodies: they can contain URLs, credentials or photo content.
      await response.body?.cancel();
      const error = new Error(`Groq vision request failed (${response.status}).`);
      error.status = response.status;
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    }
    const data = await response.json();
    const choice = data.choices?.[0];
    if (choice?.finish_reason !== 'stop' || typeof choice.message?.content !== 'string') {
      throw new Error('Groq returned an incomplete assessment.');
    }
    return choice.message.content;
  } finally { clearTimeout(timeout); }
}

module.exports = { assessCleaning };
