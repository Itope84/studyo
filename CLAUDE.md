# Studyo

Personal learning pipeline: a home server turns a link, PDF or topic name into a source-grounded study pack; one app (Expo, web first, then Android) reads, plays and chats. Read `docs/plan.md` first and tick its boxes as work lands. Product rules live in the brief and `docs/decisions-and-backlog.md`.

## Layout

```
packages/api/        openapi.yaml (the contract), generated types, events.md
packages/renderer/   Markdown + directives → self-contained HTML (no AI)
apps/server/         Hono API, library scanner, job runner, CLI adapters (Claude Code, OpenCode, replay)
apps/app/            Expo Router app
skills/              skills run by the CLIs (symlinked into <library>/.claude/skills)
library/             the user's library; gitignored except the skeleton
fixtures/library/    committed test library (pc-ca-mcts)
```

## Rules

- The contract comes first. Change `packages/api/openapi.yaml`, run `pnpm --filter @studyo/api gen`, then change the server and app.
- The library folder is the source of truth for content. Server state (jobs, events) lives in `<library>/_studyo/`. Anything starting with `_` is ignored by auto-discovery and the app.
- The AI never writes HTML for the Reader. Skills write Markdown; the renderer makes HTML (`skills/_shared/render-contract.md`).
- Every CLI feature goes through the adapter interface and must work with both Claude Code and OpenCode.
- Tests use the replay adapter and `fixtures/library` copies. They never call a real CLI.
- App fixtures (hardcoded data) are temporary and listed under Cleanup in `docs/plan.md`.

## Commands

```
pnpm install
pnpm dev:server     # API on :8787 against ./library
pnpm dev:app        # Expo web
pnpm test           # all packages
pnpm typecheck
pnpm lint
```
