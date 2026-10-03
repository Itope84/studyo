import { serve } from '@hono/node-server';
import { createServer } from './app.ts';
import { loadConfig } from './config.ts';

process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name !== 'ExperimentalWarning') console.warn(w);
});

const config = loadConfig();
const { app, close } = await createServer(config);

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(
    `Studyo server on http://${info.address === '0.0.0.0' ? 'localhost' : info.address}:${info.port}`,
  );
  console.log(`Library: ${config.library}`);
  console.log(`Access token: ${config.token}`);
  if (config.replayDir) console.log(`Replay mode: scripts from ${config.replayDir}`);
});

const shutdown = () => {
  server.close();
  close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
