import GithubSlugger from 'github-slugger';
import type { Element, ElementContent, Root as HastRoot } from 'hast';
import type { Code, Definition, Html, Image, Link, Paragraph, Root, RootContent } from 'mdast';
import { toString as mdToString } from 'mdast-util-to-string';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { parse as parseYaml } from 'yaml';
import { frameCss } from './styles.ts';
import { sanitizeSvg } from './svg.ts';

export const RENDERER_VERSION = '1.2.0';

export interface Heading {
  id: string;
  depth: number;
  text: string;
}

export interface FrontMatter {
  topic?: string;
  kind?: 'pack' | 'condensed' | string;
  built?: string;
  depth?: string;
  level?: string;
  scope?: string | string[];
  [key: string]: unknown;
}

export interface RenderedBody {
  title: string;
  front: FrontMatter;
  headings: Heading[];
  /** Relative image paths the document uses, to check they exist. */
  images: string[];
  bodyHtml: string;
  usesMermaid: boolean;
  usesMath: boolean;
  frames: number;
  /** Source ids and their URLs, from `[S3]: url` definitions and `[S3](url)` links, for the printed link list. */
  refs: { id: string; url: string }[];
  /** Front matter `description`, or the first paragraph, shortened. */
  description: string | null;
  words: number;
}

export class RenderError extends Error {}

const CALLOUT_KINDS: Record<string, string> = {
  definition: 'Definition',
  'key-idea': 'Key idea',
  'watch-out': 'Watch out',
  example: 'Example',
  analogy: 'Analogy',
  note: 'Note',
};
const DIRECTIVES = new Set(['callout', 'mermaid', 'svg', 'html', 'details', 'predict']);
/** Separates the question from the answer inside a `predict` block. */
const REVEAL_SPLIT = /^---reveal---\s*$/m;

const ORIGINAL_START = /^<!--\s*studyo:original:start\s*([^\s]*)\s*-->$/;
const ORIGINAL_END = /^<!--\s*studyo:original:end\s*-->$/;
const ADDED = /^<!--\s*studyo:added\s*-->$/;

type Placeholder = { kind: 'svg'; svg: string } | { kind: 'html'; html: string; title: string };

function parseMeta(meta: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of (meta ?? '').matchAll(/(\w[\w-]*)=(?:"([^"]*)"|'([^']*)'|(\S+))/g)) {
    out[m[1] as string] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}

const el = (
  hName: string,
  className: string[],
  children: RootContent[],
  extra: Record<string, unknown> = {},
) =>
  ({
    type: 'studyoBlock',
    data: { hName, hProperties: { ...(className.length ? { className } : {}), ...extra } },
    children,
  }) as unknown as RootContent;

const textBlock = (hName: string, className: string[], text: string) =>
  ({
    type: 'studyoBlock',
    data: { hName, hProperties: { className } },
    children: [{ type: 'text', value: text }],
  }) as unknown as RootContent;

