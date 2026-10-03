# Studyo: build plan

Companion to the product brief and `docs/decisions-and-backlog.md`. Work goes in vertical slices: each slice builds its part of the contract, the real server endpoints and the screens together, and ends with a check you can run. Boxes get ticked as work lands.

## Decisions this plan relies on

**P1. API contract first.** `packages/api/openapi.yaml` (OpenAPI 3.1) is the single contract for the server and the app. The app's client types are generated from it. Slice 1 drafts the whole contract; later slices may refine it, and every change lands in the spec first.

**P2. AI state: the server holds it; the stream only announces changes.** Everything the AI does is a **job**, chat replies included. Job state, questions and chat replies are saved on the server. The connection is never the only place they exist.

- Job states: `queued → running → needs_input → running → succeeded | failed | cancelled`.
- The server sends live changes over one Server-Sent Events stream (`GET /events`). Every event has an increasing id and is kept in a log, so a client can ask for "everything after id N".
- The app sends anything back (answers, chat messages, cancel) as plain REST calls.
- The app reads the stream with streaming `fetch`, not `EventSource`, because `EventSource` can't send auth headers (bearer token plus Cloudflare Access, D5). A heartbeat every 20s keeps Cloudflare from closing an idle stream.

*Closing and reopening, which matters most for iPhone web:* iOS suspends a web app in the background, and the stream dies. Nothing can keep it alive. The design copes with this:

1. The job keeps running on the server. It isn't tied to the app's connection.
2. On resume (`visibilitychange`, or `AppState` on Android) the app always does the same three things: fetch a snapshot of active jobs (`GET /jobs?active=true`), reconnect the stream from its last event id, and refresh the screen it's on.
3. A job waiting for answers is just a saved state, `needs_input` with its questions attached. Reopening the app shows the questions whether they arrived ten seconds or ten hours ago.
4. While the app is closed, it can only be woken by a push notification ("Studyo has a question about X", "Pack ready"). iPhone supports Web Push for web apps added to the Home Screen (iOS 16.4+). That is slice 7.

The app you mentioned most likely kept no server-side state for "waiting for you", or didn't reconnect on resume. Both are covered above.

*How a headless CLI asks a question:* a skill that needs answers (the skills already take an `interactive` input) writes them as structured JSON and ends its turn. The server sets `needs_input`. The answers come back with `POST /jobs/{id}/answers`, and the server resumes the same CLI session with them. A paused job holds no process, so answering days later works.

*Activity lines:* both CLIs can output machine-readable events. The adapter turns tool calls into plain lines ("Searching: …", "Reading: rfc6962").

**P3. Renderer: designed components plus a free-form escape hatch.** Skills write Markdown, and a plain TypeScript renderer (no AI) turns it into HTML in the Studyo design. Markdown is only the container, so it doesn't cap what the page can show:

- **Component vocabulary.** Fenced directives become designed components: callouts, figures, mermaid diagrams, and later cards, steps, comparisons, timelines, key-term lists, self-check questions. Adding one means a renderer change and a line in `render-contract.md`. Components are cheap for the AI and always look consistent.
- **Free-form blocks.** ` ```svg ` and ` ```html ` blocks the AI writes by hand, for a bespoke diagram, an annotated figure or an interactive explainer. This gives Claude the same freedom it has in an artifact. The renderer sanitises them, gives them the design tokens as CSS variables so they follow light and dark mode, and runs scripts only inside a sandboxed frame.
- Skill guidance (in `render-contract.md`) says to prefer components and reach for free-form only where a component can't show the idea. This keeps cost and consistency in check.
- Output is one self-contained `.html` file next to the `.md`, written on the server after each skill run. Re-rendering after a renderer upgrade needs no AI. Mermaid is bundled locally, not loaded from a CDN, so offline reading works.
- The Reader shows the HTML in an iframe (web) or WebView (Android). A small script inside reports the reading position to the app.

**P4. Server.** TypeScript on Node 22 with Hono, in the same workspace as the app, so the generated types are shared.

- The library folder is the source of truth for content.
- Jobs, the event log and chat state live in SQLite under `library/_studyo/`. The `_` prefix keeps auto-discovery away from it.
- **CLI adapter** (D3): one interface (start session, resume with input, stream events, cancel) with two implementations, Claude Code and OpenCode, from the start. A third, a **replay adapter** that plays recorded CLI output, is used in tests so they cost no tokens.

**P5. Fixtures.** Screens may use hardcoded data only until their slice's server endpoints exist. Every fixture goes in `apps/app/src/fixtures/` and is listed under "Cleanup" below, so nothing is forgotten.

**P6. Name: Studyo.** Missing states are designed in code. Stitch is a visual reference; the brief and the manifest decide what appears on screen.

**P7. Repo layout.** One pnpm workspace:

```
packages/api/        openapi.yaml, generated types, event schemas
packages/renderer/   Markdown + directives → HTML
apps/server/         Hono API, job runner, CLI adapters
apps/app/            Expo (web first, then Android)
library/             user content, gitignored except the skeleton
skills/, docs/, scripts/
```

