import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface JobRow {
  id: string;
  kind: string;
  status: string;
  topic_id: string;
  created: string;
  started: string | null;
  finished: string | null;
  error: string | null;
}

/** Open a user's job database read-only; null when they have none yet. */
function openJobs(usersDir: string, id: string): DatabaseSync | null {
  const file = join(usersDir, id, '_studyo', 'studyo.db');
  if (!existsSync(file)) return null;
  try {
    return new DatabaseSync(file, { readOnly: true });
  } catch {
    return null;
  }
}

export interface UserStats {
  ok7: number;
  failed7: number;
  active: number;
  topics: number;
  courses: number;
}

export function userStats(usersDir: string, id: string): UserStats {
  const out: UserStats = { ok7: 0, failed7: 0, active: 0, topics: 0, courses: 0 };
  const db = openJobs(usersDir, id);
  if (db) {
    try {
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const count = (sql: string, ...args: string[]) =>
        Number((db.prepare(sql).get(...args) as { n: number }).n);
      out.ok7 = count(
        "SELECT COUNT(*) AS n FROM jobs WHERE status = 'succeeded' AND created >= ?",
        since,
      );
      out.failed7 = count(
        "SELECT COUNT(*) AS n FROM jobs WHERE status = 'failed' AND created >= ?",
        since,
      );
      out.active = count(
        "SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','running','needs_input')",
      );
    } catch {
      // A database mid-migration or locked: show zeros rather than fail the listing.
    } finally {
      db.close();
    }
  }
  out.topics = countDirs(join(usersDir, id, 'topics'));
  out.courses = countDirs(join(usersDir, id, 'courses'));
  return out;
}

function countDirs(dir: string): number {
  try {
    return Number(
      execFileSync('find', [dir, '-mindepth', '1', '-maxdepth', '1', '-type', 'd'], {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .split('\n')
        .filter(Boolean).length,
    );
  } catch {
    return 0;
  }
}

export function recentJobs(
  usersDir: string,
  id: string,
  limit: number,
  failedOnly: boolean,
): JobRow[] {
  const db = openJobs(usersDir, id);
  if (!db) return [];
  try {
    return db
      .prepare(
        `SELECT id, kind, status, topic_id, created, started, finished, error FROM jobs ${failedOnly ? "WHERE status = 'failed'" : ''} ORDER BY created DESC LIMIT ?`,
      )
      .all(limit) as unknown as JobRow[];
  } finally {
    db.close();
  }
}

/** Folder size in MB (du, so it counts what is on disk). */
export function folderMb(dir: string): number {
  try {
    const kb = Number(execFileSync('du', ['-sk', dir]).toString().split(/\s+/)[0]);
    return Math.round(kb / 1024);
  } catch {
    return 0;
  }
}

export function ago(iso: string | null): string {
  if (!iso) return 'never';
  const secs = (Date.now() - Date.parse(iso)) / 1000;
  if (secs < 90) return 'just now';
  if (secs < 5400) return `${Math.round(secs / 60)} min ago`;
  if (secs < 129_600) return `${Math.round(secs / 3600)} h ago`;
  return `${Math.round(secs / 86_400)} d ago`;
}

export function duration(job: JobRow): string {
  if (!job.started || !job.finished) return '-';
  const secs = Math.round((Date.parse(job.finished) - Date.parse(job.started)) / 1000);
  return secs < 90 ? `${secs}s` : `${Math.round(secs / 60)}m`;
}
