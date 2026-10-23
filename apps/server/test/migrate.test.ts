import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import webpush from 'web-push';
import { backupUser, tarEntries } from '../src/cli/backup.ts';
import { migrateLibrary } from '../src/cli/migrate.ts';
import { deriveFileToken, REPO_ROOT } from '../src/config.ts';
import { openDb } from '../src/db.ts';
import { createServer } from '../src/server.ts';
import { testConfig } from './helpers.ts';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

function legacy() {
  const parent = mkdtempSync(join(tmpdir(), 'studyo-migrate-'));
  const root = join(parent, 'library');
  cpSync(join(REPO_ROOT, 'fixtures/library'), root, { recursive: true });
  mkdirSync(join(root, '_studyo'), { recursive: true });
  writeFileSync(join(root, '_studyo', 'token'), 'old-token\n');
  writeFileSync(join(root, '_studyo', 'vapid.json'), JSON.stringify(webpush.generateVAPIDKeys()));
  writeFileSync(join(root, '_studyo', 'server.log'), 'log');
  writeFileSync(
    join(root, '_studyo', 'settings.json'),
    '{"cli":"opencode","models":{"opencode":"m"}}',
  );
  openDb(join(root, '_studyo')).close();
  const config = { ...testConfig(root), backupDir: join(parent, 'backups') };
  return { root, config };
}

describe('migrate', () => {
  it('moves the library under users/<id> and keeps the old login working', async () => {
    const { root, config } = legacy();
    const log: string[] = [];
    const result = await migrateLibrary(config, {
      id: 'temitope',
      name: 'Temitope',
      serverRunning: async () => false,
      env: {},
      log: (l) => log.push(l),
    });
    expect(existsSync(join(root, 'topics'))).toBe(false);
    expect(existsSync(join(root, 'users', 'temitope', 'topics', 'pc-ca-mcts', 'topic.json'))).toBe(
      true,
    );
    expect(existsSync(join(root, 'users', 'temitope', 'profile.md'))).toBe(
      existsSync(join(REPO_ROOT, 'fixtures/library/profile.md')),
    );
    expect(existsSync(join(root, 'users', 'temitope', '_studyo', 'studyo.db'))).toBe(true);
    expect(
      readFileSync(join(root, 'users', 'temitope', '_studyo', 'settings.json'), 'utf8'),
    ).toContain('opencode');
    expect(existsSync(join(root, '_studyo', 'vapid.json'))).toBe(true);
    expect(existsSync(join(root, '_studyo', 'server.log'))).toBe(true);
    expect(existsSync(join(root, '_studyo', 'token'))).toBe(false);
    expect(tarEntries(result.backup)).toBeGreaterThan(0);

    const server = await createServer(config, { watch: false });
    close = () => server.close();
    const res = await server.app.request('/topics', {
      headers: { Authorization: 'Bearer old-token' },
    });
    expect(res.status).toBe(200);
    const topics = ((await res.json()) as { topics: { id: string }[] }).topics;
    expect(topics.map((t) => t.id)).toContain('pc-ca-mcts');
    const user = server.users.get('temitope');
    expect(user?.admin).toBe(true);
    expect(user?.file_token).toBe(deriveFileToken('old-token'));
  });

  it('refuses while the server is running, or when already migrated', async () => {
    const { config } = legacy();
    await expect(
      migrateLibrary(config, { id: 'me', serverRunning: async () => true, env: {} }),
    ).rejects.toThrow(/running/);
    await migrateLibrary(config, { id: 'me', serverRunning: async () => false, env: {} });
    await expect(
      migrateLibrary(config, { id: 'me', serverRunning: async () => false, env: {} }),
    ).rejects.toThrow();
  });
});

describe('backup', () => {
  it('archives a user folder with a consistent database snapshot', async () => {
    const { config } = legacy();
    await migrateLibrary(config, { id: 'me', serverRunning: async () => false, env: {} });
    const r = backupUser(config.usersDir, config.backupDir, 'me');
    expect(r.bytes).toBeGreaterThan(0);
    expect(tarEntries(r.file)).toBeGreaterThan(5);
  });
});
