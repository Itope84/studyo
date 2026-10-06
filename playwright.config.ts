import { defineConfig, devices } from '@playwright/test';

const APP_PORT = 8082;

export default defineConfig({
  testDir: 'e2e',
  // Needs a production build: `pnpm e2e:offline` (playwright.offline.config.ts).
  testIgnore: 'offline.spec.ts',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    ...devices['iPhone 13'],
    browserName: 'chromium',
  },
  webServer: [
    {
      command: 'node scripts/e2e-server.mjs',
      url: 'http://localhost:8790/health',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'node scripts/fake-access.mjs',
      url: 'http://localhost:8792/__login',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: `pnpm --filter @studyo/app exec expo start --web --port ${APP_PORT}`,
      url: `http://localhost:${APP_PORT}`,
      reuseExistingServer: true,
      timeout: 180_000,
      env: { CI: '1' },
    },
  ],
});
