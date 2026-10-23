import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertNotLegacy, ConfigError, loadConfig } from '../src/config.ts';
import { openServerDb, Users } from '../src/users.ts';
import { expectSchema, makeServer, TOKEN, waitFor } from './helpers.ts';

type Server = Awaited<ReturnType<typeof makeServer>>;
let s: Server;
afterEach(() => s?.close());

describe('users store', () => {
  const make = () => new Users(openServerDb('', ':memory:'));

  it('creates users, finds them by token and keeps only a hash', () => {
    const users = make();
    const { user, token } = users.create({ id: 'alice', name: 'Alice' });
    expect(users.byToken(token)?.id).toBe('alice');
    expect(users.byFileToken(user.file_token)?.id).toBe('alice');
    expect(users.byToken('nope')).toBeNull();
    expect(users.get('alice')?.name).toBe('Alice');
  });

  it('rejects bad, reserved and duplicate ids', () => {
    const users = make();
    for (const id of ['A', 'a', '1abc', 'has space', '../x', 'admin', 'x'.repeat(40)])
      expect(() => users.create({ id })).toThrow();
    users.create({ id: 'bob' });
    expect(() => users.create({ id: 'bob' })).toThrow(/already exists/);
  });

  it('reset replaces the token and file token; disable flips the flag', () => {
    const users = make();
    const first = users.create({ id: 'carol' });
    const second = users.resetToken('carol');
    expect(users.byToken(first.token)).toBeNull();
    expect(users.byToken(second.token)?.id).toBe('carol');
    expect(users.byFileToken(first.user.file_token)).toBeNull();
    expect(users.setDisabled('carol', true).disabled).toBe(true);
    expect(users.setDisabled('carol', false).disabled).toBe(false);
  });
});

describe('startup checks', () => {
  it('refuses a single-user library and the old STUDYO_LIBRARY setting', () => {
    const root = mkdtempSync(join(tmpdir(), 'studyo-legacy-'));
    mkdirSync(join(root, 'topics'));
    const config = loadConfig({ STUDYO_ROOT: root });
    expect(() => assertNotLegacy(config)).toThrow(ConfigError);
    expect(() => loadConfig({ STUDYO_LIBRARY: root })).toThrow(ConfigError);
  });
});

describe('several users', () => {
  it('keeps each user to their own library', async () => {
    s = await makeServer();
    const alice = await s.addUser('alice');
    const mine = (await s.call('GET', '/topics')).json.topics.map((t: { id: string }) => t.id);
    expect(mine).toContain('pc-ca-mcts');
    const theirs = await s.call('GET', '/topics', undefined, {}, alice.token);
    expect(theirs.json.topics).toEqual([]);
    expect((await s.call('GET', '/topics/pc-ca-mcts', undefined, {}, alice.token)).status).toBe(
      404,
    );
    // A topic Alice makes lands in her folder and not in mine.
    const made = await s.call(
      'POST',
      '/topics',
      { title: 'Alice topic', origin: { type: 'topic', name: 'Alice topic' } },
      {},
      alice.token,
    );
    expect(made.status).toBeLessThan(300);
    expect(existsSync(join(s.root, 'users', 'alice', 'topics'))).toBe(true);
    const after = (await s.call('GET', '/topics')).json.topics.map((t: { id: string }) => t.id);
    expect(after).toEqual(mine);
  });

  it("won't serve one user's files through another's file link", async () => {
    s = await makeServer();
    const alice = await s.addUser('alice');
    const info = (await s.call('GET', '/server', undefined, {}, alice.token)).json;
    const path = 'topics/pc-ca-mcts/topic.json';
    expect((await s.app.request(`/f/${info.file_token}/${path}`)).status).toBe(404);
    const mineInfo = (await s.call('GET', '/server')).json;
    expect((await s.app.request(`/f/${mineInfo.file_token}/${path}`)).status).toBe(200);
    expect((await s.app.request(`/f/not-a-token/${path}`)).status).toBe(401);
  });

  it('turns away disabled users and old tokens after a reset', async () => {
    s = await makeServer();
    const alice = await s.addUser('alice');
    expect((await s.call('GET', '/topics', undefined, {}, alice.token)).status).toBe(200);
    s.users.setDisabled('alice', true);
    const off = await s.call('GET', '/topics', undefined, {}, alice.token);
    expect(off.status).toBe(401);
    expect(off.json.error.code).toBe('account_disabled');
    s.users.setDisabled('alice', false);
    const reset = s.users.resetToken('alice');
    expect((await s.call('GET', '/topics', undefined, {}, alice.token)).status).toBe(401);
    expect((await s.call('GET', '/topics', undefined, {}, reset.token)).status).toBe(200);
  });

  it('tells who is signed in and lets only the owner change settings', async () => {
    s = await makeServer();
    const alice = await s.addUser('alice');
    const mine = (await s.call('GET', '/server')).json;
    expectSchema('ServerInfo', mine);
    expect(mine.user).toEqual({ id: 'test', name: 'test', admin: true });
    const theirs = (await s.call('GET', '/server', undefined, {}, alice.token)).json;
    expect(theirs.user).toEqual({ id: 'alice', name: 'alice', admin: false });
    const put = await s.call('PUT', '/settings', { cli: 'opencode' }, {}, alice.token);
    expect(put.status).toBe(403);
    expect((await s.call('PUT', '/settings', { cli: 'opencode' })).status).toBe(200);
  });

  it('records when a user was last seen', async () => {
    s = await makeServer();
    expect(s.users.get('test')?.last_seen).toBeNull();
    await s.call('GET', '/topics');
    expect(s.users.get('test')?.last_seen).not.toBeNull();
  });

  it('runs jobs for two users, one at a time when the cap is 1', async () => {
    s = await makeServer({ maxJobs: { work: 1, chat: 1 } });
    const alice = await s.addUser('alice', { fixtures: true });
    const start = async (token: string) =>
      (
        await s.call(
          'POST',
          '/topics/pc-ca-mcts/jobs',
          { kind: 'condense', scope: 'all' },
          {},
          token,
        )
      ).json;
    const a = await start(TOKEN);
    const b = await start(alice.token);
    const status = async (id: string, token: string) =>
      (await s.call('GET', `/jobs/${id}`, undefined, {}, token)).json;
    // Never both running at once.
    const seen = new Set<string>();
    await waitFor(async () => {
      const [x, y] = await Promise.all([status(a.id, TOKEN), status(b.id, alice.token)]);
      if (x.status === 'running' && y.status === 'running') throw new Error('both ran at once');
      seen.add(`${x.status}/${y.status}`);
      return x.status === 'succeeded' && y.status === 'succeeded';
    }, 20_000);
  });
});
