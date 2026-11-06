const env = require('../config/env');

/**
 * Groq exposes an OpenAI-compatible /chat/completions endpoint, so this is a
 * plain fetch wrapper rather than a dedicated SDK — one less dependency.
 * Lazily checked (not at import time) so the app boots even before a real
 * GROQ_API_KEY is set; the error only surfaces when the chatbot is actually used.
 */
async function chatCompletion(messages, { temperature = 0.4, maxTokens = 500 } = {}) {
  if (!env.integrations.groq.apiKey) {
    throw new Error('GROQ_API_KEY is not set. Add it to .env — see .env.example.');
  }

  const response = await fetch(`${env.integrations.groq.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.integrations.groq.apiKey}`,
    },
    body: JSON.stringify({
      model: env.integrations.groq.model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

module.exports = { chatCompletion };
