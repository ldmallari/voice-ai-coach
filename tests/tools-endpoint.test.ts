import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Integration test for the endpoint n8n calls.
 *
 * Covers the security boundary as well as the happy path: this route serves
 * customer data, so an unauthenticated caller must never reach a tool.
 */

const SECRET = 'test-secret-value';

/** Loads the route fresh so it re-reads process.env. */
async function loadRoute() {
  vi.resetModules();
  return import('@/app/api/tools/route');
}

function requestFor(body: unknown, secret?: string) {
  return new Request('http://localhost/api/tools', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { 'x-coach-secret': secret } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.COACH_TOOL_SECRET = SECRET;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.N8N_RETRIEVAL_URL;
});

afterEach(() => {
  delete process.env.COACH_TOOL_SECRET;
});

describe('POST /api/tools', () => {
  it('rejects a request with no secret', async () => {
    const { POST } = await loadRoute();
    const response = await POST(requestFor({ tool: 'get_clinic_overview' }));

    expect(response.status).toBe(401);
  });

  it('rejects a request with the wrong secret', async () => {
    const { POST } = await loadRoute();
    const response = await POST(
      requestFor({ tool: 'get_clinic_overview' }, 'wrong-secret-value'),
    );

    expect(response.status).toBe(401);
  });

  it('is disabled entirely when no secret is configured', async () => {
    delete process.env.COACH_TOOL_SECRET;
    const { POST } = await loadRoute();
    const response = await POST(requestFor({ tool: 'get_clinic_overview' }, SECRET));

    // Fails closed rather than serving data with auth switched off.
    expect(response.status).toBe(503);
  });

  it('rejects a malformed body', async () => {
    const { POST } = await loadRoute();
    const response = await POST(requestFor({ nope: true }, SECRET));

    expect(response.status).toBe(400);
  });

  it('rejects an unknown tool name', async () => {
    const { POST } = await loadRoute();
    const response = await POST(requestFor({ tool: 'drop_all_tables' }, SECRET));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/Unknown tool/);
  });

  it('returns computed figures for a valid authenticated call', async () => {
    const { POST } = await loadRoute();
    const response = await POST(requestFor({ tool: 'get_clinic_overview' }, SECRET));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tool).toBe('get_clinic_overview');
    expect(body.result.consultations).toBe(60);
    expect(body.result.conversionRate).toBeGreaterThan(0);
  });

  it('passes tool input through', async () => {
    const { POST } = await loadRoute();
    const response = await POST(
      requestFor({ tool: 'get_lapsed_customers', input: { days: 30 } }, SECRET),
    );
    const body = await response.json();

    expect(body.result.days).toBe(30);
  });

  it('returns per-treatment rows worst-converting first', async () => {
    const { POST } = await loadRoute();
    const response = await POST(
      requestFor({ tool: 'get_treatment_performance' }, SECRET),
    );
    const rows = (await response.json()).result;

    expect(Array.isArray(rows)).toBe(true);
    expect(rows[0].conversionRate).toBeLessThanOrEqual(rows[1].conversionRate);
  });
});
