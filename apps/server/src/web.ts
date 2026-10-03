import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';

/**
 * Serves the built web app (`apps/app/dist`) on its own port, so one process gives you the API and the app.
 * The app is a single-page app: unknown paths get index.html. It lives on a separate port because app routes
 * such as /settings and /inbox share names with API endpoints.
 */
export function webApp(
  dir: string,
  api?: { fetch: (req: Request) => Response | Promise<Response> },
): Hono | null {
  const index = join(dir, 'index.html');
  if (!existsSync(index)) return null;
  const html = readFileSync(index, 'utf8');
  const app = new Hono();
  app.use('*', async (c, next) => {
    await next();
    // The service worker and the page shell must not be cached, so updates reach installed apps.
    if (
      c.req.path === '/sw.js' ||
      c.req.path === '/' ||
      c.res.headers.get('Content-Type')?.includes('text/html')
    ) {
      c.res.headers.set('Cache-Control', 'no-cache');
    }
  });
  // The API on the same origin, under /api. Behind Cloudflare Access this lets one login cookie cover the app,
  // the API, media and the Reader, with no service token in the browser.
  if (api) {
    app.all('/api/*', (c) => {
      const req = c.req.raw;
      const url = new URL(req.url);
      url.pathname = url.pathname.slice(4) || '/';
      const init: RequestInit & { duplex?: 'half' } = {
        method: req.method,
        headers: req.headers,
        signal: req.signal,
      };
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        init.body = req.body;
        init.duplex = 'half';
      }
      return api.fetch(new Request(url, init));
    });
  }
  app.use('*', serveStatic({ root: dir }));
  app.get('*', (c) => c.html(html));
  return app;
}
