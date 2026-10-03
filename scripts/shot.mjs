// Usage: node scripts/shot.mjs <url> <out.png> [width] [height] [theme] [fullPage] [waitMs]
import { chromium } from 'playwright';
const [url, out, w = '390', h = '844', theme = 'light', full = 'false', wait = '800'] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: +w, height: +h }, colorScheme: theme, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(url, { waitUntil: 'networkidle' }).catch((e) => logs.push(`goto: ${e.message}`));
await page.waitForTimeout(+wait);
await page.screenshot({ path: out, fullPage: full === 'true' });
if (logs.length) console.log(logs.slice(0, 15).join('\n'));
await browser.close();
