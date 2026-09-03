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
