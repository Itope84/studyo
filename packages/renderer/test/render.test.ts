import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { protectDollars, RENDERER_VERSION, RenderError, render, renderFile } from '../src/index.ts';

const opts = { assetsHref: '../../../_studyo/assets' };
const FIXTURE = resolve(import.meta.dirname, '../../../fixtures/library');

describe('render', () => {
  it('renders the fixture pack and condensed doc', () => {
    const lib = mkdtempSync(join(tmpdir(), 'studyo-render-'));
    cpSync(FIXTURE, lib, { recursive: true });
    const topic = join(lib, 'topics/pc-ca-mcts');
    const pack = renderFile(join(topic, 'pack/pack.md'), lib);
    expect(pack.title).toMatch(/Merkle Tree Certificates/);
    expect(pack.headings.length).toBeGreaterThan(10);
    const html = readFileSync(pack.htmlPath, 'utf8');
    expect(html).toContain(`studyo-renderer ${RENDERER_VERSION}`);
    expect(html).toContain('<section class="original" data-source="S1">');
    expect(html).toContain('class="callout callout-definition"');
    expect(html).toMatch(/class="cite"/);
    const condensed = renderFile(join(topic, 'outputs/condensed-all-2026-10-03.md'), lib);
    expect(readFileSync(condensed.htmlPath, 'utf8')).toContain('class="mermaid"');
  });

  it('fails loudly on unknown directives and callout kinds', () => {
    expect(() => render('```carousel items=3\nx\n```', opts)).toThrow(RenderError);
    expect(() => render('```callout kind=shout\nx\n```', opts)).toThrow(/Unknown callout kind/);
  });

  it('keeps ordinary code blocks as code', () => {
    const { html } = render('```python\nprint(1)\n```', opts);
    expect(html).toContain('<pre><code class="language-python">');
  });

  it('fails on an unmatched original marker', () => {
    expect(() => render('<!-- studyo:original:start S1 -->\n\ntext', opts)).toThrow(
      /no matching end/,
    );
  });

  it('sanitises free-form SVG', () => {
    const { html } = render(
      '```svg\n<svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(1)</script><circle cx="5" cy="5" r="4" fill="var(--primary)" onclick="x()"/><a href="javascript:alert(1)"><rect width="1" height="1"/></a><foreignObject><div>x</div></foreignObject></svg>\n```',
      opts,
    );
    const body = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
    expect(body).toContain('<circle');
    expect(body).toContain('fill="var(--primary)"');
    expect(body).not.toMatch(/onload|onclick|alert\(1\)<\/script>|javascript:|foreignObject/);
  });

  it('puts free-form HTML in a sandboxed frame', () => {
    const { html } = render(
      '```html title="Slider"\n<input type="range"><script>console.log(1)</script>\n```',
      opts,
    );
    expect(html).toMatch(/<iframe class="freeform-html" sandbox="allow-scripts" title="Slider"/);
    expect(html).not.toContain('allow-same-origin');
  });

  it('drops raw script tags written straight into the Markdown', () => {
    const { html } = render('Hello <script>alert(1)</script> <b>bold</b>', opts);
    const body = html.slice(html.indexOf('<main'), html.indexOf('<script>window.STUDYO'));
    expect(body).not.toContain('<script');
    expect(body).toContain('<b>bold</b>');
  });

  it('turns a sole image plus a source line into a figure', () => {
    const { html } = render('![A tree](assets/t.png)\n*Source: [S2](https://example.com)*', opts);
    expect(html).toMatch(/<figure><img[^>]*src="assets\/t.png"/);
    expect(html).toContain('class="credit"');
  });

  it('refuses to render when an image is missing', () => {
    const lib = mkdtempSync(join(tmpdir(), 'studyo-render-'));
    const md = join(lib, 'doc.md');
    writeFileSync(md, '# T\n\n![x](assets/missing.png)\n');
    expect(() => renderFile(md, lib)).toThrow(/Missing image/);
  });

  it('gives headings stable ids', () => {
    const a = render('# One\n\n## Two words\n\n## Two words', opts);
    expect(a.headings.map((h) => h.id)).toEqual(['one', 'two-words', 'two-words-1']);
  });

  it('renders inline and display maths with KaTeX', () => {
    const { html } = render(
      '# M\n\nScale by $\\sqrt{d_k}$ here.\n\n$$\n\\mathrm{softmax}(QK^T)V\n$$\n',
      opts,
    );
    expect(html).toContain('class="katex"');
    expect(html).toContain('katex-display');
    expect(html).toContain('katex/katex.min.css');
  });

  it('keeps prices as text, not maths', () => {
    expect(protectDollars('It costs $5 and $10 a month.')).toBe('It costs \\$5 and \\$10 a month.');
    expect(protectDollars('Inline $x^2$ stays, `$code$` stays.')).toBe(
      'Inline $x^2$ stays, `$code$` stays.',
    );
    const { html } = render('# P\n\nIt costs $5 and $10 a month.', opts);
    expect(html).not.toContain('class="katex"');
    expect(html).toContain('$5 and $10');
  });

  it('lists source links for print, and reports description and length', () => {
    const r = render(
      '# T\n\nThis first paragraph explains what the document is about in enough words to be a description. ([S2](https://example.com/two))\n\nMore [S1].\n\n[S1]: https://example.com/one\n',
      opts,
    );
    expect(r.html).toMatch(/class="print-refs".*S1.*example\.com\/one.*S2.*example\.com\/two/s);
    expect(r.description).toMatch(/^This first paragraph explains/);
    expect(r.description).not.toContain('S2');
    expect(r.words).toBeGreaterThan(15);
  });
});
