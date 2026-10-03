import { chromium } from 'playwright';
const [url, sel, out, theme='light'] = process.argv.slice(2);
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 844 }, colorScheme: theme });
const logs=[]; p.on('console', m => { if (m.type()==='error') logs.push(m.text()); }); p.on('pageerror', e => logs.push(e.message));
await p.goto(url, { waitUntil: 'networkidle' }); await p.waitForTimeout(2500);
const el = p.locator(sel).first(); await el.scrollIntoViewIfNeeded();
await p.screenshot({ path: out, clip: await el.boundingBox().then(bb => ({ x: 0, y: Math.max(0, bb.y - 40), width: 390, height: Math.min(800, bb.height + 80) })) });
console.log(logs.join('\n')); await b.close();
