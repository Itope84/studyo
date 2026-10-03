import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { lookup } from 'mime-types';
import { HttpError, notFound, safeJoin } from './util.ts';

/** Serve a file under `root`, honouring a single `Range: bytes=a-b` header. */
export async function serveFile(
  root: string,
  rel: string,
  rangeHeader: string | undefined,
  download?: string | null,
): Promise<Response> {
  if (rel.split('/').some((p) => p === '..')) throw notFound('File');
  // Only server state is off limits; underscore folders inside topics hold assets the Reader needs.
  if (rel.startsWith('_studyo/') && !rel.startsWith('_studyo/assets/')) throw notFound('File');
  if (rel === '_studyo/token' || rel.endsWith('.db')) throw notFound('File');
  const path = safeJoin(root, rel);
  if (!existsSync(path)) throw notFound('File');
  const info = await stat(path);
  if (!info.isFile()) throw notFound('File');
  const size = info.size;
  const type = lookup(path) || 'application/octet-stream';
  const headers: Record<string, string> = {
    'Content-Type': type.startsWith('text/') ? `${type}; charset=utf-8` : type,
    'Accept-Ranges': 'bytes',
    'Last-Modified': info.mtime.toUTCString(),
    'Cache-Control': type === 'text/html' ? 'no-cache' : 'private, max-age=300',
  };
  if (download) {
    const ascii = download.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
    headers['Content-Disposition'] =
      `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(download)}`;
    headers['Cache-Control'] = 'no-cache';
  }

  if (rangeHeader) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!m || (!m[1] && !m[2])) throw new HttpError(416, 'bad_range', 'Range not satisfiable.');
    let start: number;
    let end: number;
    if (!m[1]) {
      const suffix = Number(m[2]);
      start = Math.max(0, size - suffix);
      end = size - 1;
    } else {
      start = Number(m[1]);
      end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    }
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
    return new Response(body, {
      status: 206,
      headers: {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': String(end - start + 1),
      },
    });
  }
  const body = Readable.toWeb(createReadStream(path)) as ReadableStream;
  return new Response(body, {
    status: 200,
    headers: { ...headers, 'Content-Length': String(size) },
  });
}
