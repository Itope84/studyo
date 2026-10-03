import { randomBytes } from 'node:crypto';
import { renameSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 404 | 409 | 413 | 416 | 422 | 500 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, 'not_found', `${what} not found.`);
export const badRequest = (message: string) => new HttpError(400, 'bad_request', message);
export const conflict = (message: string) => new HttpError(409, 'conflict', message);

export const nowIso = () => new Date().toISOString();
export const today = () => nowIso().slice(0, 10);

/** Sortable unique id: time prefix plus randomness. */
export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${randomBytes(5).toString('hex')}`;
}

export function slugify(text: string, max = 48): string {
  const slug = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return slug || 'topic';
}

/** Resolve `rel` under `root`, refusing anything that escapes it. */
export function safeJoin(root: string, rel: string): string {
  const full = resolve(root, rel);
  const back = relative(resolve(root), full);
  if (back === '..' || back.startsWith(`..${sep}`) || isAbsolute(back)) throw notFound('File');
  return full;
}

/** True when a path segment is scratch (`_` prefix) or hidden. */
export function isHiddenPath(rel: string): boolean {
  return rel.split(/[\\/]/).some((part) => part.startsWith('_') || part.startsWith('.'));
}

export function writeJsonAtomic(path: string, value: unknown) {
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}
