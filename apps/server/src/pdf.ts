import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Pdf, Resource } from '@studyo/api';
import { type Browser, chromium } from 'playwright-core';
import type { Library } from './library.ts';
import { ensureRendered } from './render.ts';
import { HttpError } from './util.ts';

let browser: Promise<Browser> | null = null;
let idle: NodeJS.Timeout | null = null;
let queue: Promise<unknown> = Promise.resolve();

/** Playwright's Chromium if installed, else the system Chrome. Closed after two idle minutes. */
async function getBrowser(): Promise<Browser> {
  if (idle) clearTimeout(idle);
  if (!browser) {
    browser = chromium
      .launch()
      .catch(() => chromium.launch({ channel: 'chrome' }))
      .catch((e) => {
        browser = null;
        throw new HttpError(
          503,
          'pdf_unavailable',
          `PDF export needs Chromium on the server. Run "npx playwright install chromium" there. (${(e as Error).message.split('\n')[0]})`,
        );
      });
  }
  return browser;
}

function scheduleClose() {
  if (idle) clearTimeout(idle);
  idle = setTimeout(async () => {
    const b = browser;
    browser = null;
    await (await b)?.close().catch(() => {});
  }, 120_000);
  idle.unref();
}

/** A file name people can recognise in their downloads: the document title plus its kind. */
export function pdfFileName(resource: Resource): string {
  const base = resource.title
    .replace(/\s*:\s*/g, ' - ')
    .replace(/[\\/*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
  return `${base || 'Studyo document'}.pdf`;
}

/**
 * Print a pack or condensed doc to PDF next to its Markdown (`pack.md` → `pack.pdf`), re-making it when the
 * HTML is newer. Jobs are printed one at a time.
 */
export function ensurePdf(library: Library, topicId: string, resource: Resource): Promise<Pdf> {
  const run = async (): Promise<Pdf> => {
    const rendered = ensureRendered(library, topicId, resource);
    const html = join(library.root, rendered.html_path);
    const pdf = html.replace(/\.html$/, '.pdf');
    const pdfPath = rendered.html_path.replace(/\.html$/, '.pdf');
    if (existsSync(pdf) && statSync(pdf).mtimeMs >= statSync(html).mtimeMs) {
      return { pdf_path: pdfPath, file_name: pdfFileName(resource) };
    }
    const b = await getBrowser();
    const context = await b.newContext({ colorScheme: 'light' });
    try {
      const page = await context.newPage();
      const url = pathToFileURL(html);
      url.searchParams.set('theme', 'light');
      await page.goto(url.href, { waitUntil: 'load', timeout: 30_000 });
      await page.waitForSelector('html[data-studyo-ready]', { timeout: 20_000 }).catch(() => {}); // print anyway; a diagram that never finished is better than no PDF
      await page.emulateMedia({ media: 'print' });
      // Answers print unfolded. Passed as a string because the server's TypeScript has no DOM types.
      await page.evaluate(
        "document.querySelectorAll('details').forEach((d) => { d.open = true; })",
      );
      await page.pdf({
        path: pdf,
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: `<div style="width:100%;font-size:8px;color:#6F6E69;font-family:system-ui,sans-serif;padding:0 16mm;display:flex;justify-content:space-between"><span>${escapeHtml(resource.title)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
      });
    } finally {
      await context.close();
      scheduleClose();
    }
    return { pdf_path: pdfPath, file_name: pdfFileName(resource) };
  };
  const next = queue.then(run, run);
  queue = next.catch(() => {});
  return next;
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );

export async function closePdfBrowser() {
  if (idle) clearTimeout(idle);
  const b = browser;
  browser = null;
  await (await b?.catch(() => null))?.close().catch(() => {});
}
