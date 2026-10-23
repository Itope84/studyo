# Multi-user on this Mac (Phase 0.5)

The build plan for running Studyo for about 5 friends and family from this Mac before deciding on the hosted phases (`docs/hosting-plan.md`). Written to be implemented step by step; each step ends with what must be true before moving on.

## Goal and limits

- Each person has their own library, jobs, chat, progress, settings and push subscriptions. Nobody sees anyone else's data through the API.
- Accounts are invite-only: you create them in the terminal. Each account is a **user id** (the username, also the folder name) plus a secret **token**. There is no sign-up page and no password.
- You can add, reset, disable, back up and monitor users from the terminal.
- No per-user quotas. One server-wide cap on how many OpenCode runs happen at once, shared fairly.
- Your current library becomes user `temitope` (admin) at `library/users/temitope/`. Your existing token keeps working, so your devices stay signed in.
- The app barely changes: invites use the existing `/connect?server=…&token=…` link. The only app changes are showing who is signed in, hiding the CLI/model controls for non-admins, and clearing offline saves when the signed-in user changes.

**Not in scope:** quotas, sign-up, passwords, an admin screen in the app, Cloudflare Access, isolation of the AI process (see "Known risk" below).

**Known risk (accepted for this phase):** work jobs run OpenCode with `bash: allow` and `cwd` set to the user's folder. File tools are fenced by `external_directory: deny`, but a shell command could still read `../<other user>/`. Testers are trusted people and the skills never do this; the container phase removes the risk. Don't invite anyone you wouldn't let read your library.

## Layout after the change

```
library/                         STUDYO_ROOT (default <repo>/library)
  _studyo/
    server.db                    users table (new, server-wide)
    vapid.json                   web push keys, shared by all users (moved from your _studyo)
    server.log                   launchd log, stays here
  users/
    temitope/                    exactly what library/ held before
      topics/  courses/  inbox/  profile.md  .claude/skills -> <repo>/skills
      _studyo/
        studyo.db                this user's jobs, job_log, events, push_subscriptions
        settings.json  assets/  uploads/
    alice/ …
```

Backups go outside the repo: `STUDYO_BACKUP_DIR`, default `~/Backups/studyo/`.

## How it fits together

Today `createServer(config)` in `apps/server/src/app.ts` builds one library, one DB, one runner, one watcher and one Hono app with ~56 routes. Keep all of that and run it once per user. Wrap it with a small outer app that authenticates and forwards each request to that user's app.

```
request → outer Hono app (server.ts)
            CORS, error handler, upload log
            /health, /auth/access              (no auth, as today)
            /f/:fileToken/*  → look up user by file token → user's app
            everything else  → Bearer token → sha256 → users row
                               disabled? 401   → touch last_seen
                               → profiles.get(user).app.fetch(request)
                                   (today's routes, unchanged, scoped to users/<id>/)
```

Shared across profiles (created once in the outer server): CLI adapters and their detection, voice, VAPID keys, the job slot limiter (`Slots`), the PDF browser (already a module singleton).

Per profile: `Library`, DB, `EventBus`, `JobStore`, `ChatStore`, `Courses`, `Study`, `SettingsStore`, `Push`, `Runner`, watcher, Hono routes.

## Step 1: config split

File: `apps/server/src/config.ts`.

Replace `Config` with two types:

```ts
export interface ServerConfig {
  root: string;            // resolve(env.STUDYO_ROOT ?? <repo>/library)
  stateDir: string;        // <root>/_studyo
  usersDir: string;        // <root>/users
  backupDir: string;       // resolve(env.STUDYO_BACKUP_DIR ?? ~/Backups/studyo)
  port: number; host: string;
  skillsDir: string; origins: string[] | '*'; appReturns: string[];
  replayDir: string | null;
  maxJobs: { work: number; chat: number };   // STUDYO_MAX_WORK ?? 2, STUDYO_MAX_CHAT ?? 3
  /** Used only when the users table is empty (fresh install, demo, e2e, tests). */
  bootstrap: { id: string; token: string | null };  // STUDYO_ADMIN_USER ?? 'me', STUDYO_TOKEN ?? null
}

export interface ProfileConfig {
  user: { id: string };
  library: string;         // <root>/users/<id>
  stateDir: string;        // <library>/_studyo
  fileToken: string;
  skillsDir: string;
  replayDir: string | null;
}
```

