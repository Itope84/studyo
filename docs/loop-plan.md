# Condense depth and tuning loop

Grilled and decided Oct 4, 2026. Built: the scoring and loop script, the fixtures, the teaching-craft file and a first round of tuned `condense` changes (commit `4331f54`, branch `condense-loop`). `condense` now reads `teaching-craft.md` (wired in after the first loops; see below). Not built: the in-depth skill, the app's depth choice, the editor for `teaching-craft.md`, a third CLI (`agy`).

## The problem

For technical material (courses, code, systems), `condense` reads as a summary where it should teach. Rust ch 2 went from 10.7k words of pack to 2.7k, DDIA ch 2 from 13.8k to 4.2k. The skill was shaped on a short article, and several of its rules favour narrative over depth.

## Decisions

### Two skills on a shared base
- `condense` stays the overview (default depth). A new in-depth skill (working name `study-guide`, "longer") shares the reading steps in `skills/_shared/`.
- The learner picks at click time: Default or Longer, in a sheet. Default is today's behaviour.
- The slug and resource title include the depth. Existing documents are untouched and read as default.
- The in-depth skill runs a coverage check against the chapter's `teaches`. Gaps trigger an enrich job first, so facts stay strictly pack-grounded.
- Worked code, step-by-step builds and predict-the-output checks belong to the in-depth skill.
- The condensed output links to Quiz Me. There is no quiz inside the output.

### Grounding
- Facts come from the pack only.
- A short plain-words definition of a general background term (a sentence or two, what a textbook entry says, nothing specific to the subject) is allowed even when the pack lacks it. Decided Oct 4, 2026 after the judge flagged key pairs, hashes and certificate chains. Written into `skills/condense/SKILL.md` and the judge prompt.

### Teaching craft
`skills/_shared/teaching-craft.md` holds moves, not a voice: never imitate phrasing or catchphrases. Sources (noted in the file header only): the Rust Book authors, Julia Evans, Martin Kleppmann, Jay Alammar, Jeffrey Way, Wes Bos, the Laravel docs, 3Blue1Brown, Feynman, Strogatz.
- Math and science pattern: open with the puzzle, one concrete case before the rule, invent the idea, picture before formalism, plain words for each symbol, name the wrong intuition, close with a "what if we change X" check.
- Analogies are a first-class move for math and science: flagged as analogies, each says where it breaks, and the fact check covers what the analogy implies about the subject. The loop tests whether analogy-heavy output scores higher.
- `condense` reads it (last item of its "Read first" list). It was NOT wired in during the first two loops, so those loops never tested the moves and could not improve the file. Their kept changes went into `condense/SKILL.md` only. The editor prompt in `run.ts` already says the skill reads the file, which is now true.

## The loop (offline; it tunes the skill, not a document)

`pnpm loop score` and `pnpm loop run`, in `scripts/condense-loop/` (`run.ts`, `config.json`). Works in a scratch copy of the library under `_loop/` (git-ignored), never `library/`. A winner is promoted only on the user's say-so (`--apply` or copying `best-skills/`).

### Roles (config.json)
| Role | CLI and model | Why |
|---|---|---|
| Generator | OpenCode, `opencode-go/muse-spark-1.3-contributor` | What production runs (`library/_studyo/settings.json`) |
| Reader | OpenCode, `opencode-go/deepseek-v4-flash` | Different family from the generator, so it does not read its own prose kindly |
| Judge | Claude, `sonnet` | Strongest model; separate session from the editor |
| Editor | Claude, `sonnet` | Edits `condense/SKILL.md` and `_shared/teaching-craft.md`; never sees the answer key |

### What one scoring run does
1. Copy the topic (without earlier outputs or files over 3 MB) into a scratch library with the candidate skills and a fixed learner profile.
2. Generate with the production CLI, unattended (`interactive: false`).
3. The reader gets the guide, the profile and the questions in its prompt (no files, no keys). Each answer must quote the guide passage it relies on, or say NOT COVERED. It also keeps a confusion log about reading the guide.
4. A closed-book baseline (no guide) is run once per topic and depth and cached in `_loop/baseline/`. It is a leak detector only: questions the model knows are flagged, never dropped.
5. The judge reads the pack, the guide, the keys, the reader's answers and the baseline. It returns: ungrounded facts (quoted), per-question credit with a quote check, per-concept coverage level (0 absent, 1 named, 2 explained, 3 shown, 4 checked), an experience rubric (opening, defined before used, thread, teaching moves, depth for goal) and a verdict with up to three weaknesses tied to concepts or headings. A reply missing a section is retried once.

### Score
- Grounding is a gate: any ungrounded fact means the run is gated (`total` 0). `raw_total` is also reported so the loop can rank gated runs.
- Learning = 0.7 quiz + 0.3 coverage (share of concepts at the target level: 2 for default, 3 for longer).
- Ease = 0.5 experience rubric + 0.5 confusion score (confusion points, capped at 20).
- Raw total = 50 learning + 50 ease. Length is a diagnostic only. All weights are in `config.json`.

### The quiz (loop only, never in the app)
- Concepts come from `teaches` for course chapters, and from a one-time pass over the pack for standalone topics.
- Three tagged questions per concept: explain, apply, discriminate. Default depth runs every explain question plus the apply questions marked default; longer runs everything.
- Written once from the pack (never from a guide), with answer keys, reviewed by the user, then frozen in `fixtures/condense-loop/quizzes/`. The editor never sees keys.
- Profiles: `fixtures/condense-loop/profiles/` (developer, non-specialist).