/** Render Markdown with Studyo directives to an HTML body fragment plus metadata. */
export function renderBody(markdown: string): RenderedBody {
  const placeholders = new Map<string, Placeholder>();
  let front: FrontMatter = {};
  let usesMermaid = false;
  const images: string[] = [];
  const headings: Heading[] = [];
  const slugger = new GithubSlugger();

  const parseFragment = (md: string): RootContent[] => {
    const tree = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkMath)
      .parse(protectDollars(md)) as Root;
    transformBlocks(tree.children);
    return tree.children;
  };

  /** Directives, figures and markers, applied to one list of sibling blocks (recursively). */
  const transformBlocks = (nodes: RootContent[]): void => {
    const out: RootContent[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i] as RootContent;

      if (node.type === 'yaml') {
        try {
          front = (parseYaml(node.value) as FrontMatter) ?? {};
        } catch (e) {
          throw new RenderError(`Front matter is not valid YAML: ${(e as Error).message}`);
        }
        continue;
      }

      if (node.type === 'html') {
        const value = node.value.trim();
        const start = ORIGINAL_START.exec(value);
        if (start) {
          const inner: RootContent[] = [];
          let j = i + 1;
          for (; j < nodes.length; j++) {
            const n = nodes[j] as RootContent;
            if (n.type === 'html' && ORIGINAL_END.test(n.value.trim())) break;
            inner.push(n);
          }
          if (j >= nodes.length)
            throw new RenderError(`studyo:original:start ${start[1]} has no matching end marker`);
          transformBlocks(inner);
          const source = start[1] || '';
          const label = source ? `Original text · ${source}` : 'Original text';
          out.push(
            el(
              'section',
              ['original'],
              [
                textBlock('div', ['provenance'], label),
                ...inner,
                textBlock(
                  'div',
                  ['provenance', 'end'],
                  `End of original${source ? ` · ${source}` : ''}`,
                ),
              ],
              {
                dataSource: source,
              },
            ),
          );
          i = j;
          continue;
        }
        if (ORIGINAL_END.test(value))
          throw new RenderError('studyo:original:end without a start marker');
        if (ADDED.test(value)) {
          const inner: RootContent[] = [];
          let j = i + 1;
          for (; j < nodes.length; j++) {
            const n = nodes[j] as RootContent;
            if (
              inner.length &&
              (n.type === 'heading' || n.type === 'html' || n.type === 'thematicBreak')
            )
              break;
            if (n.type === 'html') break;
            inner.push(n);
          }
          transformBlocks(inner);
          out.push(el('aside', ['added-note'], inner));
          i = j - 1;
          continue;
        }
        if (value.startsWith('<!--')) continue; // other comments are dropped
        out.push(node);
        continue;
      }

      if (
        node.type === 'code' &&
        node.lang &&
        (DIRECTIVES.has(node.lang) || /\w=/.test(node.meta ?? ''))
      ) {
        out.push(directive(node));
        continue;
      }

      if (node.type === 'paragraph' && figureParts(node)) {
        // An image alone in its paragraph is a figure. Its credit line may follow on the next line (same
        // paragraph) or as the next paragraph.
        const { image, credit } = figureParts(node) as { image: Image; credit: RootContent | null };
        const next = nodes[i + 1];
        const caption: RootContent[] = [];
        if (image.alt) caption.push(textBlock('span', ['caption'], image.alt));
        if (credit) caption.push(el('span', ['credit'], [credit]));
        else if (next?.type === 'paragraph' && isCredit(next)) {
          caption.push(el('span', ['credit'], next.children as unknown as RootContent[]));
          i++;
        }
        out.push(
          el(
            'figure',
            [],
            [
              image as unknown as RootContent,
              ...(caption.length ? [el('figcaption', [], caption)] : []),
            ],
          ),
        );
        continue;
      }

      if (node.type === 'heading') {
        const text = mdToString(node);
        const id = slugger.slug(text);
        node.data = { ...node.data, hProperties: { ...(node.data?.hProperties ?? {}), id } };
        headings.push({ id, depth: node.depth, text });
      }

      if ('children' in node && node.type !== 'heading' && node.type !== 'paragraph') {
        // Lists, blockquotes and tables may hold directives or markers of their own.
        transformBlocks((node as { children: RootContent[] }).children);
      }
      out.push(node);
    }
    nodes.splice(0, nodes.length, ...out);
  };

  const directive = (node: Code): RootContent => {
    const meta = parseMeta(node.meta);
    switch (node.lang) {
      case 'callout': {
        const kind = meta.kind ?? 'note';
        const label = CALLOUT_KINDS[kind];
        if (!label)
          throw new RenderError(
            `Unknown callout kind "${kind}" (line ${node.position?.start.line})`,
          );
        return el(
          'aside',
          ['callout', `callout-${kind}`],
          [textBlock('span', ['callout-label'], meta.title ?? label), ...parseFragment(node.value)],
        );
      }
      case 'details':
        return el(
          'details',
          [],
          [textBlock('summary', [], meta.summary ?? 'More'), ...parseFragment(node.value)],
        );
      case 'predict': {
        const [question = '', ...rest] = node.value.split(REVEAL_SPLIT);
        const answer = rest.join('\n').trim();
        if (!answer)
          throw new RenderError(
            `A predict block needs a line "---reveal---" before the answer (line ${node.position?.start.line})`,
          );
        return el(
          'aside',
          ['predict'],
          [
            textBlock('span', ['predict-label'], meta.title ?? 'Predict'),
            ...parseFragment(question.trim()),
            el(
              'details',
              ['reveal'],
              [textBlock('summary', [], 'Reveal'), ...parseFragment(answer)],
            ),
          ],
        );
      }
      case 'mermaid':
        usesMermaid = true;
        return el('div', ['diagram'], [textBlock('pre', ['mermaid'], node.value)]);
      case 'svg': {
        const key = `ph${placeholders.size}`;
        placeholders.set(key, { kind: 'svg', svg: node.value });
        return el('div', ['freeform-svg'], [], { dataStudyoPh: key });
      }
      case 'html': {
        const key = `ph${placeholders.size}`;
        placeholders.set(key, {
          kind: 'html',
          html: node.value,
          title: meta.title ?? 'Interactive figure',
        });
        return el('div', ['freeform-html-slot'], [], { dataStudyoPh: key });
      }
      default:
        throw new RenderError(
          `Unknown directive "${node.lang}" (line ${node.position?.start.line})`,
        );
    }
  };

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkFrontmatter, ['yaml']);
  const mdast = processor.parse(protectDollars(markdown)) as Root;
  const description = describe(mdast);
  const words = mdToString(mdast).split(/\s+/).filter(Boolean).length;
  transformBlocks(mdast.children);
  visit(mdast, 'image', (img: Image) => {
    if (!/^(?:[a-z]+:)?\/\//i.test(img.url) && !img.url.startsWith('data:')) images.push(img.url);
  });
  let usesMath = false;
  visit(mdast, (n) => {
    if (n.type === 'math' || n.type === 'inlineMath') usesMath = true;
  });
  const refMap = new Map<string, string>();
  visit(mdast, 'definition', (d: Definition) => {
    const id = (d.label ?? d.identifier).trim();
    if (/^S\d+$/i.test(id) && /^https?:/.test(d.url)) refMap.set(id.toUpperCase(), d.url);
  });
  visit(mdast, 'link', (l: Link) => {
    const id = /^\s*(S\d+)\b/i.exec(mdToString(l))?.[1]?.toUpperCase();
    if (id && /^https?:/.test(l.url) && !refMap.has(id)) refMap.set(id, l.url);
  });
  const refs = [...refMap.entries()]
    .map(([id, url]) => ({ id, url }))
    .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));

  const title =
    headings.find((h) => h.depth === 1)?.text ?? (front.topic as string | undefined) ?? 'Untitled';

  const schema = {
    ...defaultSchema,
    clobberPrefix: '',
    clobber: [],
    tagNames: [
      ...(defaultSchema.tagNames ?? []),
      'section',
      'aside',
      'figure',
      'figcaption',
      'details',
      'summary',
      'span',
      'div',
      'u',
      'mark',
      'abbr',
      'small',
    ],
    attributes: {
      // Tag rules in the default schema pin className to GitHub's values; Studyo's components need their own.
      ...Object.fromEntries(
        Object.entries(defaultSchema.attributes ?? {}).map(([tag, attrs]) => [
          tag,
          attrs.filter((a) => !(Array.isArray(a) && a[0] === 'className')),
        ]),
      ),
      '*': [
        ...(defaultSchema.attributes?.['*'] ?? []),
        'className',
        'id',
        'dataSource',
        'dataStudyoPh',
      ],
      a: [...(defaultSchema.attributes?.a ?? []), 'title'],
      img: ['src', 'alt', 'title', 'width', 'height'],
    },
    protocols: { ...defaultSchema.protocols, src: ['http', 'https'] },
  };

  const hast = unified()
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, schema)
    .runSync(mdast) as HastRoot;
  // Maths after sanitising: KaTeX's own markup is trusted, the document's raw HTML is not.
  if (usesMath) unified().use(rehypeKatex, { strict: 'ignore' }).runSync(hast);

  let frames = 0;
  visit(hast, 'element', (node: Element, index, parent) => {
    const props = node.properties ?? {};
    const key = props.dataStudyoPh as string | undefined;
    if (key && placeholders.has(key) && parent && typeof index === 'number') {
      const ph = placeholders.get(key) as Placeholder;
      delete props.dataStudyoPh;
      if (ph.kind === 'svg') {
        node.children = sanitizeSvg(ph.svg);
      } else {
        frames++;
        node.tagName = 'iframe';
        node.properties = {
          className: ['freeform-html'],
          sandbox: ['allow-scripts'],
          title: ph.title,
          loading: 'lazy',
          dataFrame: String(frames),
          srcDoc: frameDocument(ph.html, frames),
        };
        node.children = [];
      }
      return;
    }
    if (node.tagName === 'a' && typeof props.href === 'string') {
      const text = toPlain(node);
      if (/^\(?\[?S\d+\b/.test(text.trim())) props.className = ['cite'];
      if (/^https?:/i.test(props.href)) {
        props.target = '_blank';
        props.rel = ['noopener', 'noreferrer'];
      }
    }
    if (
      node.tagName === 'table' &&
      parent &&
      typeof index === 'number' &&
      (parent as Element).tagName !== 'div'
    ) {
      (parent as Element).children[index] = {
        type: 'element',
        tagName: 'div',
        properties: { className: ['table-wrap'] },
        children: [node],
      };
    }
    if (node.tagName === 'img') props.loading = 'lazy';
  });

  const bodyHtml = unified().use(rehypeStringify).stringify(hast);
  return {
    title,
    front,
    headings,
    images,
    bodyHtml,
    usesMermaid,
    usesMath,
    frames,
    refs,
    description: typeof front.description === 'string' ? front.description : description,
    words,
  };
}

function figureParts(p: Paragraph): { image: Image; credit: RootContent | null } | null {
  const parts = p.children.filter(
    (c) => !(c.type === 'text' && !c.value.trim()) && c.type !== 'break',
  );
  const image = parts[0];
  if (image?.type !== 'image') return null;
  if (parts.length === 1) return { image, credit: null };
  const second = parts[1];
  if (
    parts.length === 2 &&
    second?.type === 'emphasis' &&
    /^source/i.test(mdToString(second).trim())
  ) {
    return { image, credit: second as RootContent };
  }
  return null;
}

function isCredit(p: Paragraph): boolean {
  const first = p.children[0];
  return first?.type === 'emphasis' && /^source/i.test(mdToString(first).trim());
}

function toPlain(node: ElementContent): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'element') return node.children.map(toPlain).join('');
  return '';
}

