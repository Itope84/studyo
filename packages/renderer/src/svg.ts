import type { Element, ElementContent } from 'hast';
import { fromHtml } from 'hast-util-from-html';

const SVG_TAGS = new Set([
  'svg',
  'g',
  'defs',
  'title',
  'desc',
  'symbol',
  'use',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'textPath',
  'marker',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'pattern',
  'filter',
  'feGaussianBlur',
  'feOffset',
  'feBlend',
  'feColorMatrix',
  'feMerge',
  'feMergeNode',
  'feFlood',
  'feComposite',
  'image',
  'style',
]);

/**
 * Keep drawing elements only. Scripts, event handlers, foreign content and external references are removed.
 * Colours may use the document's CSS variables (`var(--primary)`), so a hand-drawn figure follows the theme.
 */
export function sanitizeSvg(source: string): ElementContent[] {
  const tree = fromHtml(source.trim(), { fragment: true, space: 'svg' });
  const clean = (nodes: ElementContent[]): ElementContent[] => {
    const out: ElementContent[] = [];
    for (const node of nodes) {
      if (node.type === 'text') out.push(node);
      if (node.type !== 'element') continue;
      if (!SVG_TAGS.has(node.tagName)) continue;
      out.push(cleanElement(node, clean));
    }
    return out;
  };
  const result = clean(tree.children as ElementContent[]);
  if (!result.some((n) => n.type === 'element' && n.tagName === 'svg')) {
    throw new Error('An svg block must contain an <svg> element');
  }
  return result;
}

function cleanElement(node: Element, clean: (n: ElementContent[]) => ElementContent[]): Element {
  const props: Element['properties'] = {};
  for (const [key, value] of Object.entries(node.properties ?? {})) {
    const k = key.toLowerCase();
    if (k.startsWith('on')) continue;
    if (
      (k === 'href' || k === 'xlinkhref') &&
      !(typeof value === 'string' && (value.startsWith('#') || value.startsWith('data:image/')))
    )
      continue;
    if (typeof value === 'string' && /javascript:|url\((?!\s*['"]?#)/i.test(value)) continue;
    props[key] = value;
  }
  if (node.tagName === 'style') {
    const css = node.children.map((c) => (c.type === 'text' ? c.value : '')).join('');
    return {
      type: 'element',
      tagName: 'style',
      properties: {},
      children: [
        {
          type: 'text',
          value: css.replace(/@import[^;]*;?/gi, '').replace(/url\((?!\s*['"]?#)[^)]*\)/gi, 'none'),
        },
      ],
    };
  }
  return { ...node, properties: props, children: clean(node.children as ElementContent[]) };
}
