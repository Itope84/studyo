import { expect, type Locator, type Page, test } from '@playwright/test';

const SERVER = process.env.E2E_SERVER ?? 'http://localhost:8790';
const TOKEN = process.env.E2E_TOKEN ?? 'e2e-token';
const SHOTS = process.env.E2E_SHOTS;

/** Expo Router keeps earlier screens mounted but hidden on web; only match what is on screen. */
const v = (l: Locator) => l.filter({ visible: true }).first();

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function connect(page: Page) {
  await page.goto(`/connect?server=${encodeURIComponent(SERVER)}&token=${TOKEN}`);
  await expect(v(page.getByRole('tab', { name: 'Library' }))).toBeVisible({ timeout: 30_000 });
  await expect(v(page.getByRole('button', { name: /^Server connected/ }))).toBeVisible({
    timeout: 15_000,
  });
}

test('add a link, answer the level question, read the new pack', async ({ page }) => {
  await connect(page);
  await shot(page, '01-home');
  await v(page.getByRole('button', { name: 'Add topic' })).click();
  await v(page.getByLabel('Link')).fill('https://example.com/merkle-trees-explained');
  await shot(page, '02-add');
  await v(page.getByRole('button', { name: 'Add and build' })).click();

  // The topic page shows the job, then the question.
  await expect(v(page.getByRole('heading', { name: 'Merkle trees explained' }))).toBeVisible();
  await expect(v(page.getByText('Waiting for your answer'))).toBeVisible({ timeout: 20_000 });
  await shot(page, '03-topic-waiting');
  await v(page.getByRole('button', { name: 'Answer' })).click();

  await expect(v(page.getByText('Which of these do you already understand?'))).toBeVisible();
  await v(page.getByRole('checkbox', { name: /Hash functions/ })).click();
  await v(page.getByLabel(/What do you want to be able to do/)).fill('Explain MTCs to a friend');
  await shot(page, '04-questions');
  await v(page.getByRole('button', { name: 'Send answers' })).click();

  // Back on the topic, the run finishes and the pack appears.
  await expect(v(page.getByRole('button', { name: 'Ask in chat' }))).toBeVisible({
    timeout: 30_000,
  });
  await shot(page, '05-topic-ready');
  await v(page.getByRole('button', { name: /Study pack This pack/ })).click();
  const frame = v(page.locator('iframe[title="Document"]')).contentFrame();
  await expect(frame.getByRole('heading', { name: 'Demo study pack' })).toBeVisible({
    timeout: 20_000,
  });
  await shot(page, '06-reader');
});

test('ask in chat and get a cited answer with an enrich offer', async ({ page }) => {
  await connect(page);
  await v(page.getByRole('button', { name: /Building a post-quantum CA.*open topic/ })).click();
  await v(page.getByRole('button', { name: 'Ask in chat' })).click();
  await v(page.getByLabel('Your question')).fill('What replaces the certificate chain?');
  await v(page.getByRole('button', { name: 'Send' })).click();
  await expect(v(page.getByText(/replace a chain of signatures/))).toBeVisible({ timeout: 20_000 });
  await expect(v(page.getByText("The pack doesn't cover this yet"))).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText('Let me check the pack.')).toHaveCount(0);
  await shot(page, '07-chat');
});

test('play audio and open the full player from the dock', async ({ page }) => {
  await connect(page);
  await v(page.getByRole('button', { name: /Building a post-quantum CA.*open topic/ })).click();
  await v(page.getByRole('button', { name: /^Play Deep dive/ })).click();
  await expect(v(page.getByRole('button', { name: /Open player/ }))).toBeVisible({
    timeout: 10_000,
  });
  await shot(page, '08-topic-playing');
  await v(page.getByRole('button', { name: /Open player/ })).click();
  await expect(v(page.getByText('Now playing'))).toBeVisible();
  await shot(page, '09-player');
});

