import OpenAI from 'openai';

/**
 * LLM client.
 *
 * DeepSeek exposes an OpenAI-compatible chat completions API, so the official
 * OpenAI SDK is used with a different base URL. Keeping this in one place means
 * swapping provider later is a base URL and a model name, not a rewrite.
 */

export const COACH_MODEL = 'deepseek-chat';

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
