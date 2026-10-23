import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

export interface BackupResult {
  file: string;
  bytes: number;
}

/** How many entries a tarball lists; throws if it can't be read. */
export function tarEntries(file: string): number {
  const out = execFileSync('tar', ['-tzf', file], { maxBuffer: 256 * 1024 * 1024 }).toString();
  return out.split('\n').filter(Boolean).length;
}

/**
 * One user's folder as `<backupDir>/<id>-<time>.tar.gz`. The job database is copied with VACUUM INTO so the
 * snapshot is consistent while the server runs; uploads (temporary) and the skills link are left out.
 * The folder is cloned first (instant on APFS) so the archive never races with running jobs' writes.
 */
export function backupUser(usersDir: string, backupDir: string, id: string): BackupResult {
  const source = join(usersDir, id);
  if (!existsSync(source)) throw new Error(`There is no folder for "${id}" at ${source}.`);
  mkdirSync(backupDir, { recursive: true });
  const staging = join(backupDir, `.staging-${id}-${process.pid}`);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  const copy = join(staging, id);
  try {
    try {
      execFileSync('cp', ['-cR', source, copy], { stdio: 'ignore' });
    } catch {
      rmSync(copy, { recursive: true, force: true });
      execFileSync('cp', ['-R', source, copy], { stdio: 'ignore' });
    }
    const state = join(copy, '_studyo');
    rmSync(join(state, 'uploads'), { recursive: true, force: true });
    rmSync(join(copy, '.claude'), { recursive: true, force: true });
    for (const f of ['studyo.db', 'studyo.db-wal', 'studyo.db-shm'])
      rmSync(join(state, f), { force: true });
    const live = join(source, '_studyo', 'studyo.db');
    if (existsSync(live)) {
      const db = new DatabaseSync(live);
      try {
        db.exec(`VACUUM INTO '${join(state, 'studyo.db').replace(/'/g, "''")}'`);
      } finally {
        db.close();
      }
    }
    const file = join(backupDir, `${id}-${stamp()}.tar.gz`);
    execFileSync('tar', ['-czf', file, '-C', staging, id]);
    if (tarEntries(file) === 0) throw new Error('The backup is empty.');
    return { file, bytes: statSync(file).size };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/** The whole single-user library folder as one tarball, before migrating it. */
export function backupLibrary(root: string, backupDir: string): BackupResult {
  mkdirSync(backupDir, { recursive: true });
  const file = join(backupDir, `library-pre-multiuser-${stamp()}.tar.gz`);
  const parent = join(root, '..');
  const name = root.split('/').filter(Boolean).pop() as string;
  execFileSync('tar', [
    '-czf',
    file,
    '--exclude',
    `${name}/_studyo/server.log`,
    '-C',
    parent,
    name,
  ]);
  if (tarEntries(file) === 0 || statSync(file).size === 0) throw new Error('The backup is empty.');
  return { file, bytes: statSync(file).size };
}
