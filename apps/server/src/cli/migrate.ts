import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { deriveFileToken, type ServerConfig } from '../config.ts';
import { openServerDb, Users } from '../users.ts';
import { backupLibrary } from './backup.ts';

export interface MigrateOptions {
  id: string;
  name?: string;
  /** True when a server is answering; migrating under a running server would corrupt its database. */
  serverRunning: () => Promise<boolean>;
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
}

export interface MigrateResult {
  backup: string;
  movedLibrary: string[];
  movedState: string[];
  activeJobs: number;
}

const STAY_IN_ROOT = new Set(['_studyo', 'users', '_backups', '.gitkeep', '.DS_Store']);
const STAY_IN_STATE = new Set([
  'server.log',
  'token',
  'vapid.json',
  'server.db',
  'server.db-wal',
  'server.db-shm',
]);

/** Move a single-user library to `users/<id>/`, keeping the old token as that user's login. Backs up first. */
export async function migrateLibrary(
  config: ServerConfig,
  opts: MigrateOptions,
): Promise<MigrateResult> {
  const log = opts.log ?? (() => {});
  const env = opts.env ?? process.env;
  const dest = join(config.usersDir, opts.id);
  const state = join(config.root, '_studyo');

  if (!existsSync(join(config.root, 'topics')))
    throw new Error(`${config.root} is not in the single-user layout (no topics/ folder).`);
  if (existsSync(dest)) throw new Error(`${dest} already exists.`);
  if (await opts.serverRunning())
    throw new Error(
      'The server is running. Stop it first: launchctl bootout gui/$(id -u)/com.studyo.server',
    );
  const serverDb = openServerDb(config.stateDir);
  const users = new Users(serverDb);
  if (users.count() > 0) {
    serverDb.close();
    throw new Error(
      'The server already has users; migrate only runs on a fresh single-user library.',
    );
  }
  const tokenFile = join(state, 'token');
  const oldToken =
    env.STUDYO_TOKEN?.trim() ||
    (existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : '');
  if (!oldToken) {
    serverDb.close();
    throw new Error('Could not find the current access token (STUDYO_TOKEN or _studyo/token).');
  }

  // Jobs: queued and waiting ones carry over; running ones fail on the next start, as after any restart.
  let activeJobs = 0;
  const oldDb = join(state, 'studyo.db');
  if (existsSync(oldDb)) {
    const db = new DatabaseSync(oldDb);
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      const rows = db
        .prepare(
          "SELECT id, kind, status, topic_id FROM jobs WHERE status IN ('queued','running','needs_input')",
        )
        .all() as { id: string; kind: string; status: string; topic_id: string }[];
      activeJobs = rows.length;
      for (const r of rows) log(`  active job ${r.id}: ${r.kind} on ${r.topic_id} (${r.status})`);
    } finally {
      db.close();
    }
  }

  log('Backing up the library first...');
  const backup = backupLibrary(config.root, config.backupDir);
  log(`  ${backup.file} (${(backup.bytes / 1048576).toFixed(0)} MB)`);

  mkdirSync(join(dest, '_studyo'), { recursive: true });
  const movedLibrary: string[] = [];
  for (const entry of readdirSync(config.root)) {
    if (STAY_IN_ROOT.has(entry)) continue;
    renameSync(join(config.root, entry), join(dest, entry));
    movedLibrary.push(entry);
  }
  const movedState: string[] = [];
  for (const entry of readdirSync(state)) {
    if (STAY_IN_STATE.has(entry)) continue;
    renameSync(join(state, entry), join(dest, '_studyo', entry));
    movedState.push(entry);
  }

  users.create({
    id: opts.id,
    name: opts.name,
    admin: true,
    token: oldToken,
    fileToken: deriveFileToken(oldToken),
  });
  serverDb.close();
  rmSync(tokenFile, { force: true });
  return { backup: backup.file, movedLibrary, movedState, activeJobs };
}
