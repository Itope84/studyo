import { execSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Locator, type Page, test } from '@playwright/test';

// Run with `pnpm e2e:offline` (playwright.offline.config.ts): a production build with the service worker.
const SERVER = 'http://localhost:8793';
/** Where scripts/e2e-offline-server.mjs put the build the server is serving. */
const WEB_DIR = join(tmpdir(), 'studyo-offline-e2e', 'web');
const v = (l: Locator) => l.filter({ visible: true }).first();

async function connect(page: Page) {
  await page.goto(`/connect?server=${encodeURIComponent(SERVER)}&token=e2e-token`);
  await expect(v(page.getByRole('button', { name: /^Server connected/ }))).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, {
    timeout: 20_000,
  });
}

test('a topic saved for offline opens, reads and plays without a connection', async ({
  page,
  context,
}) => {
  await connect(page);
  await page.goto('/topic/pc-ca-mcts');
  await v(page.getByText('Make available offline')).click();
  await expect(v(page.getByText('Available offline'))).toBeVisible({ timeout: 30_000 });
  await expect(v(page.getByText(/MB, saved/))).toBeVisible();

  await context.setOffline(true);
  // A cold launch: the app itself comes from the cache.
  await page.goto('/');
  await expect(v(page.getByText('Server offline'))).toBeVisible({ timeout: 20_000 });
  await v(page.getByText(/Building a post-quantum CA/)).click();
  await expect(
    v(page.getByText('Showing the copy saved for offline use.', { exact: false })),
  ).toBeVisible();

  // The doc, its images and fonts.
  await v(page.getByText('Merkle Tree Certificates in plain words')).click();
  const doc = page.frameLocator('iframe');
  await expect(doc.locator('h1').first()).toHaveText('Merkle Tree Certificates in plain words', {
    timeout: 20_000,
  });
  expect(
    await doc
      .locator('img')
      .first()
      .evaluate((i: HTMLImageElement) => i.naturalWidth),
  ).toBeGreaterThan(0);

  // Reading position made offline waits on the device...
  await doc.locator('body').evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  await page.waitForTimeout(1500);
  await page.goBack();
  await expect(v(page.getByText(/% read/))).toBeVisible({ timeout: 10_000 });

  // ...and the audio plays from the cache.
  await v(page.getByRole('button', { name: /^Play / })).click();
  await expect(v(page.getByText(/^0:0[2-9] \/ 0:14/))).toBeVisible({ timeout: 10_000 });
  await v(page.getByRole('button', { name: /^Pause / })).click();

  const queued = await page.evaluate(() => localStorage.getItem('studyo-outbox') ?? '');
  expect(queued).toContain('condensed-all-2026-10-03');

  // Back online: the queue goes to the server and empties.
  await context.setOffline(false);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('studyo-outbox') ?? ''), {
      timeout: 15_000,
    })
    .toContain('"items":{}');
  const progress = await page.evaluate(
    (s) =>
      fetch(`${s}/topics/pc-ca-mcts/progress`, {
        headers: { Authorization: 'Bearer e2e-token' },
      }).then((r) => r.json()),
    SERVER,
  );
  expect(progress.items['condensed-all-2026-10-03'].position).toBeGreaterThan(0.2);
});

test('a new deploy replaces the cached app on the next launch', async ({ page, context }) => {
  await connect(page);
  const old = (await page.evaluate(() => caches.keys())).find((k) => k.startsWith('shell-'));
  expect(old).toBeTruthy();

  // A new build: the page changes, so the stamped build id and the worker change.
  const index = join(WEB_DIR, 'index.html');
  writeFileSync(index, readFileSync(index, 'utf8').replace('</body>', '<!-- e2e-v2 --></body>'));
  copyFileSync('apps/app/public/sw.js', join(WEB_DIR, 'sw.js'));
  execSync(`node scripts/build-sw.mjs ${WEB_DIR}`);

  await page.reload();
  await expect
    .poll(() => page.evaluate(() => caches.keys()), { timeout: 20_000 })
    .not.toContain(old);
  await context.setOffline(true);
  await page.reload();
  expect(await page.content()).toContain('<!-- e2e-v2 -->');
  await context.setOffline(false);
});
