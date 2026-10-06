# Hosting plan: Studyo for many users on Cloudflare

Written Oct 6, 2026, so work can continue in a fresh session. Tick boxes as work lands (same habit as `docs/plan.md`).

Reference pages (private artifacts, only for the owner):
- Compact system design: https://claude.ai/artifact/UTc5ddu2nFprTWEJDgLCuM
- Full comparison of both designs: https://claude.ai/artifact/PANaMHZ7myDXG7odkNufHm

## Decisions made

1. **Architecture A.** Each AI job runs in its own short-lived Cloudflare Container running the same OpenCode, skills and shell tools as today. Everything else (API, storage, accounts, billing) is Workers, D1 and R2. The serverless-loop alternative ("B") is out of scope: too much to build and too easy to break. Keep the runner behind the existing `CliAdapter` interface so it could be swapped later.
2. **Models.** Only two are in play: **Muse Spark Contributor** and **DeepSeek Flash**. Do not compare DeepSeek Pro or standard Muse Spark.
3. **Provider.**
   - **Now (only you use it):** OpenCode Go with Muse Spark Contributor (`opencode-go/muse-spark-1.3-contributor`, already your setting in `library/_studyo/settings.json`).
   - **Going live (other people use it):** OpenRouter with Muse Spark Contributor.
   - Go's terms say "own internal use, and not on behalf of or for the benefit of any third party", so Go is for you alone. A separate account does not change that.
4. **The gateway is provider-agnostic.** The container never holds a provider key. It holds a short-lived job token and calls our gateway, which holds the real key and forwards to whichever upstream is configured. Switching Go to OpenRouter is configuration, not code.

### Gateway upstream configuration (the "env")

Names are proposals.

```
GATEWAY_UPSTREAM_BASE_URL   # Go endpoint now, https://openrouter.ai/api/v1 at launch
GATEWAY_UPSTREAM_KEY        # Worker secret, never in the container image
GATEWAY_MODEL_MAP           # our model name -> upstream model id
JOB_TOKEN_SECRET            # signs job tokens
```

- [ ] Find OpenCode Go's endpoint and how its key is sent (see `opencode providers` or OpenCode's provider config). Not yet checked.

## Cost (my estimates, correct within about 3x until the gateway logs real tokens)

Scenario: 50 users, 2 jobs a day, 3,000 jobs a month, one heavy and one medium job per user per day.

| Route | Per month |
|---|---|
| Muse Spark Contributor on OpenRouter, with 5.5% fee | about $132 before tax |
| Same, with 20% VAT on your checkout | about $158 |
| Cloudflare infrastructure (containers, Workers, R2, D1) | about $15 to 40 |

- OpenRouter fee: 5.5% with an $0.80 minimum, so a $10 top-up cost you $12.96 (20% VAT on top). Top up in one larger purchase, not many small ones. VAT can be avoided only with a registered business tax ID on the invoice.
- Cloudflare most likely adds no VAT for you. Check an invoice.
- Token estimates per job: heavy about 0.40M fresh input, 5.6M cached input, 60k output; medium about 0.15M, 1.45M, 25k.

## What I learned from the code and logs (so you do not redo it)

- Shell use is heavy. In 621 shell commands across successful jobs: about 40 to 50% are reads or inspection, about 15 to 20% are Python that converts or rewrites content, about 6% `rm`/`mv`/`cp`/`mkdir`, about 5% PDF tools, about 4% the renderer check. One `enrich` run used 112 Python commands converting an XML book. The container needs `python3` (with `pypdf` and an XML or EPUB converter), poppler, mupdf-tools, qpdf, and a `studyo-render` command.
- Jobs find `packages/renderer` by walking up the repo tree. A container has no repo, so the image needs an explicit render command.
- The adapter already sets `OPENCODE_ENABLE_EXA=1` (`apps/server/src/adapters/opencode.ts`). That enables OpenCode's web search through Exa for any provider. Web search per job: enrich about 2.3 searches and 5 fetches, enrich-deep about 7.5 and 7.5, answer none.
- **Pause and resume is already hosting-friendly** (`apps/server/src/jobs/runner.ts`). The skill writes `_job/questions.json` and ends its turn, the CLI exits, the job is `needs_input`, nothing runs. Answers are saved to `_job/answers.json` and `pending_input`, the job is re-queued, and the next run resumes with `resume = session_id` and a prompt built from the answers. Hosted, a pause holds no container.
- Biggest topics today: 149 MB and 49 MB, most are a few MB. Sync must be incremental, with large binaries fetched only when needed.
- The renderer already sanitizes raw HTML, strips scripts from SVG, and runs free-form HTML blocks in a sandboxed iframe.
- Local tools: OpenCode 1.18.30, Docker 29.4.0. My first local OpenCode test stalled before the model was called (a plain "ok" run worked once, then later runs hung at init while other `opencode serve` and `opencode run` processes were active). Retry in a clean terminal with other OpenCode sessions closed.