- `loadConfig(env)` returns `ServerConfig`. It creates `root`, `stateDir` and `usersDir`. It no longer creates the token file or links skills; that moves to the profile (step 3).
- `STUDYO_LIBRARY` is removed. If it is set and `STUDYO_ROOT` is not, exit with: "STUDYO_LIBRARY was replaced by STUDYO_ROOT (the folder that holds users/). See docs/multi-user-plan.md."
- **Legacy guard:** if `<root>/topics` exists, exit with: "This library is still in the single-user layout. Stop the server and run `pnpm users migrate --id <you>`." This stops a fresh empty profile being created next to an unmigrated library.
- Keep `deriveFileToken` and `linkSkills` (export `linkSkills`; the profile calls it with its own folder).
- Add `export function profileConfig(server: ServerConfig, user: { id: string; file_token: string }): ProfileConfig`. It builds the paths, creates `library`, `topics/`, `inbox/` and `_studyo/`, and calls `linkSkills(library, skillsDir)`.

Done when: typecheck passes for `config.ts` (the rest fails until step 3).

## Step 2: users store

New file: `apps/server/src/users.ts`. It is used by both the server and the CLI (step 7), so it must not import Hono.

`openServerDb(stateDir, file = 'server.db')` uses `DatabaseSync` with WAL and `busy_timeout = 3000`, matching `db.ts`. The schema:

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,               -- ^[a-z][a-z0-9-]{1,31}$, the folder name
  name TEXT NOT NULL,                -- display name, defaults to the id
  token_hash TEXT NOT NULL UNIQUE,   -- sha256 hex of the token; the token itself is never stored
  file_token TEXT NOT NULL UNIQUE,   -- secret used in /f/<file_token>/ media URLs
  admin INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  created TEXT NOT NULL,
  last_seen TEXT
);
```

```ts
export interface User { id: string; name: string; admin: boolean; disabled: boolean;
  created: string; last_seen: string | null; file_token: string }

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
export const newToken = () => randomBytes(24).toString('base64url');   // same shape as today's token
export const newFileToken = () => randomBytes(16).toString('hex');     // 32 hex, same length as deriveFileToken
export const USER_ID = /^[a-z][a-z0-9-]{1,31}$/;

