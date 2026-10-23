import { networkInterfaces } from 'node:os';
import { join, relative } from 'node:path';
import { serve } from '@hono/node-server';
import { assertNotLegacy, ConfigError, loadConfig, loadDotEnv, REPO_ROOT } from './config.ts';
import { createServer } from './server.ts';
import { webApp } from './web.ts';

process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name !== 'ExperimentalWarning') console.warn(w);
});

loadDotEnv();
let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig();
  assertNotLegacy(config);
} catch (e) {
  if (e instanceof ConfigError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}
const { app, close, users, created, shared } = await createServer(config);

/** The first LAN or Tailscale address, so the setup link works from a phone. */
function lanAddress(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return 'localhost';
}

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`Studyo API on http://localhost:${info.port}`);
  console.log(`Library root: ${config.root}`);
  console.log(
    `${users.list().length} users: ${users
      .list()
      .map((u) => `${u.id}${u.admin ? ' (admin)' : ''}${u.disabled ? ' (disabled)' : ''}`)
      .join(', ')}`,
  );
  console.log(
    `Job slots: work ${shared.slots.stats().work.max}, chat ${shared.slots.stats().chat.max}`,
  );
  console.log('Invite links: pnpm users add <id>   Reset a login: pnpm users reset <id>');
  if (created) console.log(`Created admin user ${created.id}. Token: ${created.token}`);
  if (config.replayDir)
    console.log(`Replay mode (no CLI, no tokens): scripts from ${config.replayDir}`);
});

const webDir = process.env.STUDYO_WEB_DIR ?? join(REPO_ROOT, 'apps/app/dist');
const web = webApp(webDir, app);
const webPort = Number(process.env.STUDYO_WEB_PORT ?? config.port + 1);
const webServer = web
  ? serve({ fetch: web.fetch, port: webPort, hostname: config.host }, () => {
      const host = lanAddress();
      const link = created
        ? `http://${host}:${webPort}/connect?server=${encodeURIComponent(`http://${host}:${config.port}`)}&token=${encodeURIComponent(created.token)}`
        : null;
      console.log(
        `Web app on http://localhost:${webPort} (from ${relative(process.cwd(), webDir) || webDir})`,
      );
      if (link) console.log(`Setup link (connects straight away): ${link}`);
    })
  : null;
if (!web) console.log('No web build found; run `pnpm build:web` to serve the app from here too.');

const shutdown = () => {
  server.close();
  webServer?.close();
  void close().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
