// A stand-in for Cloudflare Access in front of the e2e server, for browser tests.
// - No sign-in: requests get a 302 to a login page (like Access).
// - Signed in (cookie CF_Authorization or header cf-access-token = "good-token"): proxied to the server
//   with Cf-Access-Jwt-Assertion added, as Access does for the origin.
// - OPTIONS (preflight) and /f/* pass through, like the "bypass OPTIONS" setting and a /f/* bypass rule.
import http from 'node:http';

const TARGET = { host: '127.0.0.1', port: Number(process.env.TARGET_PORT ?? 8790) };
const PORT = Number(process.env.PORT ?? 8792);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = `${b64({ alg: 'RS256' })}.${b64({ email: 'tester@example.com', exp: Math.floor(Date.now() / 1000) + 86400 })}.sig`;

const signedIn = (req) =>
  req.headers['cf-access-token'] === TOKEN ||
  (req.headers.cookie ?? '').includes(`CF_Authorization=${TOKEN}`);

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname === '/__login') {
      if (req.method === 'POST') {
        res.writeHead(302, {
          'Set-Cookie': `CF_Authorization=${TOKEN}; Path=/; HttpOnly`,
          Location: url.searchParams.get('next') ?? '/',
        });
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(
        `<title>Fake Access</title><form method="post" action="/__login?next=${encodeURIComponent(url.searchParams.get('next') ?? '/')}"><button>Sign in with fake Access</button></form>`,
      );
    }
    const bypass = req.method === 'OPTIONS' || url.pathname.startsWith('/f/');
    if (!bypass && !signedIn(req)) {
      res.writeHead(302, {
        Location: `http://localhost:${PORT}/__login?next=${encodeURIComponent(url.pathname + url.search)}`,
      });
      return res.end();
    }
    const headers = { ...req.headers, host: `${TARGET.host}:${TARGET.port}` };
    if (signedIn(req)) headers['cf-access-jwt-assertion'] = TOKEN;
    const upstream = http.request(
      { ...TARGET, method: req.method, path: req.url, headers },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on('error', () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  })
  .listen(PORT, () => console.log(`fake Access on http://localhost:${PORT} -> ${TARGET.port}`));