export class Users {
  constructor(db: DatabaseSync)
  list(): User[]
  get(id: string): User | null
  byToken(token: string): User | null          // WHERE token_hash = hashToken(token)
  byFileToken(fileToken: string): User | null
  create(input: { id; name?; admin?; token?: string; fileToken?: string }): { user: User; token: string }
      // validates the id against USER_ID and rejects reserved ids (`_backups`, `admin`, `users`);
      // generates the token and file token when not given; throws if the id exists
  resetToken(id): { user: User; token: string } // new token and new file token
  setDisabled(id, disabled: boolean): User
  touch(id): void                               // last_seen = now; throttled in memory to once per 60 s per id
  count(): number
}
```

Reads always go to the DB, with no cache. Then `pnpm users reset` and `disable`, run from another process, take effect on the next request without a restart. One indexed SQLite read per request is negligible.

Done when: unit tests for create, byToken, resetToken (the old token returns null), setDisabled and id validation pass (`apps/server/test/users.test.ts`).

## Step 3: per-profile app

Files: `apps/server/src/app.ts`, `push.ts`, `jobs/runner.ts`, and a new `jobs/slots.ts`.

### 3a. `createServer` becomes `createProfile`

Rename `createServer(config, options)` in `app.ts` to `createProfile(config: ProfileConfig, shared: Shared, options: ServerOptions)`:

```ts
export interface Shared {
  adapters: Record<CliId, CliAdapter>;
  detected: Record<CliId, { installed: boolean; version: string | null }>;
  voice: Voice;
  vapid: Vapid;                       // { publicKey, privateKey }
  slots: Slots;
  users: Users;                       // to read the user's name/admin flag for /server
}
```

Inside `createProfile`:
- Remove the adapter construction, detection and `createVoice`, which move to the outer server (step 4). Use `shared.*` instead.
- **Remove** the CORS middleware, the Bearer auth middleware (`app.ts:192-209`), `/health` and `/auth/access`. These move to the outer app (step 4). Keep `/f/:token/*` exactly as it is. The outer app has already matched the token to this user, and the second check is harmless.
- Keep `app.onError` and `app.notFound` in both apps. Move the two handlers into one exported function `installErrorHandlers(app)` and call it on both, because a sub-app's thrown `HttpError` is handled by the sub-app's own handler.
- The upload-log middleware moves to the outer app. Prefix its log lines with the user id (`upload started [alice]: …`).
- `SettingsStore`: when `settings.json` does not exist, the default is `cli: 'opencode'` if installed. The model is copied from the admin's settings by `pnpm users add` (step 7), so the store needs no change.
- `PUT /settings`: if `!shared.users.get(config.user.id)?.admin`, throw `HttpError(403, 'forbidden', 'Only the server owner can change the AI settings.')`.
- `GET /server`: add `user: { id, name, admin }` from `shared.users.get(config.user.id)` (contract change in step 5).
- Return `{ app, runner, close }`, with the same `close` as today.

### 3b. Push with shared keys

`webpush.setVapidDetails` is module-global, so one key pair must serve every profile.

- New `export function loadVapid(stateDir): Vapid` in `push.ts`. It reads or creates `<server stateDir>/vapid.json` (mode 0600) and calls `webpush.setVapidDetails(...)` **once**.
- The `Push` constructor becomes `(db, vapid: Vapid)`. It sets `publicKey` and no longer reads files or calls `setVapidDetails`.
- The migration moves your existing `vapid.json` to `library/_studyo/vapid.json`, so your current push subscriptions keep working.

### 3c. Job slots (global concurrency cap, fair across users)

New file `apps/server/src/jobs/slots.ts`:

The rule: each runner (one per user) still runs at most one job per lane. `Slots` caps the total across users. When the cap is reached, users get the next free slot in the order they started waiting. A user with a long queue does not keep the slot: after each job, if someone else is waiting, the slot goes to them first.

Mechanism: a waiting runner is identified by a `wake` function. Releasing a slot while someone waits **hands it over** directly (the slot never becomes free, so nobody can jump the queue).

```ts
type Lane = 'work' | 'chat';
type Wake = () => void;

/** Server-wide cap on concurrent CLI runs per lane, handed out to waiting runners in FIFO order. */
export class Slots {
  private used: Record<Lane, number> = { work: 0, chat: 0 };
  private waiting: Record<Lane, Wake[]> = { work: [], chat: [] };
  /** Slots handed to a woken runner that hasn't picked them up yet. */
  private granted: Record<Lane, Set<Wake>> = { work: new Set(), chat: new Set() };

  constructor(private max: Record<Lane, number>) {}

  /** A slot for `who`: its granted one, or a free one if nobody is queued ahead. Null when it must wait. */
  take(lane: Lane, who: Wake): (() => void) | null {
    if (this.granted[lane].delete(who)) return this.releaser(lane);       // used already counts it
    if (this.waiting[lane].length || this.used[lane] >= this.max[lane]) return null;
    this.used[lane]++;
    return this.releaser(lane);
  }

  /** Queue `who` (once) to be woken when a slot is handed to it. */
  wait(lane: Lane, who: Wake) {
    if (!this.waiting[lane].includes(who) && !this.granted[lane].has(who)) this.waiting[lane].push(who);
  }

