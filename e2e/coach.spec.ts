import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end smoke of the core coaching flow, in a real browser.
 *
 * The backend is stubbed at the network layer so the test is deterministic and
 * needs no keys: it proves the whole front end works together — the app boots,
 * shows live KPIs, takes a question by text or chip, and renders the coached
 * answer with its source.
 */

const OVERVIEW = {
  consultations: 60,
  conversion: 0.517,
  rebooking: 0.46,
  revenue: 84000,
  retention90: 0.61,
};

const ANSWER = {
  answer:
    '**CoolSculpting is the one to fix.** It converts at just 7.1% versus your 51.7% clinic average, and it is your highest-ticket treatment.',
  sources: ['clinic customer data'],
};

async function stubApi(page: Page) {
  await page.route('**/api/overview', (route) => route.fulfill({ json: OVERVIEW }));
  await page.route('**/api/sessions', (route) => route.fulfill({ json: { sessionId: 'e2e-session' } }));
  await page.route('**/api/chat', (route) => route.fulfill({ json: ANSWER }));
  // Voice output is best-effort; a tiny body keeps auto-speak from erroring loudly.
  await page.route('**/api/voice/speak', (route) =>
    route.fulfill({ status: 200, contentType: 'audio/mpeg', body: '' }),
  );
}

test.beforeEach(async ({ page }) => {
  await stubApi(page);
});

test('shows live clinic KPIs on the hero', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Ask your clinic anything/i })).toBeVisible();
  await expect(page.getByText('Conversion')).toBeVisible();
  await expect(page.getByText('52%')).toBeVisible(); // 0.517 → 52%
});

test('a typed question returns a coached answer with its source', async ({ page }) => {
  await page.goto('/');

  await page.getByPlaceholder(/Type a message/i).fill('Is CoolSculpting underperforming?');
  await page.getByRole('button', { name: 'Ask' }).click();

  // the owner's question, then the answer (revealed word-by-word), then the source
  await expect(page.getByText('Is CoolSculpting underperforming?')).toBeVisible();
  await expect(page.getByText(/CoolSculpting is the one to fix/i)).toBeVisible();
  await expect(page.getByText('clinic customer data')).toBeVisible();
});

test('a suggestion chip also produces an answer', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'What does our cancellation policy say?' }).click();
  await expect(page.getByText(/CoolSculpting is the one to fix/i)).toBeVisible();
});

test('unlocking the knowledge panel lets you upload a document', async ({ page }) => {
  // The whole knowledge base is gated: unlock, then the upload zone appears.
  await page.route('**/api/documents', (route) => {
    const method = route.request().method();
    if (method === 'GET') return route.fulfill({ json: { documents: [] } });
    if (method === 'POST')
      return route.fulfill({ json: { ok: true, title: 'Clinic Policies', characters: 240 } });
    return route.continue();
  });
  await page.goto('/');

  await page.getByRole('button', { name: /Knowledge base/i }).click();
  await page.getByPlaceholder('Admin passcode').fill('022304');
  await page.getByRole('button', { name: 'Unlock' }).click();

  await page.locator('input[type="file"]').setInputFiles({
    name: 'policies.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Clinic policy: late cancellations are charged a 50% fee.'),
  });

  await expect(page.getByText(/Added .*Clinic Policies.* to the knowledge base/i)).toBeVisible();
});

test('the knowledge panel unlocks with the passcode and deletes a document', async ({ page }) => {
  // Trailing ** so the DELETE ?title= request is stubbed, not sent to the real server.
  await page.route('**/api/documents**', (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      return route.fulfill({
        json: {
          documents: [
            { title: 'Cancellation Policy', chunks: 2, uploadedAt: '2026-09-01T00:00:00Z' },
            { title: 'Pricing', chunks: 1, uploadedAt: '2026-09-02T00:00:00Z' },
          ],
        },
      });
    }
    if (method === 'DELETE') return route.fulfill({ json: { ok: true, title: 'Pricing', removed: 1 } });
    return route.continue();
  });
  await page.goto('/');

  await page.getByRole('button', { name: /Knowledge base/i }).click();
  await page.getByPlaceholder('Admin passcode').fill('022304');
  await page.getByRole('button', { name: 'Unlock' }).click();

  await expect(page.getByRole('button', { name: 'View Cancellation Policy' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View Pricing' })).toBeVisible();

  // Delete is a two-step confirm: the trash icon reveals a Delete/Cancel prompt.
  await page.getByRole('button', { name: 'Delete Pricing' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View Pricing' })).toHaveCount(0);
});

test('unlocking the knowledge panel lets you read a document', async ({ page }) => {
  // Match with a trailing ** so the ?title= read request is stubbed, not just the bare list.
  await page.route('**/api/documents**', (route) => {
    const method = route.request().method();
    const url = new URL(route.request().url());
    if (method === 'GET' && url.searchParams.get('title')) {
      return route.fulfill({
        json: {
          title: 'Cancellation Policy',
          chunks: 1,
          content: 'Late cancellations are charged a 50% fee.',
        },
      });
    }
    if (method === 'GET') {
      return route.fulfill({
        json: {
          documents: [{ title: 'Cancellation Policy', chunks: 1, uploadedAt: '2026-09-01T00:00:00Z' }],
        },
      });
    }
    return route.continue();
  });
  await page.goto('/');

  await page.getByRole('button', { name: /Knowledge base/i }).click();
  await page.getByPlaceholder('Admin passcode').fill('022304');
  await page.getByRole('button', { name: 'Unlock' }).click();

  // Click the document to open it and read the ingested text.
  await page.getByRole('button', { name: 'View Cancellation Policy' }).click();
  await expect(page.getByText(/Late cancellations are charged a 50% fee/i)).toBeVisible();

  // "All documents" returns to the list.
  await page.getByRole('button', { name: /All documents/i }).click();
  await expect(page.getByRole('button', { name: 'View Cancellation Policy' })).toBeVisible();
});
