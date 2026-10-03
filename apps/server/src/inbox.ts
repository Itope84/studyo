import { readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { InboxItem } from '@studyo/api';
import { mediaTypeFor } from './library.ts';

export function inboxKind(name: string): InboxItem['kind'] {
  const ext = extname(name).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  const media = mediaTypeFor(name);
  if (media === 'audio' || media === 'video') return media;
  if (['.md', '.txt', '.html', '.htm', '.epub', '.docx'].includes(ext)) return 'document';
  return 'other';
}

export async function listInbox(library: string): Promise<InboxItem[]> {
  const dir = join(library, 'inbox');
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const items: InboxItem[] = [];
  for (const e of entries) {
    if (!e.isFile() || e.name.startsWith('.') || e.name.startsWith('_')) continue;
    const info = await stat(join(dir, e.name));
    items.push({
      path: `inbox/${e.name}`,
      name: e.name,
      kind: inboxKind(e.name),
      size: info.size,
      added: info.birthtime.toISOString(),
    });
  }
  return items.sort((a, b) => b.added.localeCompare(a.added));
}
