import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { askN8nCoach, isN8nCoachConfigured } from '@/lib/orchestrator';

/**
 * The n8n orchestrator client. Covers the source pass-through the UI relies on
 * for its source chips, plus the failure paths that trigger the in-process fallback.
 */

const URL = 'https://n8n.example/webhook/coach-chat';

function respondWith(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

beforeEach(() => {
  process.env.N8N_COACH_URL = URL;
});

afterEach(() => {
  delete process.env.N8N_COACH_URL;
  vi.unstubAllGlobals();
});

describe('isN8nCoachConfigured', () => {
  it('is true only when the coach URL is set', () => {
    expect(isN8nCoachConfigured()).toBe(true);
    delete process.env.N8N_COACH_URL;
    expect(isN8nCoachConfigured()).toBe(false);
  });
});

describe('askN8nCoach', () => {
  it('passes through the answer and the sources the workflow reports', async () => {
    respondWith({ answer: 'CoolSculpting needs attention.', sources: ['clinic customer data'] });
    const result = await askN8nCoach('Which treatment needs attention?');
    expect(result.answer).toBe('CoolSculpting needs attention.');
    expect(result.sources).toEqual(['clinic customer data']);
  });

  it('defaults sources to [] when the workflow omits them (older responses)', async () => {
    respondWith({ output: 'Here is the policy.' });
    const result = await askN8nCoach('What is the cancellation policy?');
    expect(result.answer).toBe('Here is the policy.');
    expect(result.sources).toEqual([]);
  });

  it('keeps only string sources, ignoring anything malformed', async () => {
    respondWith({ answer: 'A', sources: ['uploaded clinic documents', 42, null, 'clinic customer data'] });
    const result = await askN8nCoach('q');
    expect(result.sources).toEqual(['uploaded clinic documents', 'clinic customer data']);
  });

  it('throws on a non-2xx so the caller can fall back', async () => {
    respondWith({ error: 'boom' }, 500);
    await expect(askN8nCoach('q')).rejects.toThrow(/500/);
  });

  it('throws on an empty answer so the caller can fall back', async () => {
    respondWith({ answer: '   ' });
    await expect(askN8nCoach('q')).rejects.toThrow(/empty/);
  });
});
