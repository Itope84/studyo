import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [out, ...imgs] = process.argv.slice(2);
const cells = imgs
  .map((p) => `<img src="data:image/png;base64,${readFileSync(p).toString('base64')}">`)
  .join('');
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: imgs.length * 505, height: 720 } });
await p.setContent(
  `<body style="margin:0;background:#777;display:flex;gap:5px">${cells}<style>img{width:500px;border:1px solid #333}</style></body>`,
);
await p.screenshot({ path: out, fullPage: true });
await b.close();
