import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Backend/integration test for the knowledge-upload route.
 *
 * The n8n ingest call is mocked so CI never touches the network, but the route's
 * own logic — form parsing, validation, extraction, status mapping — runs for real.
 */

const INGEST_URL = 'https://n8n.example/webhook/coach-ingest';
const PASSCODE = 'endpoint-test-pass';

async function loadRoute() {
  vi.resetModules();
  return import('@/app/api/documents/route');
}

/** Upload is gated by the admin passcode, so requests carry it by default. */
function uploadRequest(file: File | null, code: string | null = PASSCODE): Request {
  const form = new FormData();
  if (file) form.append('file', file);
  return new Request('http://localhost/api/documents', {
    method: 'POST',
    headers: code ? { 'x-admin-passcode': code } : {},
    body: form,
  });
}

beforeEach(() => {
  process.env.N8N_INGEST_URL = INGEST_URL;
  process.env.KNOWLEDGE_ADMIN_PASSCODE = PASSCODE;
});

afterEach(() => {
  delete process.env.N8N_INGEST_URL;
  delete process.env.KNOWLEDGE_ADMIN_PASSCODE;
  vi.unstubAllGlobals();
});

describe('POST /api/documents', () => {
  it('rejects an upload that omits the admin passcode', async () => {
    const { POST } = await loadRoute();
    const file = new File(['clinic knowledge base content'], 'sop.txt', { type: 'text/plain' });
    const response = await POST(uploadRequest(file, null));
    expect(response.status).toBe(401);
  });

  it('is disabled when ingest is not configured', async () => {
    delete process.env.N8N_INGEST_URL;
    const { POST } = await loadRoute();
    const file = new File(['clinic knowledge base content'], 'sop.txt', { type: 'text/plain' });
    const response = await POST(uploadRequest(file));
    expect(response.status).toBe(503);
  });

  it('rejects a request with no file', async () => {
    const { POST } = await loadRoute();
    const response = await POST(uploadRequest(null));
    expect(response.status).toBe(400);
  });

  it('rejects an unsupported file type', async () => {
    const { POST } = await loadRoute();
    const file = new File(['{}'], 'data.json', { type: 'application/json' });
    const response = await POST(uploadRequest(file));
    expect(response.status).toBe(400);
  });

  it('extracts a TXT file and forwards it to n8n', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { POST } = await loadRoute();

    const file = new File(
      ['Staff SOP: always confirm pricing before the consultation ends.'],
      'Consultation SOP.txt',
      { type: 'text/plain' },
    );
    const response = await POST(uploadRequest(file));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, title: 'Consultation SOP' });
    expect(fetchMock).toHaveBeenCalledWith(INGEST_URL, expect.objectContaining({ method: 'POST' }));
  });

  it('returns 502 when the ingest workflow fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    const { POST } = await loadRoute();

    const file = new File(['Clinic pricing information document body.'], 'pricing.txt', {
      type: 'text/plain',
    });
    const response = await POST(uploadRequest(file));
    expect(response.status).toBe(502);
  });
});
