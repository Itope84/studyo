// Try Studyo without spending tokens: a fresh copy of the fixture library, jobs played from replay scripts.
// Usage: pnpm demo   (API on :8787, app on :8788 if built with `pnpm build:web`)
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const tmp = mkdtempSync(join(tmpdir(), 'studyo-demo-'));
const lib = join(tmp, 'users', 'demo');
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
    STUDYO_ROOT: tmp,
    STUDYO_ADMIN_USER: 'demo',
    STUDYO_TOKEN: process.env.STUDYO_TOKEN ?? 'demo',
    STUDYO_REPLAY: join(root, 'fixtures/replay'),
  },
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
