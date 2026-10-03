import { createHmac, randomBytes } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const VERSION = '0.1.0';

export interface Config {
  library: string;
  port: number;
  host: string;
  token: string;
  fileToken: string;
  stateDir: string;
  skillsDir: string;
  origins: string[] | '*';
  /** Where the Access sign-in hand-off may send the token back to (app origins and the app's URL scheme). */
  appReturns: string[];
  /** Replace real CLIs with the replay adapter (tests, demos). */
  replayDir: string | null;
}

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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const library = resolve(env.STUDYO_LIBRARY ?? join(REPO_ROOT, 'library'));
  const stateDir = join(library, '_studyo');
  for (const dir of [library, join(library, 'topics'), join(library, 'inbox'), stateDir]) {
    mkdirSync(dir, { recursive: true });
  }

  let token = env.STUDYO_TOKEN;
  if (!token) {
    const tokenFile = join(stateDir, 'token');
    if (existsSync(tokenFile)) token = readFileSync(tokenFile, 'utf8').trim();
    else {
      token = randomBytes(24).toString('base64url');
      writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });
    }
  }

  const skillsDir = resolve(env.STUDYO_SKILLS ?? join(REPO_ROOT, 'skills'));
  linkSkills(library, skillsDir);

  const origins = env.STUDYO_ORIGINS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    library,
    port: Number(env.STUDYO_PORT ?? 8787),
    host: env.STUDYO_HOST ?? '0.0.0.0',
    token,
    fileToken: deriveFileToken(token),
    stateDir,
    skillsDir,
    origins: origins?.length ? origins : '*',
    appReturns: [
      ...(origins ?? []),
      ...(env.STUDYO_APP_URLS?.split(',')
        .map((s) => s.trim())
        .filter(Boolean) ?? []),
    ],
    replayDir: env.STUDYO_REPLAY ? resolve(env.STUDYO_REPLAY) : null,
  };
}

/** Both CLIs read skills from `<project>/.claude/skills`; the library is the project dir. */
function linkSkills(library: string, skillsDir: string) {
  const claudeDir = join(library, '.claude');
  const link = join(claudeDir, 'skills');
  mkdirSync(claudeDir, { recursive: true });
  try {
    lstatSync(link);
  } catch {
    if (existsSync(skillsDir)) symlinkSync(skillsDir, link);
  }
}