## Architecture A in one screen

```
App (Expo web, Worker)
  -> API Worker (Hono): login, routes, limits, reads/writes through LibraryStore
       -> D1: users, jobs, job_log, ledger, topic_index, push_subscriptions
       -> R2: u/<userId>/topics/..., courses/..., _jobs/<job>/...
       -> UserHub (Durable Object): SSE events per user
       -> Scheduler (Queue + per-user Durable Object): one work job and one chat per user, global cap
            -> Container (one per job): runner + OpenCode + skills + python/pdf tools, no secrets
                 -> files via signed URLs from the Worker, scoped to that job
                 -> model calls to the LLM gateway with the job token
LLM gateway (route on the API Worker): holds the key, meters usage, enforces caps, forwards upstream
Rendering: renderer in a Worker; PDF via Browser Rendering
```

Job flow: request, queue, container starts with job token, runner downloads manifest files, OpenCode follows the skill, runner uploads only changed files, the Worker updates the index and notifies the app. Chat uses a warm per-user container (about 10 minutes idle) with write scope limited to the topic's `sources/` folder.

Keep a filesystem `LibraryStore` so `pnpm test`, `pnpm e2e`, local dev and self-hosting keep working with no Cloudflare.

## Security essentials (assume the container can be tricked)

- The provider key lives only in the gateway. The job token works only against the gateway, for one job, expires, and has a spending cap.
- The container has no R2 credentials and cannot list storage. The server builds the file list from the user and topic in the job record and signs short-lived URLs. Every job gets a fresh container. A chat container is per user and its workspace is wiped between uses.
- A hostile web page can make the model send the job's own files out. Route outbound traffic through a logging proxy with an allowlist or denylist.
- Reject any upload outside the job's write scope. Enforce file count and size limits. Keep the previous version of each changed file under `_history/<jobId>/` for a few days so bad jobs can be undone.
- Serve rendered packs from a different origin than the session cookie, or with a strict content security policy. Confirm the free-form HTML iframe has no `allow-same-origin`.
- Hard runtime cap per job, small instance size, daily job limit per user.
- User id comes only from the session. Every query and R2 key includes it. Per-user budgets, a global daily spend limit, and a credit limit on the provider key.

## Plan

### Phase 0: prove the model setup locally (no Cloudflare)

- [ ] Run OpenCode with web search through your current Go model and read token usage from the JSON events:
  ```
  OPENCODE_ENABLE_EXA=1 OPENCODE_CONFIG_CONTENT='{"permission":{"websearch":"allow","webfetch":"allow","bash":"deny","edit":"deny"}}' \
  opencode run --format json --agent build --auto --model opencode-go/muse-spark-1.3-contributor \
  "Use the websearch tool to find the current stable Rust release version. Answer in one sentence with one source URL."
  ```
- [ ] Write a small stub gateway (about 30 lines) that forwards OpenAI-compatible requests to the configured upstream and logs `usage`. Point OpenCode at it with a custom provider (`provider.<name>.npm = "@ai-sdk/openai-compatible"`, `options.baseURL`, `options.apiKey`, `models`). Check config keys against current OpenCode docs. This proves streaming, tool calls and token counts survive a proxy, and that a fake "job token" works as the key.
- [ ] Record real token and cache numbers per job kind. Replace the estimates above.

### Phase 1: the container, locally in Docker