  /** A woken runner that no longer has work gives its slot back. */
  decline(lane: Lane, who: Wake) {
    if (this.granted[lane].delete(who)) this.free(lane);
  }

  private releaser(lane: Lane) {
    let done = false;
    return () => { if (!done) { done = true; this.free(lane); } };
  }

  /** Hand the slot to the next waiter, or make it free. */
  private free(lane: Lane) {
    const next = this.waiting[lane].shift();
    if (next) { this.granted[lane].add(next); queueMicrotask(next); }
    else this.used[lane]--;
  }

  stats() { /* { work: { used, max, waiting }, chat: … } for logs and `pnpm users list` */ }
}
```

In `Runner` (`jobs/runner.ts`):
- Add `slots: Slots` to `RunnerDeps`.
- Create one stable wake function per lane in the constructor: `this.wake = { work: () => void this.tick('work'), chat: () => void this.tick('chat') }`. `wait` dedupes by identity, so it must be the same function every time.
- In `tick(lane)`, inside the `while` loop:

```ts
const job = this.d.store.nextQueued(lane);
if (!job) { this.d.slots.decline(lane, this.wake[lane]); return; }   // no-op unless we were granted a slot
const release = this.d.slots.take(lane, this.wake[lane]);
if (!release) {
  if (job.activity !== WAITING) this.d.store.update(job.id, { activity: WAITING });
  this.d.slots.wait(lane, this.wake[lane]);
  return;
}
// … existing body …
finally { this.running.delete(lane); release(); }
```

`WAITING = 'Waiting for other jobs to finish'`. The app already shows `activity`. Releasing in `finally` before the loop takes its next job is what makes it fair. If another user is waiting, the slot is handed to them and this runner's next `take` returns null, so it queues behind them.

- In `stop()`, also `decline` both lanes. Aborted runs release through `finally`.
- In `cancel()` of a queued job: no slot change. The runner wakes, finds nothing and declines.

Done when the unit tests (step 8) pass: FIFO handover, no queue jumping, a user with 3 queued jobs alternating with another user's 1 job, and decline passing the slot on.

Done when: `pnpm --filter @studyo/server typecheck` passes for these files.

## Step 4: outer server

New file `apps/server/src/server.ts`, exporting `createServer(config: ServerConfig, options: ServerOptions = {})`. It returns `{ app, close, users, profiles }`.

1. Open `server.db` (`options.dbFile === ':memory:'` → in-memory for both the server DB and profile DBs, as tests do today) and construct `users`.
2. **Bootstrap:** if `users.count() === 0`, create `config.bootstrap.id` as admin with `config.bootstrap.token` (or a new one). Print `Created admin user <id>. Token: <token>`. Its folder may already contain files, which is how demo, e2e and tests seed the fixture library.
3. Build the shared parts: adapters (the replay or real logic moved from `createProfile`), `detected`, `voice = createVoice(config)` (change `createVoice`'s parameter type to `{ replayDir: string | null }`), `vapid = loadVapid(config.stateDir)`, `slots = new Slots(config.maxJobs)`, and `writeSharedAssets` is still called per profile.
4. `profiles: Map<string, Promise<Profile>>`. `getProfile(user)` creates it once via `createProfile(profileConfig(config, user), shared, options)`, then `runner.start()` inside it as today. **Eagerly start every non-disabled user at boot**, so queued and `needs_input` jobs recover after a restart. Profiles created later (a user added while running) start lazily on their first request.
5. Outer Hono app, in order:
   - `cors(...)` exactly as today.
   - `installErrorHandlers(app)`.
   - The upload-log middleware.
   - `GET /health`, `GET /auth/access` (moved verbatim, using `config.appReturns`).
   - `app.all('/f/:token/*')`: `users.byFileToken(token)`. Missing or disabled → 401 `'The file link is not valid.'`. Otherwise forward.
   - Auth middleware for everything else: `OPTIONS` passes through. Read `Authorization: Bearer <t>` → `users.byToken(t)`. Not found → 401 `unauthorized` "The access token is missing or wrong." (same text as today, because the app keys off it). Disabled → 401 `account_disabled` "This account is turned off. Ask the person who invited you." Then `users.touch(id)` and `c.set('user', user)`.
   - `app.all('*', async (c) => (await getProfile(c.get('user'))).app.fetch(c.req.raw, c.env))`.
     Pass `c.env`: `@hono/node-server` puts `incoming`/`outgoing` there, and SSE streaming must keep working through the hop. **Verify SSE (`/events`) and range requests (`/files/*`, audio) work through the forward**, both in tests and by hand.
6. Log job lifecycle with the user id: in `createProfile`, wrap `notify` (or subscribe to the bus for `job.updated`) and `console.log` `[alice] job <id> <kind> <status>` when a job reaches running/needs_input/succeeded/failed/cancelled. This is the live monitor in `server.log` (`tail -f library/_studyo/server.log`).
7. `close()`: close every profile, the server DB and the PDF browser.

`apps/server/src/index.ts`:
- Use `createServer(loadConfig())`.
- Startup prints: the root, `N users: temitope (admin), alice, …`, the slots `work 2 / chat 3`, and **no token**. Tokens are not stored in plaintext any more. The setup-link lines become `Invite links: pnpm users add <id>, pnpm users reset <id>`. Exception: on a bootstrap creation (step 4.2), print the token and setup link once, as today.

Done when: the server starts on a copy of the fixtures in the new layout, `/health` works, and both a user's token and their file links work.

## Step 5: contract and app

1. `packages/api/openapi.yaml`: add to `ServerInfo` a required `user` object `{ id: string, name: string, admin: boolean }`. Document `403 forbidden` on `PUT /settings`. Run `pnpm --filter @studyo/api gen`.
2. Server: `/server` returns it (step 3a).
3. App `apps/app/src/app/settings.tsx`:
   - Under the connection row, show "Signed in as **{name}**".
   - Show the CLI and model controls only when `info.user.admin`.
4. App `apps/app/src/app/connect.tsx`, in `connect()`: after `const info = await api.server(conn)`, if `info.user.id` differs from a new pref `lastUserId` (in `lib/prefs.ts`), clear the offline saves (add `export async function removeAllTopics()` to `lib/offline.ts`, which calls `removeTopic` for every saved id), then save `lastUserId`. `queryClient.clear()` is already there.
5. App 401 with code `account_disabled`: show the server's message on the connect screen. Check how `lib/api.ts:276-281` maps 401 and pass the message through.

Done when: `pnpm typecheck && pnpm lint` pass and the settings screen shows the name (screenshot with `scripts/shot.mjs`).

## Step 6: scripts, tests helper, ignores

- `apps/server/test/helpers.ts` `makeServer()`:
  - Make a temp root.
  - `cpSync(fixtures/library, <root>/users/test)`.
  - Call `createServer({ root, stateDir, usersDir, backupDir: <root>/_backups, port: 0, host, skillsDir, origins: '*', appReturns: […], replayDir, maxJobs: { work: 2, chat: 3 }, bootstrap: { id: 'test', token: TOKEN } }, { watch: false, dbFile: ':memory:' })`.
  - Return `library: <root>/users/test` so existing tests don't change.
  - Add `addUser(id): Promise<string>`, which creates a user with a copied or empty folder and returns the token.
  - Let `call` take an optional `token`.
- `scripts/demo.mjs`, `scripts/e2e-server.mjs`, `scripts/e2e-offline-server.mjs`: copy fixtures to `<tmp>/users/<demo|e2e>`, set `STUDYO_ROOT=<tmp>`, `STUDYO_ADMIN_USER=<demo|e2e>`, and keep `STUDYO_TOKEN`.
- `scripts/new-topic.sh`: use `library/users/${STUDYO_USER:-temitope}/topics/$slug`.
- `scripts/condense-loop/run.ts`: set `LIB = join(ROOT, 'library/users', process.env.STUDYO_USER ?? 'temitope')`.
- `packages/renderer/src/cli.ts`: the default `--library` stays `resolve('library')`. The server always passes the library explicitly, so leave it, but mention it in the usage line.
- `.gitignore`: replace the `library/*` block with `library/*` plus `!library/.gitkeep`. `git rm --cached library/topics/.gitkeep library/inbox/.gitkeep`, and make sure `library/.gitkeep` exists.
- `scripts/install-launchd.sh`: no change (the log path stays `library/_studyo/server.log`).
- `.env.example`: replace `STUDYO_LIBRARY` with `STUDYO_ROOT`. Add `STUDYO_MAX_WORK`, `STUDYO_MAX_CHAT`, `STUDYO_BACKUP_DIR`, `STUDYO_INVITE_APP` (default `https://studyo.ilesan.me`) and `STUDYO_INVITE_SERVER` (default `https://studyo-api.ilesan.me`).

Done when: `pnpm test` and `pnpm e2e` are green with no test-body changes beyond the helper.

## Step 7: the `users` CLI

New file `apps/server/src/cli/users.ts`. Root `package.json` script: `"users": "pnpm --filter @studyo/server exec tsx src/cli/users.ts"`. It calls `loadDotEnv()` and then `loadConfig()`, but **skips the legacy guard for `migrate`** (export the guard as a separate function that `index.ts` calls). It only touches SQLite and files, never the HTTP server, so it works whether or not the server is running (except `migrate`).

The invite link is `${STUDYO_INVITE_APP}/connect?server=${encodeURIComponent(STUDYO_INVITE_SERVER)}&token=${encodeURIComponent(token)}`.

| Command | Does |
|---|---|
| `pnpm users add <id> [--name "Alice B"]` | Validate the id. Create the row and the folder skeleton (`profileConfig`). Copy the admin's `_studyo/settings.json` into the new profile, so everyone uses your CLI and model. Print the token once and the invite link. |
| `pnpm users list` | A table with id, name, admin, status (active/disabled), last seen (relative), jobs in 7 days as `ok/failed`, active now (running, queued, waiting for answers), and folder size (MB). Job numbers come from opening each profile's `_studyo/studyo.db` read-only. |
| `pnpm users jobs <id> [--limit 20] [--failed]` | Recent jobs, newest first: created, kind, status, duration (finished − started), topic id, and the first 100 characters of the error. |
| `pnpm users show <id>` | Row details, folder path, topic and course counts, and the 5 newest jobs. |
| `pnpm users reset <id>` | New token and new file token. Print the new invite link. Old devices get 401 on their next request and land on the connect screen. |
| `pnpm users disable <id>` / `enable <id>` | Flip `disabled`. Takes effect on the next request. Jobs already running finish. |
| `pnpm users backup <id> \| --all` | See below. |
| `pnpm users migrate --id temitope --name Temitope` | One-time migration. See below. |

There is no delete command in this phase: disable, then remove the folder by hand after a backup if you really mean it.

**Backup** (`backup.ts` beside the CLI, also used by `migrate`):
1. `mkdir -p <backupDir>`.
2. Snapshot the profile DB consistently while the server may be running: open `<profile>/_studyo/studyo.db` and run `VACUUM INTO '<tmpdir>/studyo.db'`.
3. `tar -czf <backupDir>/<id>-<YYYY-MM-DD-HHmm>.tar.gz` via `execFileSync('tar', …)`, with `-C <usersDir>` and `--exclude <id>/_studyo/studyo.db* --exclude <id>/_studyo/uploads --exclude <id>/.claude <id>`. Then append the snapshot (`tar -rf` doesn't work on gzip, so build the archive from a staging dir, or use `-C <tmpdir>` as a second source with `--transform`/`-s` so it lands at `<id>/_studyo/studyo.db`. On macOS bsdtar, use `-s ',^studyo.db,<id>/_studyo/studyo.db,'`).
4. Print the path and size.

Restore is by hand, documented in the README: stop the server, move the user's folder aside, `tar -xzf <file> -C library/users`, start the server.

**Migrate** (refuse unless every check passes):
1. Checks:
   - `<root>/topics` exists (legacy layout) and `<root>/users/<id>` does not.
   - The server is **not** running: `fetch http://127.0.0.1:${STUDYO_PORT ?? 8787}/health` must fail. Otherwise print "Stop it first: `launchctl bootout gui/$(id -u)/com.studyo.server`".
   - The old token can be found: `STUDYO_TOKEN` or `<root>/_studyo/token`.
2. List active jobs in the old DB (`status IN ('queued','running','needs_input')`). Running ones will be marked failed on next start, as after any restart. Queued and waiting ones carry over. Print them and continue.
3. Checkpoint the old DB: open it, `PRAGMA wal_checkpoint(TRUNCATE)`, close.
4. **Full backup first:** `tar -czf <backupDir>/library-pre-multiuser-<ts>.tar.gz -C <repo> library --exclude library/_studyo/server.log`. Then verify with `tar -tzf … | grep -c .` > 0 and that the size is > 0. Abort on any failure.
5. `mkdir -p <root>/users/<id>/_studyo`. With `renameSync` (same disk, instant), move every entry of `<root>` except `_studyo`, `users`, `_backups`, `.gitkeep` and `.DS_Store` into `users/<id>/` (topics, courses, inbox, profile.md, .claude, anything unknown, logged by name). Then move every entry of `<root>/_studyo` except `server.log`, `token` and `vapid.json` into `users/<id>/_studyo/` (studyo.db and its -wal/-shm, settings.json, assets, uploads).
6. `vapid.json` stays at `<root>/_studyo/vapid.json`, which is where `loadVapid` now reads it.
7. Create the users row: id, name, `admin: true`, `token: <old token>` (stored as its hash), `fileToken: deriveFileToken(oldToken)`. Your devices and existing media links keep working.
8. Delete `<root>/_studyo/token`; the plaintext token is no longer kept.
9. Print a summary: what moved, the backup path, "Start the server: `launchctl kickstart -k gui/$(id -u)/com.studyo.server`".

Done when: the migrate test (step 8) passes.

## Step 8: tests

Use the replay adapter, as all tests do now (`apps/server/test/`):

- `users.test.ts`: the store (step 2) plus HTTP:
  - Two users each see only their own `/topics`.
  - User A's token gets 404 for B's topic id when the topic was created under B, and the folders are separate on disk.
  - A's file token cannot fetch B's file path.
  - Disabled → 401 `account_disabled`.
  - After a reset, the old token → 401 and the new one → 200.
  - Non-admin `PUT /settings` → 403. `/server` returns the right `user` and matches the `ServerInfo` schema (`expectSchema`).
  - `last_seen` is set after a request.
- `slots.test.ts`:
  - Unit tests: FIFO handover, a fresh `take` can't jump waiters, `decline` passes the slot on, and the release fn is idempotent.
  - Integration: `maxJobs.work = 1`, two users each queue a replay job, and the second starts only after the first finishes. Both succeed.
- `migrate.test.ts`:
  - Build a legacy layout in a temp dir from `fixtures/library` plus `_studyo/token`, a `vapid.json` and a `server.log`. Run the migrate function (export it; don't spawn the CLI). Point `STUDYO_BACKUP_DIR` at temp. The fake port check needs a parameter.
  - Assert the layout, that the backup exists, that the old token authenticates through `createServer`, that the file token equals `deriveFileToken(old)`, that `server.log` and `vapid.json` stayed at the root, and that the token file is gone.
- `startup.test.ts`: `loadConfig` exits or throws on a legacy layout and on `STUDYO_LIBRARY` without `STUDYO_ROOT`. Make the guard throw a typed error that `index.ts` turns into `process.exit(1)`.
- Existing tests: unchanged and green.
- SSE through the forward: one test opens `/events` with a token and sees an event after a topic update. If the existing tests already cover `/events`, it's covered.

## Step 9: docs

- `README.md`:
  - Users section: add, invite, reset, disable, list, jobs, backup and restore.
  - The library is now `library/users/<id>/`.
  - Env table: `STUDYO_ROOT` and the new vars, with `STUDYO_LIBRARY` removed.
  - The token is no longer in `library/_studyo/token`.
- `CLAUDE.md`:
  - Layout line for `library/` (`users/<id>/`).
  - Under "How it works", a bullet: one server, one profile app per user, outer auth by token hash, Slots cap.
  - Deployed section: the library path.
- `docs/hosting-plan.md`: tick Phase 0.5 items as they land.

## Runbook: switching this Mac over

Do this after steps 1–9 are merged and green.

1. `pnpm test && pnpm e2e`.
2. Extra safety copy (instant on APFS; takes no space until files change): `mkdir -p ~/Backups/studyo && cp -cR library ~/Backups/studyo/library-clone-$(date +%F)`. Check it with `du -sh ~/Backups/studyo/library-clone-*` (about 355 MB).
3. Stop the server: `launchctl bootout gui/$(id -u)/com.studyo.server`.
4. `pnpm users migrate --id temitope --name Temitope`. Read the summary.
5. `ls library library/users/temitope library/_studyo` should show the layout above.
6. Start the server: `scripts/install-launchd.sh` (re-bootstraps the login item). `tail -f library/_studyo/server.log` should show `1 user: temitope (admin)`.
7. On your phone, the app opens and your topics are there **without signing in again**. Check that:
   - A doc opens and audio plays.
   - Chat on an old topic continues.
   - A small job runs.
   - Push arrives.
8. If chat on an old topic fails to resume, OpenCode may tie sessions to the old folder. Note the error. The fix is to drop the saved chat session ids so the next message starts fresh (find where `saveTopicSession` stores them).
9. Deploy the app for the step 5 changes: `pnpm deploy:web`. Rebuild the locally served web app too: `pnpm build:web`, then restart.
10. Invite: `pnpm users add alice --name "Alice"` and send the link privately. Watch them with `pnpm users list`, `pnpm users jobs alice` and `tail -f library/_studyo/server.log`.
11. Weekly: `pnpm users backup --all` (consider a cron or launchd timer later).

**Rollback:**
1. Stop the server.
2. `mv library ~/Backups/studyo/library-failed-$(date +%F)`.
3. `cp -cR ~/Backups/studyo/library-clone-<date> library`.
4. `git checkout` the commit before step 1.
5. Start the server.

## Watch out for

- **Don't touch the running server** (`:8787/:8788`) while building. Test servers use spare ports, and never write into `library/`. Only the runbook touches the real library.
- `c.req.raw` must reach the profile app unread: no outer middleware may call `c.req.json()` or `parseBody()`. The upload logger only reads headers.
- Don't cache users in memory (except the `touch` throttle). Reset and disable must take effect from the CLI without a restart.
- Hash comparisons: lookups by `token_hash` are fine. Don't log tokens or hashes.
- `writeSharedAssets` stays per profile: the renderer looks for `<library>/_studyo/assets`.
- One VAPID key pair for everyone (step 3b). Never call `setVapidDetails` per profile.
- Event ids are per user. If a device switches user, the old `Last-Event-ID` is greater than the latest id, `replay` returns null, and the app refetches. That already works.
- `pnpm users add` copies your model setting. Everyone's jobs use your OpenCode Go subscription and count against its limits ($12 per 5 hours, $30 per week, $60 per month). `pnpm users list` is how you see who is using it.
