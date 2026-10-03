# Studyo

A personal learning pipeline. The home server turns a link, a PDF or a topic name into a source-grounded study pack using Claude Code or OpenCode. The app (web now, Android later) reads, plays and chats.

## Try it

You need Node 22+, pnpm (`corepack enable pnpm`) and, for real runs, Claude Code and/or OpenCode logged in on this Mac.

```bash
pnpm install
pnpm start          # builds the web app, then serves the API on :8787 and the app on :8788
```

The server prints an access token and a **setup link**. Open the link on this Mac or on your phone (same Wi-Fi or Tailscale) and the app connects straight away. Your library is `library/` in this repo. The token is kept in `library/_studyo/token`.

### Downloading for NotebookLM

Every pack and condensed doc has a download button (in the topic's list and in the Reader's toolbar). **PDF** is printed on the server with diagrams, maths and a list of source links at the end. The first download takes a few seconds; after that it's cached until the document changes. **Markdown** is the source file as the skills wrote it. NotebookLM takes either.

PDF printing uses Chromium. If the server says it isn't available, run `npx playwright install chromium` once on the server (or install Google Chrome).

### Without spending tokens

```bash
pnpm build:web && pnpm demo
```

This runs the same server on a throwaway copy of `fixtures/library`, with every AI job played from `fixtures/replay/`. The enrich job asks a level question, condense writes a short doc, chat streams a cited answer with an "enrich further" offer, and "Go deeper" fails on purpose so you can see the failed state. The token is `demo`.

### Develop

```bash
pnpm dev:server     # API with reload (real CLIs, ./library)
pnpm dev:app        # Expo web on :8081 with reload
pnpm test           # renderer and server tests (replay adapter, no tokens)
pnpm e2e            # browser tests: starts its own replay server and Expo web
pnpm typecheck && pnpm lint
```

## On your phone

- **Same network or Tailscale:** use the setup link the server prints, which has your Mac's address in it. If Tailscale gives the Mac a different address, swap it into the link.
- **iPhone:** open the link in Safari, then Share → Add to Home Screen. Notifications ("Studyo has a question", "Pack ready") only work from the Home Screen app **over HTTPS**. Put the server behind `tailscale serve` or a Cloudflare tunnel for that. Over plain `http://` everything else works.
- **Keep the server running:** `scripts/install-launchd.sh` installs it as a login item that restarts on failure (`--uninstall` removes it). Logs go to `library/_studyo/server.log`.

## Behind Cloudflare Access

Use one hostname for both the app and the API, so Access's sign-in cookie covers everything:

1. Point the tunnel at the **web port** (`http://localhost:8788`). That port serves the app and also the API under `/api`.
2. Protect the hostname with an Access application (your email or Google login).
3. Open `https://<host>/connect?server=https://<host>/api&token=<token>` once. Access asks you to sign in first, then the app connects. The server prints this link too.

No service token is needed in the browser. When the sign-in expires, the app shows "Sign in again", which reloads the page through Access. Service tokens (Settings → Connect → "Server behind Cloudflare Access?") are for the Android app or for a web app hosted somewhere else.

## Settings worth knowing

| Env var | Default | What it does |
| --- | --- | --- |
| `STUDYO_LIBRARY` | `./library` | The library folder (source of truth) |
| `STUDYO_PORT` / `STUDYO_WEB_PORT` | 8787 / 8788 | API and web app ports |
| `STUDYO_TOKEN` | generated once | Access token |
| `STUDYO_ORIGINS` | `*` | Allowed browser origins (comma separated) |
| `STUDYO_REPLAY` | unset | Replay scripts instead of real CLIs |

Which CLI runs jobs, and an optional model for each, are set in the app under Settings.

## How it fits together

- `packages/api/openapi.yaml`: the contract. `events.md` explains live events and what the app does when it resumes.
- `packages/renderer`: Markdown plus directives to themed HTML. Skills never write HTML.
- `apps/server`: Hono API, library scanner, the job runner, CLI adapters (Claude Code, OpenCode, replay), SSE, web push.
- `apps/app`: Expo Router app.
- `skills/`: what the CLIs run. The server links them into `library/.claude/skills`.
- `docs/plan.md`: the build plan, with what is done and what is next.
