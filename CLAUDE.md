# Studyo

Personal learning pipeline. A home server (this Mac) turns a link, PDF or topic name into a source-grounded study pack by running Claude Code or OpenCode with the skills in `skills/`. One app (Expo: web now, Android later) reads, listens, chats, and downloads packs as PDF for NotebookLM.

Read first: `docs/plan.md` (what's built, what's next; tick boxes as work lands), then `docs/decisions-and-backlog.md` and the product brief for product rules. `README.md` covers running, deploying and Cloudflare Access.

## Layout

```
packages/api/        openapi.yaml (THE contract), generated types (src/schema.gen.ts), events.md
packages/renderer/   Markdown + directives → themed HTML (callouts, mermaid, KaTeX, free-form svg/html, print CSS). No AI.
apps/server/         Hono API, library scanner, job runner, CLI adapters (claude, opencode, replay), SSE, PDF (playwright-core), web push
apps/app/            Expo Router app (SDK 57). Screens in src/app, shared UI in src/components, data in src/lib
skills/              skills the CLIs run; linked into <library>/.claude/skills by the server
library/             the user's real library (gitignored). Server state in library/_studyo/
fixtures/            committed test library, replay scripts (fake AI jobs), one audio file
e2e/                 Playwright browser tests; scripts/ has helpers (demo, e2e server, fake Cloudflare Access, screenshots)
```

## How it works (the decisions that matter)

- **Contract first.** Change `packages/api/openapi.yaml`, run `pnpm --filter @studyo/api gen`, then server, then app. The app's types come from it.
- **The library folder is the source of truth.** Each topic is a folder with `topic.json` (manifest), `progress.json` (positions, done marks, bookmarks), `sources/`, `pack/`, `outputs/`, `chat/`. `_`-prefixed paths are scratch. The server derives extra fields (html_path, description, read_minutes, chapters, cover_path, summary) on read.
- **All AI work is a job** (SQLite in `_studyo/`): queued → running → needs_input → succeeded/failed/cancelled. Work lane (one at a time) and chat lane. A skill that needs the learner writes `_job/questions.json`, prints `[studyo] NEEDS_INPUT` and ends its turn; answers resume the same CLI session. Skills print `[studyo] n/N phase: …` for progress.
- **Live state:** one SSE stream (`/events`) announces changes; the app always refetches on resume, so nothing depends on the stream staying open (iOS suspends web apps).
- **Skills write Markdown; the renderer makes HTML.** Never have the AI write HTML. PDFs are printed from that HTML by headless Chromium.
- **Both CLIs, always.** Anything CLI-related goes through the adapter interface. Unattended runs switch off MCP servers.
- **Files without headers:** media and the Reader load from `/f/<file token>/…` (token derived from the access token).
- **Cloudflare Access:** app on another hostname signs in via `GET /auth/access` hand-off and sends `cf-access-token`. Same-hostname setups use the web port, which also serves the API under `/api`.

## Deployed (as of Oct 3, 2026)

- **Server:** this Mac, as login item `com.studyo.server` (`scripts/install-launchd.sh`). API :8787, web app :8788. Logs `library/_studyo/server.log`. Restart: `launchctl kickstart -k gui/$(id -u)/com.studyo.server`. Settings in `<repo>/.env` (gitignored; see `.env.example`).
- **API hostname:** `studyo-api.ilesan.me` → Cloudflare tunnel `career-ops` (shared with fitnerapp sites; config `~/.cloudflared/config.yml`, runs as root). Cloudflare Access not set up yet: the access token is the only protection.
- **Web app:** Cloudflare Worker `studyo` with static assets on `studyo.ilesan.me` (`apps/app/wrangler.jsonc`). Deploy: `pnpm deploy:web`. `apps/app/.env.production` bakes in the default server address.
- **Pending:** `apps/app/worker/index.js` (http→https redirect) was added before the user chose to enable "Always Use HTTPS" in the dashboard instead. Remove `main`, `binding` and `run_worker_first` from `wrangler.jsonc`, delete `worker/`, and redeploy once they confirm.

## Commands

```
pnpm install
pnpm start            # build web + run server (prefer the login item on this Mac)
pnpm demo             # replay server on a copy of fixtures (no tokens); set STUDYO_PORT to avoid :8787
pnpm dev:app          # Expo web on :8081
pnpm test             # renderer + server tests (replay adapter, never real CLIs)
pnpm e2e              # Playwright: starts its own replay server (:8790), fake Access (:8792), Expo (:8082)
pnpm typecheck && pnpm lint
pnpm deploy:web       # export the web app and deploy the Worker
```

## Working rules and traps

- **Don't touch the user's running server on :8787/:8788.** Use spare ports for test servers. Never write test data into `library/`.
- Ask the user to flip dashboard settings (Cloudflare DNS, zone settings, Access) instead of coding around missing permissions. Wrangler's login can deploy Workers but can't edit DNS or zone settings. `cloudflared tunnel route dns` creates records in fitnerapp.com (wrong zone): don't use it.
- Expo SDK 57: read `apps/app/AGENTS.md`; check installed type definitions before using an Expo API; install with `npx expo install`.
- TypeScript stays on 5.9 (openapi-typescript needs the JS API). KaTeX is pinned to rehype-katex's version (0.16.47) so CSS and markup match.
- pnpm 12 blocks build scripts unless listed under `allowBuilds` in `pnpm-workspace.yaml`.
- On web, Expo Router keeps earlier screens mounted but hidden: e2e locators must filter to visible elements (see `v()` in e2e/flow.spec.ts).
- Commit with the attribution lines from the session. Check visual changes with `scripts/walk.mjs` / `scripts/shot.mjs` screenshots.
- App fixtures (hardcoded data) are not used; keep it that way.
