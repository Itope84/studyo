import { execFile, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface SpawnResult {
  exitCode: number | null;
  cancelled: boolean;
}

/** Run a CLI that prints one JSON object per line. Kills it (and its children) on abort. */
export function spawnJsonLines(
  cmd: string,
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv; signal: AbortSignal },
  onJson: (value: Record<string, unknown>) => void,
  onStderr: (line: string) => void,
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    let cancelled = false;
    const kill = () => {
      cancelled = true;
      try {
        if (child.pid) process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
      setTimeout(() => {
        try {
          if (child.pid) process.kill(-child.pid, 'SIGKILL');
        } catch {}
      }, 5000).unref();
    };
    if (opts.signal.aborted) kill();
    opts.signal.addEventListener('abort', kill, { once: true });

    createInterface({ input: child.stdout }).on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        onJson(JSON.parse(trimmed));
      } catch {
        onStderr(trimmed);
      }
    });
    createInterface({ input: child.stderr }).on('line', (line) => {
      if (line.trim()) onStderr(line);
    });
    child.on('error', (err) => {
      onStderr(`Could not start ${cmd}: ${err.message}`);
      resolve({ exitCode: 127, cancelled });
    });
    child.on('close', (code) => {
      opts.signal.removeEventListener('abort', kill);
      resolve({ exitCode: code, cancelled });
    });
  });
}

export function cliVersion(cmd: string): Promise<{ installed: boolean; version: string | null }> {
  return new Promise((resolve) => {
    execFile(cmd, ['--version'], { timeout: 10_000 }, (err, stdout) => {
      if (err) resolve({ installed: false, version: null });
      else resolve({ installed: true, version: stdout.trim().split('\n')[0] ?? null });
    });
  });
}
