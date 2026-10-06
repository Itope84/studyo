// For e2e/offline.spec.ts: a production web build (the service worker only runs there) served by a replay
// server on a throwaway copy of the fixtures. API on :8793, web app on :8794.
import { execSync, spawn } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
// A fixed place, so the spec can make a "new build" in it (see e2e/offline.spec.ts).
const tmp = join(tmpdir(), 'studyo-offline-e2e');
rmSync(tmp, { recursive: true, force: true });
const web = join(tmp, 'web');
const lib = join(tmp, 'library');
execSync(`pnpm --filter @studyo/app exec expo export --platform web --output-dir ${web}`, {
  cwd: root,
  stdio: 'inherit',
});
execSync(`node scripts/build-sw.mjs ${web}`, { cwd: root, stdio: 'inherit' });
cpSync(join(root, 'fixtures/library'), lib, { recursive: true });
cpSync(
  join(root, 'fixtures/media/deep-dive.m4a'),
  join(lib, 'topics/pc-ca-mcts/outputs/deep-dive.m4a'),
);
const child = spawn('pnpm', ['--filter', '@studyo/server', 'start'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    STUDYO_LIBRARY: lib,
    STUDYO_TOKEN: 'e2e-token',
    STUDYO_PORT: '8793',
    STUDYO_WEB_PORT: '8794',
    STUDYO_WEB_DIR: web,
    STUDYO_REPLAY: join(root, 'fixtures/replay'),
  },
});
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