test('the app survives the server going away and coming back', async ({ page }) => {
  await connect(page);
  // Simulate a suspended tab: block the server, fire a resume, then restore it.
  await page.route(`${SERVER}/**`, (route) => route.abort());
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(v(page.getByText('Server offline'))).toBeVisible({ timeout: 40_000 });
  await shot(page, '10-offline');
  await page.unroute(`${SERVER}/**`);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(v(page.getByRole('button', { name: /^Server connected/ }))).toBeVisible({
    timeout: 40_000,
  });
});

test('closing the app mid-job and reopening it shows the waiting question', async ({ browser }) => {
  const context = await browser.newContext();
  const first = await context.newPage();
  await connect(first);
  await v(first.getByRole('button', { name: 'Add topic' })).click();
  await v(first.getByRole('button', { name: 'Topic name' })).click();
  await v(first.getByLabel('Topic')).fill('Bloom filters');
  await v(first.getByRole('button', { name: 'Add and build' })).click();
  await expect(v(first.getByRole('heading', { name: 'Bloom filters' }))).toBeVisible();
  // Close the tab while the job is still running, as iOS does to a backgrounded web app.
  await first.close();

  // Wait long enough for the job to reach its question while nobody is connected.
  await new Promise((r) => setTimeout(r, 5000));
  const again = await context.newPage();
  await again.goto('/');
  await expect(v(again.getByText('Studyo has a question'))).toBeVisible({ timeout: 30_000 });
  await shot(again, '11-reopened-question');
  await v(again.getByText('Studyo has a question')).click();
  await expect(v(again.getByText('Which of these do you already understand?'))).toBeVisible();
  await context.close();
});

test('download a document as PDF for NotebookLM', async ({ page }) => {
  await connect(page);
  await v(page.getByRole('button', { name: /Building a post-quantum CA.*open topic/ })).click();
  await v(page.getByRole('button', { name: /^Download Merkle Tree Certificates/ })).click();
  await expect(v(page.getByText('Best for NotebookLM'))).toBeVisible();
  await shot(page, '12-download-sheet');
  const download = page.waitForEvent('download', { timeout: 60_000 });
  await v(page.getByText('PDF', { exact: true })).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Merkle Tree Certificates in plain words.pdf');
  const path = await file.path();
  const { readFileSync } = await import('node:fs');
  expect(readFileSync(path).subarray(0, 5).toString()).toBe('%PDF-');
});

test('the tab bar reaches Activity, which shows a waiting question', async ({ page }) => {
  await connect(page);
  await v(page.getByRole('tab', { name: /Activity/ })).click();
  await expect(v(page.getByText('Packs and docs'))).toBeVisible();
  await v(page.getByRole('tab', { name: /Library/ })).click();
  await expect(v(page.getByRole('button', { name: 'Add topic' }))).toBeVisible();
});

test('rename and delete a file in the inbox', async ({ page }) => {
  await connect(page);
  await v(page.getByRole('tab', { name: /Inbox/ })).click();
  await v(page.getByRole('button', { name: 'Upload a file' })).isVisible();
  // Upload through the API so the test doesn't depend on the system file picker.
  await page.evaluate(async (server) => {
    const form = new FormData();
    form.append('file', new File(['notes'], 'scratch notes.md', { type: 'text/markdown' }));
    await fetch(`${server}/inbox`, {
      method: 'POST',
      headers: { Authorization: 'Bearer e2e-token' },
      body: form,
    });
  }, SERVER);
  await expect(v(page.getByText('scratch-notes.md'))).toBeVisible({ timeout: 15_000 });
  await v(page.getByRole('button', { name: 'More for scratch-notes.md' })).click();
  await v(page.getByLabel('File name')).fill('Raft reading notes');
  await v(page.getByRole('button', { name: 'Rename' })).click();
  await expect(v(page.getByText('Raft reading notes.md'))).toBeVisible({ timeout: 15_000 });
  await v(page.getByRole('button', { name: 'More for Raft reading notes.md' })).click();
  await v(page.getByRole('button', { name: 'Delete file' })).click();
  await v(page.getByRole('button', { name: 'Delete', exact: true })).click();
  await expect(page.getByText('Raft reading notes.md')).toHaveCount(0, { timeout: 15_000 });
});
