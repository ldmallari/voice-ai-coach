import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests drive the real UI in a browser. Every API call is stubbed at
 * the network layer (see e2e/coach.spec.ts), so the flow is deterministic and
 * needs no live keys — the app boots, renders, and is exercised like a user.
 */
const PORT = 3100;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `PORT=${PORT} npm run dev`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