- [ ] Extract the Python imports and shell tools the model uses from `job_log` (commands are truncated to about 79 characters, so also inspect a few real runs). Define the image contents.
- [ ] `Dockerfile`: Node, OpenCode, python3 with the needed libraries, poppler-utils, mupdf-tools, qpdf, skills, and `studyo-render`.
- [ ] Run a real `condense` and `enrich` job inside it against a copy of a fixture topic.
- [ ] `apps/runner`: claim job, download files, run the existing OpenCode adapter, stream events, upload changed files, report result. Reuse `adapters/opencode.ts`, `spawn.ts`, `summariseTool`.
- [ ] Add `/internal/jobs/{claim,events,commit,finish}` to the current server with the filesystem store as the stub job API. Point the container at `host.docker.internal`. Prove the full pause and resume loop here, including saving and restoring the OpenCode session directory, and the recovery path (fresh session from skill, run log, questions and answers).

### Phase 2: hello-container on Cloudflare (about 1 day)

Push the same image with a trivial runner and measure:
- [ ] Cold start time.
- [ ] Download speed from R2 signed URLs for a 50 to 150 MB topic.
- [ ] Whether outbound traffic can be routed through a Worker (for the logging proxy).
- [ ] Disk and instance limits, concurrent instance limits, restart behavior.
- [ ] Session archive restore in a fresh container.
- [ ] Whether Exa search works from container IPs, and its rate limits. Fallback: a `studyo-search` script that calls a search API through a Worker route with the job token.

### Phase 3: platform

- [ ] Contract first: auth, `/me`, usage and billing endpoints in `packages/api/openapi.yaml`, then `pnpm --filter @studyo/api gen`.
- [ ] `LibraryStore` interface with filesystem (existing behavior) and R2 implementations, and an indexer that derives the summary fields into D1.
- [ ] Jobs and ledger to D1 (the synchronous SQLite code in `jobs/store.ts` and `db.ts` becomes asynchronous).
- [ ] API on Workers: sessions, per-user scoping, signed file URLs, signed uploads.
- [ ] UserHub Durable Object, SSE through the API, per-user web push (WebCrypto-based library).
- [ ] Gateway: job tokens, metering from the provider's `usage`, per-job and per-user caps, provider pinning for prompt-cache hits, kill switch.
- [ ] Scheduler: queue, per-user lanes, global cap, cancel, heartbeat and one retry.
- [ ] Rendering in a Worker, PDF through Browser Rendering. Check the renderer fits the Worker bundle limit.
- [ ] App: sign-up, login, usage screen. Server-address and token UI only in self-host mode.
- [ ] `pnpm test` and `pnpm e2e` stay green on the filesystem store and replay adapter, plus an auth fixture.

### Phase 4: containers in production and launch

- [ ] Wire the Scheduler to start containers with job tokens. Workspace hydrate and commit with hashes and the large-file threshold. Pause and resume. Chat in a warm per-user container.
- [ ] Outbound controls, per-job runtime cap, `_history/` undo copies, rendered-pack origin or CSP.
- [ ] Switch the gateway upstream from Go to OpenRouter (Muse Spark Contributor). Before doing so, read the Contributor tier's data terms on OpenRouter: confirm other people's documents are not used for training, and that the tier is offered to paying public services.
- [ ] Billing (Stripe plans or credit packs), balance checks at job start, rate limits, storage quotas, spend alerts.
- [ ] Import your own library into R2 under your user id (the layout matches, so it is a copy).
- [ ] Retire the launchd server on this Mac. Keep self-host mode documented in `README.md`.

## Still to verify before building on it

- Cloudflare Containers: current pricing, instance sizes, disk, concurrent instance limits, outbound interception, start time, restart behavior.
- OpenCode: custom provider config, session restore in a fresh container, web search with a custom provider.
- OpenRouter: live prices for Muse Spark Contributor, the credit fee, and the Contributor tier's data terms.
- Whether Workers AI and DeepSeek direct charge VAT for you (only OpenRouter is confirmed). Not needed unless you reconsider those providers.

## Notes for later (not in this plan)

- **Alternative harness (B):** run the agent loop in Workers with typed tools and no containers. Smallest attack surface and fastest chat, but a new harness to build and tune, and the model's shell work (conversion scripts) would need replacing. Only worth revisiting if containers prove painful.
- **Other providers:** DeepSeek Flash via Workers AI or DeepSeek direct are possible later because the gateway is provider-agnostic. DeepSeek direct sends data to DeepSeek's own servers, which matters for other people's documents.
