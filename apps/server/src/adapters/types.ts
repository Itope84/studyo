import type { CliId } from '@studyo/api';

/** What a run may do. `work` builds packs; `read-only` answers questions. */
export type ToolPolicy = 'work' | 'read-only';

export interface RunRequest {
  /** Working directory: the library root, so the CLI finds `.claude/skills`. */
  cwd: string;
  prompt: string;
  /** Instructions that frame the run (unattended, no questions in the terminal). */
  system: string;
  /** Resume this session; `null` starts a new one. */
  resume: string | null;
  /** With `resume`, branch into a new session instead of appending to it. */
  fork?: boolean;
  model?: string | null;
  policy: ToolPolicy;
  /** Stream text as it is generated (chat). */
  streamText?: boolean;
  signal: AbortSignal;
  /** Job metadata, used only by the replay adapter to pick a script. */
  meta?: {
    kind: string;
    phase: 'start' | 'resume';
    topicPath: string;
    params?: Record<string, unknown>;
  };
}

export type AdapterEvent =
  | { type: 'session'; sessionId: string }
  /** A tool call, already summarised as one plain line. */
  | { type: 'tool'; name: string; summary: string }
  /** A complete block of model text. */
  | { type: 'text'; text: string }
  /** A chunk of text as it streams (only with `streamText`). */
  | { type: 'text-delta'; text: string }
  | { type: 'stderr'; text: string }
  /** The final outcome as the CLI reports it. */
  | {
      type: 'result';
      ok: boolean;
      text: string | null;
      error: string | null;
      costUsd: number | null;
    };

export interface RunOutcome {
  exitCode: number | null;
  sessionId: string | null;
  cancelled: boolean;
}

export interface CliAdapter {
  id: CliId;
  label: string;
  detect(): Promise<{ installed: boolean; version: string | null }>;
  run(req: RunRequest, onEvent: (e: AdapterEvent) => void): Promise<RunOutcome>;
}

/** Turn a tool call into one plain line for the app ("Searching: …", "Reading: …"). */
export function summariseTool(name: string, input: Record<string, unknown>): string {
  const n = name.toLowerCase();
  const str = (...keys: string[]) => {
    for (const k of keys) {
      const v = input[k];
      if (typeof v === 'string' && v) return v;
    }
    return '';
  };
  const short = (s: string, max = 90) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
  const file = (p: string) => p.split('/').slice(-2).join('/');
  if (n.includes('search') && !n.includes('grep')) return `Searching: ${short(str('query', 'q'))}`;
  if (n.includes('fetch')) return `Reading: ${short(str('url').replace(/^https?:\/\//, ''))}`;
  if (n === 'read') return `Opening ${file(str('file_path', 'filePath', 'path'))}`;
  if (n === 'write') return `Writing ${file(str('file_path', 'filePath', 'path'))}`;
  if (n === 'edit' || n === 'multiedit')
    return `Editing ${file(str('file_path', 'filePath', 'path'))}`;
  if (n === 'grep' || n === 'glob' || n === 'list') return `Looking through files`;
  if (n === 'bash') return `Running: ${short(str('description') || str('command'), 70)}`;
  if (n === 'skill') return `Using skill ${str('skill', 'name', 'command')}`;
  if (n === 'task' || n === 'agent')
    return `Delegating: ${short(str('description', 'prompt'), 70)}`;
  if (n.includes('todo')) return 'Updating its plan';
  return `Using ${name}`;
}
