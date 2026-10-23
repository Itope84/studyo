import { mkdirSync } from 'node:fs';
import type { CliId } from '@studyo/api';
import { type Context, Hono } from 'hono';
import { cors } from 'hono/cors';
import { claudeAdapter } from './adapters/claude.ts';
import { opencodeAdapter } from './adapters/opencode.ts';
import { replayAdapter } from './adapters/replay.ts';
import type { CliAdapter } from './adapters/types.ts';
import {
  createProfile,
  escapeHtml,
  installErrorHandlers,
  page,
  returnAllowed,
  type ServerOptions,
  type Shared,
} from './app.ts';
import { profileConfig, type ServerConfig, VERSION } from './config.ts';
import { Slots } from './jobs/slots.ts';
import { closePdfBrowser } from './pdf.ts';
import { loadVapid } from './push.ts';
import { openServerDb, type User, Users } from './users.ts';
import { HttpError } from './util.ts';
import { createVoice } from './voice/index.ts';

type Profile = Awaited<ReturnType<typeof createProfile>>;
type Env = { Variables: { user: User } };

/**
 * The whole server: authenticates each request by token, then hands it to that user's own app (their library,
 * jobs, chat and settings). Everything the users share (CLIs, voice, push keys, the job cap) is made here.
 */
export async function createServer(config: ServerConfig, options: ServerOptions = {}) {
  mkdirSync(config.stateDir, { recursive: true });
  const serverDb = openServerDb(
    config.stateDir,
    options.dbFile === ':memory:' ? ':memory:' : undefined,
  );
  const users = new Users(serverDb);

  let created: { id: string; token: string } | null = null;
  if (users.count() === 0) {
    const { user, token } = users.create({
      id: config.bootstrap.id,
      admin: true,
      token: config.bootstrap.token ?? undefined,
    });
    created = { id: user.id, token };
  }

  const adapters: Record<CliId, CliAdapter> = config.replayDir
    ? {
        claude: replayAdapter(config.replayDir, 'claude'),
        opencode: replayAdapter(config.replayDir, 'opencode'),
      }
    : { claude: claudeAdapter(), opencode: opencodeAdapter() };
  Object.assign(adapters, options.adapters);
  const detected = Object.fromEntries(
    await Promise.all(Object.values(adapters).map(async (a) => [a.id, await a.detect()] as const)),
  ) as Shared['detected'];

  const shared: Shared = {
    adapters,
    detected,
    voice: createVoice(config),
    vapid: loadVapid(config.stateDir),
    slots: new Slots(config.maxJobs),
    users,
  };

  const profiles = new Map<string, Promise<Profile>>();
  const getProfile = (user: User) => {
    let p = profiles.get(user.id);
    if (!p) {
      p = createProfile(profileConfig(config, user), shared, options);
      profiles.set(user.id, p);
      p.catch(() => profiles.delete(user.id));
    }
    return p;
  };
  // Start every active user's runner now, so queued and waiting jobs carry on after a restart.
  await Promise.all(
    users
      .list()
      .filter((u) => !u.disabled)
      .map(getProfile),
  );

  const app = new Hono<Env>();

  app.use(
    '*',
    cors({
      origin: config.origins === '*' ? '*' : config.origins,
      allowHeaders: [
        'Authorization',
        'Content-Type',
        'Range',
        'Last-Event-ID',
        'CF-Access-Client-Id',
        'CF-Access-Client-Secret',
        'CF-Access-Token',
      ],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      exposeHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length'],
      maxAge: 600,
    }),
  );
  installErrorHandlers(app);

  // Uploads are logged when they start and finish, so a slow connection shows up in the server's output.
  app.use('*', async (c, next) => {
    const len = Number(c.req.header('Content-Length') ?? 0);
    if (c.req.method !== 'POST' || len < 1024 * 1024) return next();
    const started = Date.now();
    console.log(`upload started: ${c.req.path} ${(len / 1048576).toFixed(1)} MB`);
    await next();
    const secs = (Date.now() - started) / 1000;
    console.log(
      `upload finished: ${c.req.path} ${c.res.status} in ${secs.toFixed(1)}s (${(len / 1048576 / Math.max(secs, 0.01)).toFixed(1)} MB/s)`,
    );
  });

  app.get('/health', (c) => c.json({ ok: true, name: 'studyo' as const, version: VERSION }));

  /**
   * Cloudflare Access hand-off for apps on another hostname (Android, a web app on Pages). The app opens this
   * page in a browser; Access makes the person sign in before the request gets here, then forwards it with
   * their Access token in `Cf-Access-Jwt-Assertion`. We send that token back to the app, which puts it in a
   * `cf-access-token` header on every request. Only allowed return addresses get the token.
   */
  app.get('/auth/access', (c) => {
    const back = c.req.query('return') ?? '';
    if (!returnAllowed(back, config.appReturns)) {
      return c.html(
        page(
          'Return address not allowed',
          `Studyo won't send your sign-in to <code>${escapeHtml(back || '(none)')}</code>. Add the app's address to STUDYO_ORIGINS (web) or STUDYO_APP_URLS on the server.`,
        ),
        400,
      );
    }
    const jwt = c.req.header('Cf-Access-Jwt-Assertion');
    if (!jwt) {
      return c.html(
        page(
          'No Cloudflare Access sign-in',
          'This request did not come through Cloudflare Access, so there is nothing to hand back. If the server is not behind Access, connect without signing in.',
        ),
        400,
      );
    }
    return c.redirect(`${back}#cf_token=${encodeURIComponent(jwt)}`, 302);
  });

  const forward = async (c: Context<Env>, user: User) => {
    users.touch(user.id);
    const profile = await getProfile(user);
    return profile.app.fetch(c.req.raw, c.env);
  };

  // Media and the Reader load from /f/<file token>/… without headers; the token says whose files these are.
  app.all('/f/:token/*', async (c) => {
    const user = users.byFileToken(c.req.param('token'));
    if (!user || user.disabled)
      throw new HttpError(401, 'unauthorized', 'The file link is not valid.');
    return forward(c, user);
  });

  app.use('*', async (c, next) => {
    if (c.req.method === 'OPTIONS') return next();
    const header = c.req.header('Authorization') ?? '';
    const user = users.byToken(header.startsWith('Bearer ') ? header.slice(7) : '');
    if (!user) throw new HttpError(401, 'unauthorized', 'The access token is missing or wrong.');
    if (user.disabled)
      throw new HttpError(
        401,
        'account_disabled',
        'This account is turned off. Ask the person who invited you.',
      );
    c.set('user', user);
    return next();
  });

  app.all('*', (c) => forward(c, c.get('user')));

  const close = async () => {
    for (const p of profiles.values()) (await p).close();
    serverDb.close();
    void closePdfBrowser();
  };

  return { app, close, users, profiles, shared, created, getProfile };
}
