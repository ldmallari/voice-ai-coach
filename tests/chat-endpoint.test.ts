import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Integration test for the chat route's orchestration branch.
 *
 * With N8N_COACH_URL set, the turn must be answered by the n8n workflow (mocked
 * here) rather than the in-process agent — proving n8n is the primary path.
 */

async function loadRoute() {
  vi.resetModules();
  return import('@/app/api/chat/route');
}

function chatRequest(body: unknown) {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.DEEPSEEK_API_KEY = 'test-deepseek-key';
  process.env.N8N_COACH_URL = 'https://n8n.example/webhook/coach-chat';
  // Force the synthetic dataset so loadRecords never touches the network.
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

afterEach(() => {
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.N8N_COACH_URL;
  vi.unstubAllGlobals();
});

describe('POST /api/chat', () => {
  it('returns 503 when the LLM is not configured', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const { POST } = await loadRoute();
    const response = await POST(chatRequest({ question: 'hi' }));
    expect(response.status).toBe(503);
  });

  it('rejects an empty question', async () => {
    const { POST } = await loadRoute();
    const response = await POST(chatRequest({ question: '' }));
    expect(response.status).toBe(400);
  });

  it('answers via the n8n orchestrator when it is configured', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ answer: 'CoolSculpting needs attention.' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { POST } = await loadRoute();
    const response = await POST(chatRequest({ question: 'Which treatment needs attention?' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.answer).toBe('CoolSculpting needs attention.');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://n8n.example/webhook/coach-chat',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
