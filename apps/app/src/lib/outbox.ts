import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Progress, ProgressUpdate } from '@studyo/api';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Progress saved while the server is out of reach (reading position, audio position, done marks). One entry per
 * topic and resource, holding the latest update; sent when the server answers again. The server keeps the newest
 * by `updated`, so sending late or twice does no harm.
 */
interface Queued {
  topicId: string;
  update: ProgressUpdate;
}

interface Outbox {
  items: Record<string, Queued>;
  add: (topicId: string, u: ProgressUpdate) => void;
  remove: (key: string, updated: string) => void;
}

const keyOf = (topicId: string, resourceId: string) => `${topicId}\n${resourceId}`;

export const useOutbox = create<Outbox>()(
  persist(
    (set) => ({
      items: {},
      add: (topicId, u) =>
        set((s) => {
          const key = keyOf(topicId, u.resource_id);
          const prev = s.items[key]?.update;
          if (prev && prev.updated > u.updated) return s;
          // A later save that leaves `done` or `section` out keeps what the earlier one said.
          const update: ProgressUpdate = {
            ...u,
            done: u.done ?? prev?.done,
            section: u.section ?? prev?.section,
            duration: u.duration ?? prev?.duration,
          };
          return { items: { ...s.items, [key]: { topicId, update } } };
        }),
      remove: (key, updated) =>
        set((s) => {
          if (s.items[key]?.update.updated !== updated) return s;
          const { [key]: _, ...rest } = s.items;
          return { items: rest };
        }),
    }),
    { name: 'studyo-outbox', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

/** The server's progress with anything newer from the outbox laid over it. */
export function withQueued(topicId: string, progress: Progress): Progress {
  const queued = Object.values(useOutbox.getState().items).filter((q) => q.topicId === topicId);
  if (!queued.length) return progress;
  const items = { ...progress.items };
  let last = progress.last;
  for (const { update: u } of queued) {
    const prev = items[u.resource_id];
    if (prev && prev.updated >= u.updated) continue;
    items[u.resource_id] = {
      position: Math.max(0, u.position),
      duration: u.duration ?? prev?.duration ?? null,
      section: u.section ?? prev?.section ?? null,
      done: u.done ?? prev?.done ?? false,
      updated: u.updated,
    };
    if (!last || last.updated <= u.updated)
      last = { resource_id: u.resource_id, updated: u.updated };
  }
  return { ...progress, items, last };
}

let flushing = false;

/** Send what's queued, oldest first. Stops at the first failure; the rest waits for the next try. */
export async function flushOutbox(
  send: (topicId: string, u: ProgressUpdate) => Promise<unknown>,
): Promise<string[]> {
  if (flushing) return [];
  flushing = true;
  const sent = new Set<string>();
  try {
    const entries = Object.entries(useOutbox.getState().items).sort((a, b) =>
      a[1].update.updated.localeCompare(b[1].update.updated),
    );
    for (const [key, { topicId, update }] of entries) {
      await send(topicId, update);
      useOutbox.getState().remove(key, update.updated);
      sent.add(topicId);
    }
  } catch {
    // Still offline.
  } finally {
    flushing = false;
  }
  return [...sent];
}
