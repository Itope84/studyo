// Contact sheet: node scripts/sheet.mjs out.png img1.png img2.png ... (scaled side by side)
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [out, ...imgs] = process.argv.slice(2);
const cells = imgs
  .map(
    (p) =>
      `<figure><img src="data:image/png;base64,${readFileSync(p).toString('base64')}"><figcaption>${p.split('/').pop()}</figcaption></figure>`,
  )
  .join('');
const html = `<html><body style="margin:0;background:#888;display:flex;gap:8px;padding:8px;font:12px sans-serif">${cells}<style>figure{margin:0;width:390px}img{width:390px;display:block}</style></body></html>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: imgs.length * 398 + 8, height: 900 } });
await p.setContent(html);
await p.screenshot({ path: out, fullPage: true });
await b.close();
