import type { Resource } from '@studyo/api';

/** What a document is called on screen. The stored title of a pack ("Study pack") predates the rename. */
export const docTitle = (r: Resource): string => (r.type === 'pack' ? 'Reference' : r.title);