/** The document a sandboxed free-form HTML block runs in: tokens, fonts and an auto-height reporter. */
function frameDocument(html: string, id: number): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${frameCss}</style></head><body>${html}<script>(function(){var send=function(){parent.postMessage({type:'studyo:frame-height',id:${id},height:document.documentElement.scrollHeight},'*')};new ResizeObserver(send).observe(document.documentElement);window.addEventListener('load',send);addEventListener('message',function(e){if(e.data&&e.data.type==='studyo:theme'){document.documentElement.setAttribute('data-theme',e.data.theme)}});})();</script></body></html>`;
}

/**
 * Pandoc's rule for `$…$` maths: the opening `$` is followed by a non-space, the closing one is preceded by a
 * non-space and not followed by a digit. Any other `$` (prices: "$5 and $10") is escaped so it stays text.
 * Fenced and inline code are left alone. `$$…$$` is untouched.
 */
export function protectDollars(md: string): string {
  const parts = md.split(/(^```[\s\S]*?^```|^~~~[\s\S]*?^~~~)/m);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part.replace(
        /(`+)[\s\S]*?\1|\$\$[\s\S]*?\$\$|(?<!\\)\$(?=\S)[^$\n]*?[^\s\\]\$(?!\d)|(?<!\\)\$/g,
        (m) => (m === '$' ? '\\$' : m),
      );
    })
    .join('');
}

