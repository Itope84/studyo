# Studyo

A personal learning pipeline. The home server turns a link, a PDF or a topic name into a source-grounded study pack using Claude Code or OpenCode. The app (web now, Android later) reads, plays and chats.

## Try it

You need Node 22+, pnpm (`corepack enable pnpm`) and, for real runs, Claude Code and/or OpenCode logged in on this Mac.

```bash
pnpm install
pnpm start          # builds the web app, then serves the API on :8787 and the app on :8788
```

The server prints an access token and a **setup link**. Open the link on this Mac or on your phone (same Wi-Fi or Tailscale) and the app connects straight away. Your library is `library/` in this repo. The token is kept in `library/_studyo/token`.

### Courses, quizzes and take-home

**Add course** (next to Add topic) takes a book as a PDF, a link, or just a subject. The server finds the chapters without reading the whole thing (it needs `pdftotext`, from `brew install poppler`; scanned PDFs are refused), shows you an outline to approve, asks what you already know, and sets up a Prelim if there are gaps. Nothing is built until you start a chapter or tap "Build next". Each chapter is a normal topic with a banner showing where it sits and what it builds on; prerequisites advise and never lock.

Every pack has **Quiz me** and **Take-home** buttons, and a course has its own cumulative quiz and a course-wide chat. Both are only made when you ask. A take-home can be about your own project: give it some context, or leave that empty for a generic task. You can hand in a link, a file or just a description of what you built.

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

The app signs in to Access itself, from any hostname: the web app on Pages, the Android app, or the server's own web port.

**How it works:** on Connect, the app finds Access in the way and offers **Sign in with Cloudflare Access**. That opens `<server>/auth/access` in the browser (a full-page redirect on web, an in-app browser sheet on Android). Access shows its login. Once you're signed in, the server sends your Access token back to the app, which sends it on every request as `cf-access-token`. When the token expires, the app shows "Sign in" again.

**One-time setup in Cloudflare Zero Trust:**

1. **Access application** for the server's hostname (for example `studyo.example.com`), with your login policy.
2. In that application's settings, under CORS, turn on **Bypass OPTIONS requests to origin**. The web app's preflight requests carry no credentials, and the server answers them itself.
3. **A second Access application for the path `studyo.example.com/f/`** with a **Bypass** policy. Audio, video and the Reader page load from `/f/<file token>/…` and can't send headers in a browser. The file token, derived from your access token, protects those URLs.

**On the server**, list where the token may be sent back:

```bash
STUDYO_ORIGINS=https://studyo.pages.dev   # your web app's origin(s); also used for CORS
# The Android app (studyo://) and localhost are always allowed.
# STUDYO_APP_URLS adds other return addresses without changing CORS.
```

**Same hostname (no Pages):** point the tunnel at the web port (`:8788`). It serves the app and the API under `/api`, so Access's own cookie covers everything, and the bypass rules above are optional.

**Service tokens** (Connect → "Server behind Cloudflare Access?") still work for non-interactive clients.

**Limits:** a browser can't see a redirect from another hostname, so when a Pages-hosted app can't reach the server it offers the sign-in as a possibility, and the sign-in page says plainly if the server isn't behind Access. The Android app sees the login page and knows for sure.

## Settings worth knowing

| Env var | Default | What it does |
| --- | --- | --- |
| `STUDYO_LIBRARY` | `./library` | The library folder (source of truth) |
| `STUDYO_PORT` / `STUDYO_WEB_PORT` | 8787 / 8788 | API and web app ports |
| `STUDYO_TOKEN` | generated once | Access token |
| `STUDYO_ORIGINS` | `*` | Allowed browser origins (comma separated); also where Access sign-ins may return |
| `STUDYO_APP_URLS` | unset | Extra return addresses for Access sign-ins |
| `STUDYO_REPLAY` | unset | Replay scripts instead of real CLIs |

Which CLI runs jobs, and an optional model for each, are set in the app under Settings.

## How it fits together

- `packages/api/openapi.yaml`: the contract. `events.md` explains live events and what the app does when it resumes.
- `packages/renderer`: Markdown plus directives to themed HTML. Skills never write HTML.
- `apps/server`: Hono API, library scanner, the job runner, CLI adapters (Claude Code, OpenCode, replay), SSE, web push.
- `apps/app`: Expo Router app.
- `skills/`: what the CLIs run. The server links them into `library/.claude/skills`.
- `docs/plan.md`: the build plan, with what is done and what is next.
