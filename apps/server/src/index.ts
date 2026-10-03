import { networkInterfaces } from 'node:os';
import { join, relative } from 'node:path';
import { serve } from '@hono/node-server';
import { createServer } from './app.ts';
import { loadConfig, REPO_ROOT } from './config.ts';
import { webApp } from './web.ts';

process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name !== 'ExperimentalWarning') console.warn(w);
});

const config = loadConfig();
const { app, close } = await createServer(config);

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
  console.log(`Library: ${config.library}`);
  console.log(`Access token: ${config.token}`);
  if (config.replayDir)
    console.log(`Replay mode (no CLI, no tokens): scripts from ${config.replayDir}`);
});

const webDir = process.env.STUDYO_WEB_DIR ?? join(REPO_ROOT, 'apps/app/dist');
const web = webApp(webDir, app);
const webPort = Number(process.env.STUDYO_WEB_PORT ?? config.port + 1);
const webServer = web
  ? serve({ fetch: web.fetch, port: webPort, hostname: config.host }, () => {
      const host = lanAddress();
      const link = `http://${host}:${webPort}/connect?server=${encodeURIComponent(`http://${host}:${config.port}`)}&token=${encodeURIComponent(config.token)}`;
      console.log(
        `Web app on http://localhost:${webPort} (from ${relative(process.cwd(), webDir) || webDir})`,
      );
      console.log(`Setup link (connects straight away): ${link}`);
      console.log(
        `Behind a tunnel (one hostname for app and API): https://<host>/connect?server=https://<host>/api&token=${encodeURIComponent(config.token)}`,
      );
    })
  : null;
if (!web) console.log('No web build found; run `pnpm build:web` to serve the app from here too.');

const shutdown = () => {
  server.close();
  webServer?.close();
  close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
