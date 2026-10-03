import type { EventType } from '@studyo/api';
import type { Db } from './db.ts';
import { nowIso } from './util.ts';

export interface StoredEvent {
  id: number;
  type: EventType;
  at: string;
  data: unknown;
}

type Listener = (event: StoredEvent) => void;

const KEEP_EVENTS = 5000;
const KEEP_MS = 24 * 60 * 60 * 1000;

/** Persistent, replayable event log with in-process fan-out to SSE clients. */
export class EventBus {
  private listeners = new Set<Listener>();
  private sinceTrim = 0;

  constructor(private db: Db) {}

  emit(type: EventType, data: unknown = {}): StoredEvent {
    const at = nowIso();
    const row = this.db
      .prepare('INSERT INTO events (type, at, data) VALUES (?, ?, ?) RETURNING id')
      .get(type, at, JSON.stringify(data)) as { id: number };
    const event: StoredEvent = { id: Number(row.id), type, at, data };
    for (const listener of this.listeners) listener(event);
    if (++this.sinceTrim > 200) this.trim();
    return event;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Events after `afterId`, or `null` when the log no longer reaches back that far. */
  replay(afterId: number): StoredEvent[] | null {
    const oldest = this.db.prepare('SELECT MIN(id) AS id FROM events').get() as { id: number | null };
    const latest = this.latestId();
    if (afterId > latest) return null; // id from a different server or a wiped log
    if (oldest.id !== null && afterId < Number(oldest.id) - 1) return null;
    const rows = this.db
      .prepare('SELECT id, type, at, data FROM events WHERE id > ? ORDER BY id')
      .all(afterId) as { id: number; type: EventType; at: string; data: string }[];
    return rows.map((r) => ({ id: Number(r.id), type: r.type, at: r.at, data: JSON.parse(r.data) }));
  }

  latestId(): number {
    const row = this.db.prepare('SELECT MAX(id) AS id FROM events').get() as { id: number | null };
    return Number(row.id ?? 0);
  }

  private trim() {
    this.sinceTrim = 0;
    const cutoff = new Date(Date.now() - KEEP_MS).toISOString();
    this.db
      .prepare(
        'DELETE FROM events WHERE id <= (SELECT MAX(id) FROM events) - ? AND at < ?',
      )
      .run(KEEP_EVENTS, cutoff);
  }
}
