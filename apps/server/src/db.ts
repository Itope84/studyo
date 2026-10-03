import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

export function openDb(stateDir: string, file = 'studyo.db'): Db {
  const db = new DatabaseSync(file === ':memory:' ? file : join(stateDir, file));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      lane TEXT NOT NULL,
      status TEXT NOT NULL,
      cli TEXT NOT NULL,
      params TEXT NOT NULL DEFAULT '{}',
      activity TEXT,
      questions TEXT,
      pending_input TEXT,
      error TEXT,
      suggest_enrich TEXT,
      session_id TEXT,
      created TEXT NOT NULL,
      started TEXT,
      finished TEXT
    );
    CREATE INDEX IF NOT EXISTS jobs_topic ON jobs(topic_id, created);
    CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);
    CREATE TABLE IF NOT EXISTS job_log (
      job_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      at TEXT NOT NULL,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      PRIMARY KEY (job_id, seq)
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created TEXT NOT NULL
    );
  `);
  // Columns added after the first release.
  const cols = new Set(
    (db.prepare('PRAGMA table_info(jobs)').all() as { name: string }[]).map((c) => c.name),
  );
  if (!cols.has('step')) db.exec('ALTER TABLE jobs ADD COLUMN step TEXT');
  return db;
}
