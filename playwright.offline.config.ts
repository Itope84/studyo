import { defineConfig, devices } from '@playwright/test';

// Offline needs the service worker, which only runs in a production build: `pnpm e2e:offline`.
export default defineConfig({
  testDir: 'e2e',
  testMatch: 'offline.spec.ts',
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:8794',
    ...devices['iPhone 13'],
    browserName: 'chromium',
    // Headless Chromium blocks unmuted playback even after a click.
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  webServer: {
    command: 'node scripts/e2e-offline-server.mjs',
    url: 'http://localhost:8793/health',
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
