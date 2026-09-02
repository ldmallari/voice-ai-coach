import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The header KPI endpoint: aggregate clinic figures, no customer rows. */

async function loadRoute() {
  vi.resetModules();
  return import('@/app/api/overview/route');
}

beforeEach(() => {
  // Force the synthetic dataset so the test needs no database.
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/overview', () => {
  it('returns aggregate KPIs over the seeded dataset', async () => {
    const { GET } = await loadRoute();
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.consultations).toBe(60);
    expect(body.conversion).toBeGreaterThan(0);
    expect(body.conversion).toBeLessThanOrEqual(1);
    expect(body.revenue).toBeGreaterThan(0);
    // No customer rows leak through this endpoint.
    expect(body.customers).toBeUndefined();
  });
});
