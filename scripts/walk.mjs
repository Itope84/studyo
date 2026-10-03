// Screenshot app screens. Usage: node scripts/walk.mjs <outdir> <theme> <width> <height> path1 path2 ...
import { chromium } from 'playwright';

const [out, theme = 'light', w = '390', h = '844', ...paths] = process.argv.slice(2);
const APP = process.env.APP ?? 'http://localhost:8081';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: +w, height: +h }, colorScheme: theme });
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error') logs.push(`console: ${m.text().slice(0, 300)}`);
});
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 300)}`));
await page.goto(`${APP}/connect?server=http://localhost:8787&token=devtoken`, {
  waitUntil: 'load',
});
await page.waitForTimeout(5000);
for (const p of paths) {
  const [path, action] = p.split('|');
  await page.goto(`${APP}${path}`, { waitUntil: 'load' });
  await page.waitForTimeout(3500);
  if (action) {
    for (const step of action.split(';')) {
      const [kind, arg] = step.split('=');
      if (kind === 'click')
        await page
          .getByText(arg, { exact: false })
          .first()
          .click()
          .catch((e) => logs.push(`click ${arg}: ${e.message.slice(0, 120)}`));
      if (kind === 'label')
        await page
          .getByLabel(arg)
          .first()
          .click()
          .catch((e) => logs.push(`label ${arg}: ${e.message.slice(0, 120)}`));
      if (kind === 'wait') await page.waitForTimeout(+arg);
      if (kind === 'scroll') await page.mouse.wheel(0, +arg);
    }
    await page.waitForTimeout(1200);
  }
  const name = path.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'home';
  await page.screenshot({
    path: `${out}/${name}${action ? '_' + action.replace(/[^a-z0-9]+/gi, '_').slice(0, 30) : ''}-${theme}.png`,
  });
}
if (logs.length) console.log([...new Set(logs)].slice(0, 20).join('\n'));
await browser.close();
