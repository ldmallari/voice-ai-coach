import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Knowledge management routes (list + delete), gated by the admin passcode.
 * Supabase is mocked so the test needs no database.
 */

const LIST_ROWS = [
  { metadata: { title: 'Cancellation Policy' }, created_at: '2026-08-30T00:00:00Z' },
  { metadata: { title: 'Cancellation Policy' }, created_at: '2026-09-01T00:00:00Z' },
  { metadata: { title: 'Pricing' }, created_at: '2026-09-02T00:00:00Z' },
];
const CONTENT_ROWS = [{ content: 'Chunk one.' }, { content: 'Chunk two.' }];

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: () => true,
  serverClient: () => ({
    from: () => ({
      // select() is both awaited directly (listDocuments) and chained
      // .filter().order() (getDocumentContent), so it is a thenable builder.
      select: () => ({
        filter: () => ({
          order: () => Promise.resolve({ data: CONTENT_ROWS, error: null }),
        }),
        then: (resolve: (v: { data: unknown; error: null }) => void) =>
          resolve({ data: LIST_ROWS, error: null }),
      }),
      // deleteDocument() awaits .delete().filter().select('id')
      delete: () => ({
        filter: () => ({
          select: async () => ({ data: [{ id: 1 }, { id: 2 }], error: null }),
        }),
      }),
    }),
  }),
}));

const PASSCODE = '022304-test';

async function loadRoute() {
  vi.resetModules();
  return import('@/app/api/documents/route');
}

function req(method: string, opts: { code?: string; title?: string } = {}) {
  const url = new URL('http://localhost/api/documents');
  if (opts.title) url.searchParams.set('title', opts.title);
  return new Request(url, {
    method,
    headers: opts.code ? { 'x-admin-passcode': opts.code } : {},
  });
}

beforeEach(() => {
  process.env.KNOWLEDGE_ADMIN_PASSCODE = PASSCODE;
});
afterEach(() => {
  delete process.env.KNOWLEDGE_ADMIN_PASSCODE;
});

describe('GET /api/documents (list)', () => {
  it('is disabled when no admin passcode is configured', async () => {
    delete process.env.KNOWLEDGE_ADMIN_PASSCODE;
    const { GET } = await loadRoute();
    expect((await GET(req('GET'))).status).toBe(503);
  });

  it('rejects a wrong passcode', async () => {
    const { GET } = await loadRoute();
    expect((await GET(req('GET', { code: 'wrong' }))).status).toBe(401);
  });

  it('lists documents grouped by title with the right passcode', async () => {
    const { GET } = await loadRoute();
    const res = await GET(req('GET', { code: PASSCODE }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.documents).toEqual([
      { title: 'Cancellation Policy', chunks: 2, uploadedAt: '2026-09-01T00:00:00Z' },
      { title: 'Pricing', chunks: 1, uploadedAt: '2026-09-02T00:00:00Z' },
    ]);
  });
});

describe('GET /api/documents?title= (read content)', () => {
  it('returns a document&rsquo;s chunks rejoined as full text', async () => {
    const { GET } = await loadRoute();
    const res = await GET(req('GET', { code: PASSCODE, title: 'Cancellation Policy' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({
      title: 'Cancellation Policy',
      chunks: 2,
      content: 'Chunk one.\n\nChunk two.',
    });
  });

  it('still requires the passcode', async () => {
    const { GET } = await loadRoute();
    expect((await GET(req('GET', { title: 'Cancellation Policy' }))).status).toBe(401);
  });
});

describe('POST /api/documents (upload is gated)', () => {
  it('rejects an upload without the passcode', async () => {
    const { POST } = await loadRoute();
    expect((await POST(req('POST'))).status).toBe(401);
  });

  it('is disabled when no admin passcode is configured', async () => {
    delete process.env.KNOWLEDGE_ADMIN_PASSCODE;
    const { POST } = await loadRoute();
    expect((await POST(req('POST'))).status).toBe(503);
  });
});

describe('DELETE /api/documents', () => {
  it('rejects without a passcode', async () => {
    const { DELETE } = await loadRoute();
    expect((await DELETE(req('DELETE', { title: 'Pricing' }))).status).toBe(401);
  });

  it('requires a title', async () => {
    const { DELETE } = await loadRoute();
    expect((await DELETE(req('DELETE', { code: PASSCODE }))).status).toBe(400);
  });

  it('removes a document and reports how many chunks were deleted', async () => {
    const { DELETE } = await loadRoute();
    const res = await DELETE(req('DELETE', { code: PASSCODE, title: 'Pricing' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, title: 'Pricing', removed: 2 });
  });
});
