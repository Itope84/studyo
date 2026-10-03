import { chromium } from 'playwright';

const dir = process.argv[2];
const names = process.argv.slice(3);
const b = await chromium.launch();
for (const n of names) {
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  await p.goto(`file://${dir}/${n}.html`, { waitUntil: 'load' }).catch(() => {});
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${dir}/${n}-full.png`, fullPage: true });
  await p.close();
}
await b.close();
