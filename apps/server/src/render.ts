import { readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Rendered, Resource } from '@studyo/api';
import { isStale, RENDERER_VERSION, RenderError, renderFile } from '@studyo/renderer';
import type { Library } from './library.ts';
import { HttpError } from './util.ts';

const mtime = (p: string) => statSync(p).mtimeMs;

/** Render a pack or condensed doc if its HTML is missing or stale. Returns where the HTML is. */
export function ensureRendered(library: Library, topicId: string, resource: Resource): Rendered {
  if (!resource.path.endsWith('.md')) {
    throw new HttpError(422, 'not_renderable', 'Only Markdown documents can be rendered.');
  }
  const md = join(library.topicDir(topicId), resource.path);
  const html = md.replace(/\.md$/, '.html');
  let headings: Rendered['headings'] | null = null;
  if (isStale(md, html, mtime)) {
    try {
      headings = renderFile(md, library.root).headings;
    } catch (e) {
      const message = e instanceof RenderError ? e.message : (e as Error).message;
      throw new HttpError(422, 'render_failed', `This document could not be rendered: ${message}`);
    }
  }
  return {
    html_path: relative(library.root, html).split('\\').join('/'),
    renderer_version: RENDERER_VERSION,
    headings: headings ?? headingsFromHtml(html),
  };
}

/** The outline the renderer embedded in the page (`window.STUDYO = {headings: …}`). */
function headingsFromHtml(htmlPath: string): Rendered['headings'] {
  const text = readFileSync(htmlPath, 'utf8');
  const m = /<script>window\.STUDYO = (\{.*?\});<\/script>/s.exec(text);
  try {
    return m ? (JSON.parse(m[1] as string).headings ?? []) : [];
  } catch {
    return [];
  }
}

/** Render every document in a topic; returns the problems instead of throwing. */
export function renderTopic(library: Library, topicId: string, resources: Resource[]): string[] {
  const problems: string[] = [];
  for (const r of resources) {
    if ((r.type === 'pack' || r.type === 'condensed') && r.path.endsWith('.md')) {
      try {
        ensureRendered(library, topicId, r);
      } catch (e) {
        problems.push(`${r.path}: ${(e as Error).message}`);
      }
    }
  }
  return problems;
}