## Slices

### 0. Setup
- [x] `git init`, `.gitignore` (user library content ignored)
- [x] pnpm workspace, TypeScript base config, lint and format
- [x] `CLAUDE.md` describing the layout and rules
- [x] Copy `pc-ca-mcts` into `fixtures/library/` as the test library (if you agree it can be committed)

Check: `pnpm install` and `pnpm -r typecheck` pass.

### 1. API contract
- [x] Auth: bearer token plus optional Cloudflare Access service-token headers
- [x] Schemas: Topic manifest (including `learning`), Resource, Progress, Job, Question/Answer, ChatMessage, InboxItem, ServerInfo, Settings, Profile, Error
- [x] The brief's 12 calls
- [x] Additions: `GET /events` (SSE), `GET /jobs?active=true`, `POST /jobs/{id}/answers`, `POST /jobs/{id}/cancel`, `GET /health`, `GET/PUT /settings`, `GET/PUT /profile`, `GET /topics/{id}/chat`, push subscription endpoints
- [x] `GET /files/{path}` documents Range requests (206)
- [x] `events.md`: event types, ids, replay, heartbeat, the resume procedure
- [x] Redocly lint; type generation
- [x] Update the folder contract (`skills/_shared/topic-folder.md`: `_studyo/`, `_job/`, `interactive: app` question flow). The brief PDF itself is not edited.

Check: the spec lints clean, and `pc-ca-mcts/topic.json` validates against the Topic schema.

### 2. Library (read side) + app foundation + Home, Topic, Settings
Server:
- [x] Config (library path, token, port), auth middleware, CORS
- [x] Library scanner with auto-discovery; `GET /topics`, `GET /topics/{id}`, `PATCH /topics/{id}`
- [x] `GET /files/{path}` with Range; `GET/PUT /topics/{id}/progress`; `GET /health`, `GET/PUT /settings`

App:
- [x] Expo with expo-router, web target; theme tokens (light and dark), Newsreader and Geist
- [x] Components: Row, Badge, Button, IconButton (48 and 56px), Sheet, Empty, Notice, Input
- [x] API client typed from the generated contract; online/offline store; first run leads to the connect screen
- [x] Home, Topic and Settings screens with empty, loading, offline and failed states

Check: done. The app lists and opens the library from a laptop browser; blocking the server shows "Server offline" and greys out server actions with a reason (e2e test 4).

### 3. Reading
- [x] Renderer: front matter, provenance blocks, callouts, figures, mermaid, citations, heading ids, position hook, light and dark, loud failures
- [x] Free-form `svg` and `html` blocks: sanitised, token-aware, sandboxed
- [x] `studyo-render` CLI; the server re-renders whenever a document is opened with stale HTML (older than its Markdown, or from an older renderer) and after every job
- [x] Update `render-contract.md` (components, free-form rules, guidance)
- [x] Reader screen: resume position, outline, open source, mark as read, jump to a section from chat

Check: done. Both fixture documents render on phone and desktop in both themes (screenshots checked); 10 renderer tests pass.

### 4. Listening
- [x] Add file (`POST /topics/{id}/resources`), multipart upload into `outputs/`
- [x] Player and mini-player dock: scrub, skip back and forward, speed, resume, auto-next; video screen with fullscreen
- [x] Progress sync, with the most recent write winning

Check: done for upload, play, dock and resume from Home (e2e test 3, server tests). Lock-screen and background audio are wired through expo-audio but only matter on Android (brief step 4).

### 5. Jobs and AI state
- [x] SQLite job store and event log; a work queue that runs one job at a time, plus a separate chat lane
- [x] CLI adapter interface; Claude Code adapter; OpenCode adapter; replay adapter for tests
- [x] Skill invocation with `topic_path` and `interactive: app`
- [ ] Tool and write-scope limits per skill (D4). For now: work jobs get file, web and shell tools; chat is read-only; MCP servers are off in unattended runs; time limits per job kind. Per-skill write scopes are still to do.
- [x] `needs_input` round trip: questions JSON, answers, session resume
- [x] `GET /events` with replay, resync and heartbeat; `GET /jobs/{id}` with recent log lines
- [x] App: event-stream client with the resume procedure from P2 (visibility, online, AppState)
- [x] Add topic screen (link, PDF or name; build-now switch); live job progress in Topic and Home; failed state with log
- [x] Question screen for `needs_input`; condensed-doc flow (choose whole pack or sections, then questions)
- [x] Renderer runs automatically when a skill finishes

Check: done in replay (e2e test 1, server tests). Real runs: Claude Code enrich on a real link asked its level question through the app, paused, resumed with the answers and built the pack. Chat verified with both Claude Code and OpenCode. A full OpenCode enrich run has not been tried yet.

