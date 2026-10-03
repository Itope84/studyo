import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { type Heading, RENDERER_VERSION, RenderError, renderBody } from './render.ts';
import { documentCss } from './styles.ts';
import { GOOGLE_FONTS_HREF } from './tokens.ts';

export type { FrontMatter, Heading, RenderedBody } from './render.ts';
export { docInfo, protectDollars, RENDERER_VERSION, RenderError, renderBody } from './render.ts';
export { cssVars, GOOGLE_FONTS_HREF, type Palette, type ThemeName, tokens } from './tokens.ts';

export interface RenderOptions {
  /** Relative URL of the shared assets folder (mermaid), from the HTML file's location. */
  assetsHref: string;
}

export interface RenderResult {
  html: string;
  title: string;
  headings: Heading[];
  images: string[];
  description: string | null;
  words: number;
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

/** Markdown in, a complete self-contained HTML page out. */
export function render(markdown: string, opts: RenderOptions): RenderResult {
  const body = renderBody(markdown);
  const f = body.front;
  const metaBits: string[] = [];
  if (f.kind === 'pack') metaBits.push('<span class="kind">Study pack</span>');
  else if (f.kind === 'condensed') metaBits.push('<span class="kind">Condensed</span>');
  if (f.depth) metaBits.push(`<span>${escapeHtml(String(f.depth))} depth</span>`);
  if (f.level) metaBits.push(`<span>Level: ${escapeHtml(String(f.level))}</span>`);
  if (f.built) metaBits.push(`<span>Built ${escapeHtml(String(f.built))}</span>`);
  const minutes = Math.max(1, Math.round(body.words / 230));
  metaBits.push(`<span>${minutes} min read</span>`);
  const meta = metaBits.length ? `<div class="doc-meta">${metaBits.join('')}</div>` : '';
  // Printed (PDF) copies lose hover and clicks, so the source links are listed at the end in print.
  const refs = body.refs.length
    ? `<section class="print-refs"><h2>Source links</h2><ol>${body.refs
        .map(
          (r) =>
            `<li><span class="ref-id">${escapeHtml(r.id)}</span> <a href="${escapeHtml(r.url)}">${escapeHtml(r.url)}</a></li>`,
        )
        .join('')}</ol></section>`
    : '';
  const katexCss = body.usesMath
    ? `<link rel="stylesheet" href="${opts.assetsHref}/katex/katex.min.css">\n`
    : '';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="generator" content="studyo-renderer ${RENDERER_VERSION}">
<title>${escapeHtml(body.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${GOOGLE_FONTS_HREF}">
${katexCss}<style>${documentCss}</style>
</head>
<body>
<main id="doc">
${meta}
${body.bodyHtml}
${refs}
</main>
<script>window.STUDYO = ${JSON.stringify({ headings: body.headings, mermaid: body.usesMermaid ? `${opts.assetsHref}/mermaid.min.js` : null, version: RENDERER_VERSION }).replace(/</g, '\\u003c')};</script>
<script>${READER_SCRIPT}</script>
</body>
</html>
`;
  return {
    html,
    title: body.title,
    headings: body.headings,
    images: body.images,
    description: body.description,
    words: body.words,
  };
}

/**
 * Render `<file>.md` to `<file>.html` next to it. `libraryRoot` is used to find the shared assets folder
 * (`<library>/_studyo/assets`). Fails when an image the document uses is missing.
 */
export function renderFile(
  mdPath: string,
  libraryRoot: string,
): RenderResult & { htmlPath: string } {
  const markdown = readFileSync(mdPath, 'utf8');
  const assetsDir = join(libraryRoot, '_studyo', 'assets');
  writeSharedAssets(assetsDir);
  const assetsHref = relative(dirname(mdPath), assetsDir).split('\\').join('/');
  const result = render(markdown, { assetsHref });
  const missing = result.images.filter(
    (src) => !existsSync(resolve(dirname(mdPath), decodeURI(src))),
  );
  if (missing.length)
    throw new RenderError(`Missing image${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`);
  const htmlPath = mdPath.replace(/\.md$/, '.html');
  writeFileSync(htmlPath, result.html);
  return { ...result, htmlPath };
}

/** Copy the shared runtime assets (mermaid) into place, once per renderer version. */
export function writeSharedAssets(dir: string) {
  const stamp = join(dir, `.version`);
  if (existsSync(stamp) && readFileSync(stamp, 'utf8') === RENDERER_VERSION) return;
  mkdirSync(dir, { recursive: true });
  const require = createRequire(import.meta.url);
  copyFileSync(require.resolve('mermaid/dist/mermaid.min.js'), join(dir, 'mermaid.min.js'));
  // KaTeX's stylesheet and fonts, so maths renders offline and in printed PDFs.
  const katexDist = dirname(require.resolve('katex/dist/katex.min.css'));
  mkdirSync(join(dir, 'katex'), { recursive: true });
  copyFileSync(join(katexDist, 'katex.min.css'), join(dir, 'katex', 'katex.min.css'));
  cpSync(join(katexDist, 'fonts'), join(dir, 'katex', 'fonts'), { recursive: true });
  writeFileSync(stamp, RENDERER_VERSION);
}

/** True when `htmlPath` is missing, older than its Markdown, or from another renderer version. */
export function isStale(mdPath: string, htmlPath: string, mtime: (p: string) => number): boolean {
  if (!existsSync(htmlPath)) return true;
  if (mtime(mdPath) > mtime(htmlPath)) return true;
  const head = readFileSync(htmlPath, 'utf8').slice(0, 600);
  return !head.includes(`studyo-renderer ${RENDERER_VERSION}"`);
}

/**
 * Runs inside the rendered page. Talks to the app (parent frame or WebView) with postMessage:
 * out: studyo:ready {headings}, studyo:position {fraction, section}
 * in:  studyo:goto {section | fraction}, studyo:theme {theme}
 */
const READER_SCRIPT = `
(function () {
  var S = window.STUDYO || {};
  var root = document.documentElement;
  var post = function (msg) {
    try { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg)); } catch (e) {}
    try { if (window.parent !== window) window.parent.postMessage(msg, '*'); } catch (e) {}
  };
  var q = new URLSearchParams(location.search);
  if (q.get('theme') === 'dark' || q.get('theme') === 'light') root.setAttribute('data-theme', q.get('theme'));

  var headings = function () { return Array.prototype.slice.call(document.querySelectorAll('h1[id],h2[id],h3[id]')); };
  var current = function () {
    var hs = headings(), id = null;
    for (var i = 0; i < hs.length; i++) { if (hs[i].getBoundingClientRect().top <= 80) id = hs[i].id; else break; }
    return id;
  };
  var fraction = function () {
    var max = root.scrollHeight - window.innerHeight;
    return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 1;
  };
  var timer = null;
  window.addEventListener('scroll', function () {
    if (timer) return;
    timer = setTimeout(function () { timer = null; post({ type: 'studyo:position', fraction: fraction(), section: current() }); }, 400);
  }, { passive: true });

  var goto = function (msg) {
    if (msg.section) {
      var el = document.getElementById(msg.section);
      if (el) { el.scrollIntoView({ block: 'start' }); if (msg.flash) { el.classList.add('flash'); setTimeout(function(){ el.classList.remove('flash'); }, 1700); } return; }
    }
    if (typeof msg.fraction === 'number') window.scrollTo(0, msg.fraction * (root.scrollHeight - window.innerHeight));
  };

  var frames = function (theme) {
    var list = document.querySelectorAll('iframe.freeform-html');
    for (var i = 0; i < list.length; i++) { try { list[i].contentWindow.postMessage({ type: 'studyo:theme', theme: theme }, '*'); } catch (e) {} }
  };
  var setTheme = function (theme) {
    root.setAttribute('data-theme', theme); frames(theme); renderMermaid();
  };

  window.addEventListener('message', function (e) {
    var d = e.data; if (!d || typeof d !== 'object') return;
    if (d.type === 'studyo:goto') goto(d);
    else if (d.type === 'studyo:theme') setTheme(d.theme);
    else if (d.type === 'studyo:frame-height') {
      var f = document.querySelector('iframe.freeform-html[data-frame="' + d.id + '"]');
      if (f) f.style.height = Math.min(Math.max(d.height, 80), 2400) + 'px';
    }
  });
  document.addEventListener('message', function (e) { try { var d = JSON.parse(e.data); window.dispatchEvent(new MessageEvent('message', { data: d })); } catch (x) {} });

  var mermaidLoaded = null;
  function cssVar(name) { return getComputedStyle(root).getPropertyValue(name).trim(); }
  function renderMermaid() {
    if (!S.mermaid) return;
    var blocks = document.querySelectorAll('pre.mermaid');
    if (!blocks.length) return;
    if (!mermaidLoaded) {
      mermaidLoaded = new Promise(function (resolve, reject) {
        var s = document.createElement('script'); s.src = S.mermaid; s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
      });
    }
    return mermaidLoaded.then(function () {
      for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i];
        if (!b.dataset.source) b.dataset.source = b.textContent;
        b.removeAttribute('data-processed'); b.textContent = b.dataset.source;
      }
      window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', fontFamily: 'Geist, system-ui, sans-serif',
        themeVariables: { background: cssVar('--surface'), primaryColor: cssVar('--canvas'), primaryBorderColor: cssVar('--rule-strong'),
          primaryTextColor: cssVar('--ink'), lineColor: cssVar('--lead'), secondaryColor: cssVar('--tint'), tertiaryColor: cssVar('--surface'),
          noteBkgColor: cssVar('--tint'), noteTextColor: cssVar('--ink'), fontSize: '14px' } });
      return window.mermaid.run({ nodes: blocks });
    }).then(function () {
      // Wide diagrams keep a readable size and scroll sideways instead of shrinking to fit a phone.
      var svgs = document.querySelectorAll('.diagram svg');
      for (var i = 0; i < svgs.length; i++) {
        var svg = svgs[i], vb = svg.viewBox && svg.viewBox.baseVal, box = svg.closest('.diagram');
        if (!vb || !box) continue;
        var natural = vb.width, room = box.clientWidth - 32;
        if (natural > room * 1.25) { svg.style.maxWidth = 'none'; svg.style.width = Math.min(natural, room * 2.2) + 'px'; svg.style.height = 'auto'; }
      }
    }).catch(function () {});
  }

  function markReady() { root.setAttribute('data-studyo-ready', '1'); }
  window.addEventListener('load', function () {
    var pending = renderMermaid();
    Promise.all([pending, document.fonts ? document.fonts.ready : null]).then(markReady, markReady);
    if (location.hash.length > 1) goto({ section: decodeURIComponent(location.hash.slice(1)), flash: true });
    post({ type: 'studyo:ready', headings: S.headings || [], version: S.version });
  });
})();
`;
