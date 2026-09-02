import OpenAI from 'openai';

/**
 * LLM client.
 *
 * DeepSeek exposes an OpenAI-compatible chat completions API, so the official
 * OpenAI SDK is used with a different base URL. Keeping this in one place means
 * swapping provider later is a base URL and a model name, not a rewrite.
 */

/**
 * Explicitly listed by the account's /models endpoint. `deepseek-chat` also works
 * but is an unlisted alias, so it is avoided here. Flash answers in roughly half
 * the time of pro on tool-calling turns, which matters for perceived latency.
 */
export const COACH_MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash';

export function llmClient(): OpenAI {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not set.');

  return new OpenAI({
    apiKey,
    baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
  });
}

export function isLlmConfigured(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}
