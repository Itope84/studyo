import type { Resource } from '@studyo/api';

/** Audio the app made from a doc (not an upload): it remembers which doc it came from. */
export const isGeneratedAudio = (r: Resource) => r.type === 'audio' && !!r.source_id;

/** The audio made from a doc, newest last. */
export const audioFor = (resources: Resource[], docId: string) =>
  resources.filter((r) => isGeneratedAudio(r) && r.source_id === docId);

/**
 * How long the audio runs, from how long the doc takes to read. Measured once: an 18 minute read came out as
 * 31 minutes of speech, so about 1.7 times. Rounded, because it is only a guide.
 */
export function spokenMinutes(readMinutes: number): number {
  const m = readMinutes * 1.7;
  return m >= 10 ? Math.round(m / 5) * 5 : Math.max(1, Math.round(m));
}

export const voicesLabel = (voices: number | null | undefined) =>
  voices === 1 ? 'One narrator' : 'Two hosts';
