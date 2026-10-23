import { createHmac } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const VERSION = '0.1.0';

export interface ServerConfig {
  /** The folder that holds `users/` and the server-wide `_studyo/`. */
  root: string;
  stateDir: string;
  usersDir: string;
  backupDir: string;
  port: number;
  host: string;
  skillsDir: string;
  origins: string[] | '*';
  /** Where the Access sign-in hand-off may send the token back to (app origins and the app's URL scheme). */
  appReturns: string[];
  /** Replace real CLIs with the replay adapter (tests, demos). */
  replayDir: string | null;
  /** Server-wide caps on concurrent CLI runs. */
  maxJobs: { work: number; chat: number };
  /** Used only when the users table is empty (fresh install, demo, e2e, tests). */
  bootstrap: { id: string; token: string | null };
}

export interface ProfileConfig {
  user: { id: string };
  library: string;
  stateDir: string;
  fileToken: string;
  skillsDir: string;
  replayDir: string | null;
}

/** Thrown at start-up for a setup the server can't run; `index.ts` prints it and exits. */
export class ConfigError extends Error {}

export function deriveFileToken(token: string): string {
  return createHmac('sha256', token).update('studyo-files').digest('hex').slice(0, 32);
}

/** Read config from env, creating the state dir, token and skills link on first run. */
/** Settings kept in `<repo>/.env` (gitignored), so a login item or launchd sees the same values as a shell. */
export function loadDotEnv(file = join(REPO_ROOT, '.env')) {
  if (!existsSync(file)) return;
  try {
    process.loadEnvFile(file);
  } catch (e) {
    console.warn(`Could not read ${file}: ${(e as Error).message}`);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  if (env.STUDYO_LIBRARY && !env.STUDYO_ROOT)
    throw new ConfigError(
      'STUDYO_LIBRARY was replaced by STUDYO_ROOT (the folder that holds users/). See docs/multi-user-plan.md.',
    );
  const root = resolve(env.STUDYO_ROOT ?? join(REPO_ROOT, 'library'));
  const stateDir = join(root, '_studyo');
  const usersDir = join(root, 'users');
  for (const dir of [root, usersDir, stateDir]) mkdirSync(dir, { recursive: true });
  const skillsDir = resolve(env.STUDYO_SKILLS ?? join(REPO_ROOT, 'skills'));

  const origins = env.STUDYO_ORIGINS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const count = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : fallback;
  };

  return {
    root,
    stateDir,
    usersDir,
    backupDir: resolve(env.STUDYO_BACKUP_DIR ?? join(homedir(), 'Backups', 'studyo')),
    port: Number(env.STUDYO_PORT ?? 8787),
    host: env.STUDYO_HOST ?? '0.0.0.0',
    skillsDir,
    origins: origins?.length ? origins : '*',
    appReturns: [
      ...(origins ?? []),
      ...(env.STUDYO_APP_URLS?.split(',')
        .map((s) => s.trim())
        .filter(Boolean) ?? []),
    ],
    replayDir: env.STUDYO_REPLAY ? resolve(env.STUDYO_REPLAY) : null,
    maxJobs: { work: count(env.STUDYO_MAX_WORK, 2), chat: count(env.STUDYO_MAX_CHAT, 3) },
    bootstrap: {
      id: env.STUDYO_ADMIN_USER?.trim() || 'me',
      token: env.STUDYO_TOKEN?.trim() || null,
    },
  };
}

/** Stop a server that would start on top of a single-user library: it would make an empty profile beside it. */
export function assertNotLegacy(config: ServerConfig) {
  if (existsSync(join(config.root, 'topics')))
    throw new ConfigError(
      'This library is still in the single-user layout. Stop the server and run `pnpm users migrate --id <you>`.',
    );
}

/** The paths for one user's profile. Creates the folder skeleton and links the skills. */
export function profileConfig(
  server: ServerConfig,
  user: { id: string; file_token: string },
): ProfileConfig {
  const library = join(server.usersDir, user.id);
  const stateDir = join(library, '_studyo');
  for (const dir of [library, join(library, 'topics'), join(library, 'inbox'), stateDir]) {
    mkdirSync(dir, { recursive: true });
  }
  linkSkills(library, server.skillsDir);
  return {
    user: { id: user.id },
    library,
    stateDir,
    fileToken: user.file_token,
    skillsDir: server.skillsDir,
    replayDir: server.replayDir,
  };
}

/** Both CLIs read skills from `<project>/.claude/skills`; the library is the project dir. */
export function linkSkills(library: string, skillsDir: string) {
  const claudeDir = join(library, '.claude');
  const link = join(claudeDir, 'skills');
  mkdirSync(claudeDir, { recursive: true });
  try {
    lstatSync(link);
  } catch {
    if (existsSync(skillsDir)) symlinkSync(skillsDir, link);
  }
}