### Topics (one depth each)
| Role | Topic | Depth | Profile | Frozen quiz |
|---|---|---|---|---|
| Tune | pc-ca-mcts | default | non-specialist | yes |
| Held out | DDIA ch 1 | default | developer | yes |
| Regression | K2 | default | developer | yes |
| Tune | Rust ch 2 | longer | developer | not yet |
| Tune | DDIA ch 2 | longer | developer | not yet |
| Held out | Rust ch 3 | longer | developer | not yet |
| Held out | Navier-Stokes | longer | non-specialist | not yet |

Later: DDIA ch 3 or Rust ch 1 as a held-out default topic.

### One iteration
1. The editor gets the judge's weaknesses, scores and reader notes, and the list of earlier tries, and must make one focused change to the skill (no subject-specific text, no loosening of grounding).
2. Score the candidate on the tune topics (2 generations, averaged).
3. Better = fewer ungrounded facts first, then a higher raw score by at least the margin (6).
4. If better, score the held-out topics (2 generations). Keep the change only if held-out ungrounded facts rise by no more than 1.5 and raw does not drop by more than the margin.
5. Stop after 8 iterations, after 3 in a row with no kept change, or at the Claude budget ($30). Output: `_loop/<label>/` with `loop.log`, `final.patch`, `usage.json`, `best-skills/`.

## What the first runs showed (Oct 4, 2026)
- Today's `condense` baseline on pc-ca-mcts: raw 72 to 78, 4 to 6 ungrounded facts, quiz near 100% (an overview quiz saturates; the signal is grounding, ease and coverage).
- Two loops kept: a fuller fact-check step, a predict-then-reveal check, and "say when the pack uses two names for one thing". Combined: tune raw 82.8 to 82.4, held-out raw 78.5 to 83.2, tune ungrounded facts 5.5 to 3.0, held-out ungrounded facts 4.5 to 5.8.
- Noise: the same skill scored 3.0 and 5.5 ungrounded facts in two runs, and raw differs by about 5 points between runs. The grounding count is too noisy to climb with 2 generations.
- Every guide still fails the gate (3 to 6 flagged facts). Prompt edits alone have not removed the model's habit of adding facts.
- Claude usage: about $9.60 for the two loops ($2.85 and $6.72), plus a little for earlier test runs that were not logged. Judge about $0.22 per call, editor $0.05 to 0.10. OpenCode reports no cost.

## To do
- [x] Design grilled and settled
- [x] Teaching-craft file drafted (not wired into a skill)
- [x] Learner profiles and frozen quizzes for pc-ca-mcts, DDIA ch 1, K2
- [x] Scoring script, editor loop, usage ledger
- [x] First loops run; first tuned `condense` changes committed
- [ ] Make the grounding signal usable: average 3 generations and have the judge itemise ungrounded facts against a stricter list, so the loop can tell whether the gate is getting closer
- [x] Wire `teaching-craft.md` into `condense` (one line in "Read first")
- [ ] Re-baseline with it wired in (`pnpm loop score --topics pc-ca-mcts`, plus the held-out topics) before tuning anything; then run the loop so the editor can improve both files
- [x] The in-depth skill (`condense-deep`), the Default/Deep dive sheet in the app, depth in the file name and the "Deep dive:" title (built Oct 4, 2026; `deep-loop-1` kept no change to the skill)
- [x] Condensed docs never overwrite each other; swipe a condensed doc to regenerate (replaces it when the new run succeeds) or delete; a notes box under Selected parts; `predict` blocks (question shown, answer folded) in the render contract
- [x] Frozen quizzes for the longer-depth topics (Rust ch 2, DDIA ch 2, Rust ch 3, Navier-Stokes); judge moved to OpenCode `deepseek-v4.1-flash`
- [ ] Third CLI for the loop: an `agy` adapter in `apps/server/src/adapters/`, an entry in the `adapters` map in `scripts/condense-loop/run.ts`, and a role in `config.json`. For the server too, add it to `CliId` in `packages/api/openapi.yaml`.
- [ ] Backlog: a runtime draft, critique and revise loop, only if the offline loop plateaus (expensive)

## Running it on another machine or session

Needs: the repo on branch `condense-loop`, `pnpm install`, a `library/` containing the three topics (`pc-ca-mcts`, the DDIA ch 1 chapter, `cloudflare-k2-streams`, with their packs, which are git-ignored and not in the repo), the `claude` CLI (judge and editor) and the `opencode` CLI with the `opencode-go` models in `config.json` (generator and reader). Do not run it against a live `library/` you care about: it only reads from it and writes to `_loop/`.

- Order: run a baseline score first (below), look at it, then run the loop. The skill now reads `teaching-craft.md`, so earlier numbers are not comparable.
- The topics' packs and sources are NOT in git (`library/` is ignored). Copy them in or rebuild them. The frozen quizzes and both profiles are in the repo (`fixtures/condense-loop/`).
- The judge and editor roles use Claude. With no Claude usage left the run fails at the first judge call, so either wait, or write another CLI's adapter and point those two roles at it.
- Score once: `pnpm loop score --topics pc-ca-mcts --label baseline-4`. Add `--reuse <label>` to re-judge an earlier guide without regenerating.
- Run the loop: `pnpm loop run --label loop-3 [--from <skills dir>] [--apply]`. Without `--apply` it only writes `_loop/<label>/best-skills/` and `final.patch`.
- Relative paths resolve against the repo root. The script runs from `apps/server` under pnpm.
- Cost: judge about $0.22 per call; a 3-iteration loop ran about $3, an 8-iteration one about $7. Config has a $30 Claude budget cap (`budget_usd`). To avoid Claude entirely, change the `judge` and `editor` roles in `config.json` to another adapter (see the `agy` item above), noting that the judge should be the strongest model available.
- Pitfalls hit so far: the macOS `sed -i` needs an empty-string argument; background runs should use `nohup` and be polled via `_loop/<label>/loop.log`; a judge reply can miss a section (retried once).