### 6. Chat, Inbox, Profile
- [x] Chat via the `answer` skill; first chat forks the enrichment session, later ones resume the chat session; streamed replies saved on the server; citations; the "enrich further" offer starts a deep job
- [x] Inbox: list, upload, assign to a topic, new topic from a PDF
- [x] Profile view and edit (`library/profile.md`); "Mark topic as read" adds its concepts with `via: read`

Check: done for chat in replay (e2e test 2) and real CLIs. The reply is saved as it streams, so reopening mid-reply shows it.

### 7. Notifications, layouts, polish
- [ ] Web Push: built (VAPID keys, subscriptions, service worker, notifications for needs_input, done and failed) but **not yet tested on an iPhone**, which needs HTTPS
- [ ] Tablet (2-column) and desktop (3-column) layouts. Today the app is a centred single column at every width.
- [ ] Accessibility pass: hit sizes and labels are in place; contrast and screen-reader review still to do
- [x] Serve the web build: the server hosts it on :8788; `scripts/install-launchd.sh` runs the server at login (not installed for you)

Check: not done. Push on an iPhone and the wide layouts are the open items.

### 8. Chat skill rework (applies to topics, chapters and courses)
The `answer` skill is not good enough yet. It is strictly pack-only and read-only. Questions to settle, then fix, before courses add more scopes:
Raw problem statement from the user (Oct 3, 2026), kept verbatim:

> Chat is currently useless. We need to remove that "from file only" restriction. Yes allow it to "enrich more". But mainly we need it to answer questions, but it can't just be by quoting stuff. It's explaining stuff. If it doesn't know it, it can research it and come back to explain it - either that or we allow it to explain from knowledge. It has a lot of knowledge but models are different so maybe enriching is what matters. It spews nonsense sometimes because it's trying to answer from the file. For example when it has a document it should be able to understand and explain when I ask a question from knowledge that can be inferred. You can say use knowledge as last resort but not blocked.

Direction: not "pack only". Explain, don't quote. Order: pack and sources first, then inference from what the document implies, then research (web) and come back to explain, then model knowledge as a last resort, labelled but never blocked. Keep the "enrich more" offer. Not started; separate skill work.

- [x] Collect what felt bad in real use (the statement above)
- [ ] Teach, don't only retrieve: allow explaining a covered idea differently, a worked example, checking understanding
- [ ] Use the profile and reading position ("you are in section X")
- [ ] Decide how strict "pack only" is when the pack misses a basic fact (offer enrich, or answer labelled as outside the sources)
- [ ] Scopes: topic, chapter (falls back to earlier chapters), course (routes via `index.md`)
- [ ] Verify with both CLIs and the replay adapter

### 9. Courses (brief: `docs/courses-brief.md`)
Built Oct 3, 2026 in one pass, tested in replay only. Real CLI runs are the open item.
- [x] Answer open concerns. Stitch skipped (the screens are variants of existing ones; checked with screenshots instead)
- [x] Contract: Course, ChapterRef, endpoints (`/courses…`), job kinds, `course_id` on topic summaries; `topic-folder.md`, new `course-folder.md`
- [x] Skills: `course-outline`, `course-plan`, `enrich-chapter`; course modes in `level-check`; course notes in `condense` and `answer`
- [x] Server: courses store, outline job with `needs_input` approval, server makes chapter topic folders from `course.json`, lazy chapter builds (`build` with ids or next N), chapter done mark feeds the profile, scanned PDFs refused up front with `pdftotext`
- [x] App: Courses on Home, add course, outline approval (reuses the question screen), course home, chapter banner with prerequisites and done mark
- [x] Prelim chapter from the course-level gaps
- [x] Course chat (scope id `course--<id>`; uses the current `answer` skill, so it inherits slice 8's problems)
- [x] Server tests (`apps/server/test/courses.test.ts`) and an e2e flow
- [ ] Real runs: `course-outline` on a real PDF (DDIA is the target), `course-plan` on a bare subject, `enrich-chapter` on a slice, with both CLIs. None of the new skills has run on a real CLI yet.
- [ ] Check `pdftotext` page ranges and the printed-page offset on a real book
- [ ] Course-level PDF export for NotebookLM (per chapter works today, a whole-course bundle does not exist)
- [ ] Wide layouts for the course page (shares slice 7's open item)

### 10. Quizzes and take-home (topics, chapters, courses; user triggered)
Built Oct 3, 2026, replay only.
- [x] `quiz` and `quiz-grade` skills; quiz and attempt storage; choice questions graded on the server, written ones by a chat-lane job; quiz runner and results screens; course quizzes draw on built chapters
- [x] `assignment` and `assignment-review` skills: optional context (text, link, file) or none; free-text, link or file submissions; review reads and never runs code
- [ ] Real runs of all four skills
- [ ] Spaced review from quiz history (data shape allows it; not built)
- [ ] Weak concepts from a quiz could offer a one-tap "ask about this" (only "Reread this" exists)

## Not in this plan
Android offline downloads and background audio (brief step 4), the share menu, Android Auto. These follow once the web app works end to end.
