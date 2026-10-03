import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CliId } from '@studyo/api';
import type { AdapterEvent, CliAdapter, RunRequest } from './types.ts';

/**
 * A script the replay adapter plays instead of calling a CLI. Steps run in order; `delay` is in ms.
 * File steps act on the topic folder, the way a real skill would.
 */
export interface ReplayScript {
  steps: Array<
    | { delay?: number; event: AdapterEvent }
    | { delay?: number; write: { path: string; content: string } }
    | { delay?: number; manifest: Record<string, unknown> & { addResources?: unknown[] } }
  >;
  exitCode?: number;
}

/**
 * Plays recorded scripts from `dir`: `<kind>.<phase>.json`, falling back to `<kind>.json`.
 * Used by tests and demo mode so no tokens are spent.
 */
export function replayAdapter(dir: string, id: CliId = 'claude'): CliAdapter {
  return {
    id,
    label: id === 'claude' ? 'Claude Code (replay)' : 'OpenCode (replay)',
    detect: async () => ({ installed: true, version: 'replay' }),
    async run(req: RunRequest, onEvent: (e: AdapterEvent) => void) {
      const meta = req.meta ?? { kind: 'unknown', phase: 'start', topicPath: req.cwd };
      const file = [join(dir, `${meta.kind}.${meta.phase}.json`), join(dir, `${meta.kind}.json`)].find(existsSync);
      const sessionId = req.resume && !req.fork ? req.resume : `replay-${randomUUID()}`;
      onEvent({ type: 'session', sessionId });
      if (!file) {
        onEvent({ type: 'result', ok: false, text: null, error: `No replay script for ${meta.kind}`, costUsd: null });
        return { exitCode: 1, sessionId, cancelled: false };
      }
      const script = JSON.parse(readFileSync(file, 'utf8')) as ReplayScript;
      for (const step of script.steps) {
        if (step.delay) await sleep(step.delay, req.signal);
        if (req.signal.aborted) return { exitCode: null, sessionId, cancelled: true };
        if ('event' in step) onEvent(step.event);
        else if ('write' in step) {
          const path = join(meta.topicPath, step.write.path);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, step.write.content);
        } else if ('manifest' in step) {
          const path = join(meta.topicPath, 'topic.json');
          const manifest = JSON.parse(readFileSync(path, 'utf8'));
          const { addResources, ...rest } = step.manifest;
          Object.assign(manifest, rest, { updated: new Date().toISOString() });
          if (addResources) manifest.resources = [...(manifest.resources ?? []), ...addResources];
          writeFileSync(path, JSON.stringify(manifest, null, 2));
        }
      }
      return { exitCode: script.exitCode ?? 0, sessionId, cancelled: false };
    },
  };
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    });
  });
}
