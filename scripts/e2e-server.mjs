// A throwaway library from the fixtures, served in replay mode (no CLI, no tokens spent).
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const lib = mkdtempSync(join(tmpdir(), 'studyo-e2e-'));
cpSync(join(root, 'fixtures/library'), lib, { recursive: true });
// One audio file so the player has something to play.
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
    STUDYO_PORT: '8790',
    STUDYO_REPLAY: join(root, 'fixtures/replay'),
  },
});
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
