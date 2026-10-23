import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { nowIso } from './util.ts';

export interface User {
  id: string;
  name: string;
  admin: boolean;
  disabled: boolean;
  created: string;
  last_seen: string | null;
  file_token: string;
}

interface UserRow {
  id: string;
  name: string;
  admin: number;
  disabled: number;
  created: string;
  last_seen: string | null;
  file_token: string;
}

export const USER_ID = /^[a-z][a-z0-9-]{1,31}$/;
const RESERVED = new Set(['admin', 'users', 'root', 'system']);

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(24).toString('base64url');
export const newFileToken = () => randomBytes(16).toString('hex');

/** The server-wide database: who the users are. Their work lives in their own folders. */
export function openServerDb(stateDir: string, file = 'server.db'): DatabaseSync {
  if (file !== ':memory:') mkdirSync(stateDir, { recursive: true });
  const db = new DatabaseSync(file === ':memory:' ? file : join(stateDir, file));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      file_token TEXT NOT NULL UNIQUE,
      admin INTEGER NOT NULL DEFAULT 0,
      disabled INTEGER NOT NULL DEFAULT 0,
      created TEXT NOT NULL,
      last_seen TEXT
    );
  `);
  return db;
}

const COLUMNS = 'id, name, admin, disabled, created, last_seen, file_token';

const toUser = (r: UserRow): User => ({
  id: r.id,
  name: r.name,
  admin: !!r.admin,
  disabled: !!r.disabled,
  created: r.created,
  last_seen: r.last_seen,
  file_token: r.file_token,
});

const TOUCH_EVERY_MS = 60_000;

/** Reads always go to the database, so changes made from the `users` command apply on the next request. */
export class Users {
  private touched = new Map<string, number>();

  constructor(private db: DatabaseSync) {}

  list(): User[] {
    return (
      this.db
        .prepare(`SELECT ${COLUMNS} FROM users ORDER BY created, id`)
        .all() as unknown as UserRow[]
    ).map(toUser);
  }

  get(id: string): User | null {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?`).get(id) as unknown as
      | UserRow
      | undefined;
    return row ? toUser(row) : null;
  }

  byToken(token: string): User | null {
    if (!token) return null;
    const row = this.db
      .prepare(`SELECT ${COLUMNS} FROM users WHERE token_hash = ?`)
      .get(hashToken(token)) as unknown as UserRow | undefined;
    return row ? toUser(row) : null;
  }

  byFileToken(fileToken: string): User | null {
    if (!fileToken) return null;
    const row = this.db
      .prepare(`SELECT ${COLUMNS} FROM users WHERE file_token = ?`)
      .get(fileToken) as unknown as UserRow | undefined;
    return row ? toUser(row) : null;
  }

  count(): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n);
  }

  create(input: {
    id: string;
    name?: string;
    admin?: boolean;
    token?: string;
    fileToken?: string;
  }): { user: User; token: string } {
    if (!USER_ID.test(input.id) || RESERVED.has(input.id))
      throw new Error(
        `"${input.id}" can't be a user id. Use 2-32 lowercase letters, digits or dashes, starting with a letter.`,
      );
    if (this.get(input.id)) throw new Error(`The user "${input.id}" already exists.`);
    const token = input.token ?? newToken();
    this.db
      .prepare(
        'INSERT INTO users (id, name, token_hash, file_token, admin, disabled, created) VALUES (?, ?, ?, ?, ?, 0, ?)',
      )
      .run(
        input.id,
        input.name?.trim() || input.id,
        hashToken(token),
        input.fileToken ?? newFileToken(),
        input.admin ? 1 : 0,
        nowIso(),
      );
    return { user: this.require(input.id), token };
  }

  /** A new token and file token; the old ones stop working. */
  resetToken(id: string): { user: User; token: string } {
    this.require(id);
    const token = newToken();
    this.db
      .prepare('UPDATE users SET token_hash = ?, file_token = ? WHERE id = ?')
      .run(hashToken(token), newFileToken(), id);
    return { user: this.require(id), token };
  }

  setDisabled(id: string, disabled: boolean): User {
    this.require(id);
    this.db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, id);
    return this.require(id);
  }

  /** Record that the user was seen; written at most once a minute per user. */
  touch(id: string) {
    const now = Date.now();
    if (now - (this.touched.get(id) ?? 0) < TOUCH_EVERY_MS) return;
    this.touched.set(id, now);
    this.db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(nowIso(), id);
  }

  private require(id: string): User {
    const user = this.get(id);
    if (!user) throw new Error(`There is no user "${id}".`);
    return user;
  }
}