/** The first real paragraph after the title, as plain text, cut to about 220 characters. */
function describe(root: Root): string | null {
  let seenTitle = false;
  for (const node of root.children) {
    if (node.type === 'heading' && node.depth === 1) {
      seenTitle = true;
      continue;
    }
    if (node.type === 'heading' && seenTitle) break;
    if (node.type === 'paragraph') {
      let text = mdToString(node);
      // Drop citations like "(S1)", "((S2, §1))" and the brackets they leave behind.
      for (let i = 0; i < 3; i++)
        text = text.replace(/\(\s*S\d+[^()]*\)/g, '').replace(/\(\s*\)/g, '');
      text = text
        .replace(/\s+([,.;:])/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
      if (text.length < 40) continue;
      if (text.length <= 220) return text;
      const cut = text.slice(0, 220);
      return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
    }
  }
  return null;
}

/** Cheap facts about a document for lists (no HTML): its description and word count. */
export function docInfo(markdown: string): {
  description: string | null;
  words: number;
  title: string | null;
} {
  const tree = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkFrontmatter, ['yaml'])
    .parse(markdown) as Root;
  let front: FrontMatter = {};
  const yaml = tree.children.find((n) => n.type === 'yaml');
  if (yaml && yaml.type === 'yaml') {
    try {
      front = (parseYaml(yaml.value) as FrontMatter) ?? {};
    } catch {}
  }
  const h1 = tree.children.find((n) => n.type === 'heading' && n.depth === 1);
  return {
    description: typeof front.description === 'string' ? front.description : describe(tree),
    words: mdToString(tree).split(/\s+/).filter(Boolean).length,
    title: h1 ? mdToString(h1) : null,
  };
}
