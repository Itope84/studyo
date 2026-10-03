import { type FSWatcher, watch } from 'node:fs';
import type { EventBus } from './events.ts';
import type { JobStore } from './jobs/store.ts';
import type { Library } from './library.ts';

/**
 * Files dropped straight onto the server show up without a restart: changes under `topics/` emit
 * `topic.updated` (the next read auto-discovers new files), changes in `inbox/` emit `inbox.updated`.
 */
export function watchLibrary(library: Library, bus: EventBus, store: JobStore): () => void {
  const timers = new Map<string, NodeJS.Timeout>();
  const debounce = (key: string, fn: () => void, ms = 600) => {
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        fn();
      }, ms),
    );
  };
  const watchers: FSWatcher[] = [];
  try {
    watchers.push(
      watch(library.topicsDir, { recursive: true }, (_event, file) => {
        if (!file) return;
        const parts = file.toString().split(/[\\/]/);
        const topicId = parts[0];
        if (!topicId) return;
        const rest = parts.slice(1).join('/');
        // Chat and progress are written by the server itself, which already emits events for them.
        if (
          rest.startsWith('chat/') ||
          rest === 'progress.json' ||
          rest.startsWith('_job/') ||
          rest.includes('/_work/')
        )
          return;
        if (rest.endsWith('.tmp')) return;
        // While a job runs, the runner reports progress; the watcher would only add noise.
        const quiet = store.activeWork(topicId)?.status === 'running';
        debounce(
          `t:${topicId}`,
          () => bus.emit('topic.updated', { topic_id: topicId }),
          quiet ? 3000 : 600,
        );
      }),
    );
  } catch (e) {
    console.warn(`Not watching topics: ${(e as Error).message}`);
  }
  try {
    watchers.push(
      watch(library.coursesDir, { recursive: true }, (_event, file) => {
        if (!file) return;
        const parts = file.toString().split(/[\\/]/);
        const courseId = parts[0];
        const rest = parts.slice(1).join('/');
        if (
          !courseId ||
          rest.startsWith('chat/') ||
          rest.startsWith('_job/') ||
          rest.includes('/_work/')
        )
          return;
        if (rest.endsWith('.tmp')) return;
        const scope = `course--${courseId}`;
        const quiet = store.activeWork(scope)?.status === 'running';
        debounce(
          `c:${courseId}`,
          () => bus.emit('topic.updated', { topic_id: scope }),
          quiet ? 3000 : 600,
        );
      }),
    );
  } catch {
    // No courses folder yet; it is created with the first course.
  }
  try {
    watchers.push(
      watch(library.inboxDir, () => debounce('inbox', () => bus.emit('inbox.updated', {}))),
    );
  } catch (e) {
    console.warn(`Not watching inbox: ${(e as Error).message}`);
  }
  return () => {
    for (const w of watchers) w.close();
    for (const t of timers.values()) clearTimeout(t);
  };
}
