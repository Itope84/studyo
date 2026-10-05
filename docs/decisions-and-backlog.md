# Studyo: decisions, open items, backlog

Companion to `Learning Library product brief.md` (Oct 2, 2026). Updated as we go.

## Decisions (post-brief discussion)

| # | Topic | Decision |
| --- | --- | --- |
| D1 | Provenance | Enforced in the skill prompts only. No mechanical post-run verification. |
| D2 | Pack format | Markdown stored internally; **HTML is the rendered, engaging, in-app reading format** (supports richer layout and reading-position tracking). Original sources stay as-is in `sources/`. Exact markdown/HTML relationship (which is generated from which, where each lives in `pack/` and `outputs/`) to be pinned down in the skills phase. |
| D3 | CLI backend | Server wraps Claude Code and OpenCode behind **one adapter** so they can be swapped as allocations change. Model allocation is a separate discussion. |
| D4 | Unattended safety | Keep in mind, not top of mind. Revisit in skills phase (tool allowlist, write scope, turn/cost caps, timeouts). |
| D5 | Auth | Tunnel is authenticated by **Cloudflare Zero Trust**. The app (web and Android) must handle that auth on its requests to the server, in addition to the app access token. |
| D6 | Skills | Skills live in `skills/` (see its README). Search and fetch use each CLI's own tools; skills name none. Standard enrichment is bounded; deep research is a separate skill run only on request (D7). |
| D7 | Depth tiers | `enrich-document` and `enrich-topic` are bounded by default. `enrich-deep` escalates a topic that already has a pack, only when asked. All budgets are in `skills/_shared/limits.md`. |
| D8 | Level profiling | Moved from `condense` into enrichment, via a `level-check` skill that saves `profile.json` per topic. It shapes which background is sourced, and `condense` reuses it. This changes the brief, which only had level questions in `condense`. |
| D9 | Output format | Skills write Markdown only. A renderer script produces HTML (spec: `skills/_shared/render-contract.md`). Engagement comes from directives (callouts, mermaid, figures), not hand-written HTML. Supersedes the open "who produces HTML" item. |
| D10 | Anchors | `enrich-topic`: one anchor in full plus up to 5 other primaries as excerpts. Confirmed for now. |
| D11 | Analogies | `condense` may use labelled analogy callouts as a teaching aid. They must carry no facts beyond the sources. Confirmed. |
| D12 | Sufficiency over caps | No cap on background sections. Enrichment adds what the learner needs to follow the material. `limits.md` keeps only cost ceilings on searches and opens, as a safety net. Replaces the earlier cap of 5. |
| D13 | Person profile | `library/profile.md` (YAML `knows` list plus free-text notes) is the person-level memory across topics. `level-check` asks one batch question at most, two prerequisite layers deep, pre-ticks what the profile implies, and skips it when the profile answers. The app will later add `via: read` entries when a topic is marked read. Topic goal and gaps live in `topic.json → learning`. Replaces per-topic `profile.json`. |
| D14 | Condense teaches | Grounding applies to facts, not wording. `condense` explains in its own words with facts from the pack, and quotes only when exact wording matters. Teaching devices (analogy, worked example, diagram, table) are a toolbox used only where an idea needs one, with a self-check for sameness. Never required. Replaces the earlier "quote-first" behaviour and the labelled-analogy requirement. |
| D15 | Citations | Reference-style: `[S3]` in the text and `[S3]: url` at the bottom. Assembling skills cite per passage; `condense` cites per paragraph. |
| D16 | Source provenance | Each ledger entry records `found_via` and `from`. Sources should come from retrieved pages or search; a URL recalled from memory is a logged last resort when search fails, citable only if it opened. Failed and rejected fetches are logged. Fetch with the CLI's fetch tool; shell `curl` is a logged fallback (`fetched_with: curl`). Triggered by the first test run, which made no searches and fetched two RFCs from memory via curl. |
| D17 | Run log | Enrich skills append one line to `<topic>/runs.jsonl` (`searches`, `opened`, `stopped_by`, `dropped_for_ceiling`) to show how often ceilings are hit. Deliberately not built: transcript-based counting, a stats script (revisit at about 10 runs), a `run` field on ledger entries, timing fields, run lines for `condense`/`answer`. |
| D18 | Condense is teaching, not citing | `condense` writes no citations of any kind. It is framed as a teacher explaining to one person: a clear opening, nothing used before it is explained, one thread, ideas not sources, and only the details that help. Facts still come from the pack, checked in a quiet pass after writing, never shown in the text. Orientation and teaching are the model's own. Supersedes the citation rules for condense in D14 and D15. Triggered by the K2 test doc, which opened with a note about the reader and read as a chain of cited facts. |
| D19 | Courses | A course is a path of chapters over central resources. A chapter is a topic folder with a `course` field, so the whole topic machinery works on it. Brief: `docs/courses-brief.md`. |
| D20 | Course build cost | Chapters build lazily, one `enrich` job each, from the course page ("Build next" 1 or 3) or from the chapter. The outline shows how many runs it implies. Nothing expensive runs before the outline is approved. |
| D21 | Prerequisites | Advisory, never a lock. Direct dependencies only, no cycles (the server drops edges that close a loop). The AI proposes, the learner corrects with a sentence. No graph editor. |
| D22 | Scanned PDFs | Not supported. Refused when added, using `pdftotext`, with no AI run. OCR is a later item. |
| D23 | Quizzes and take-home | Only when the learner asks, for topics and chapters (quizzes also for courses). Quizzes are grounded in the pack; choice is graded on the server, written answers by a job. Take-home takes optional context (text, link, file) and any submission including plain text; reviews read and never run code. |
| D24 | Chat rework | Chat stays pack-only until slice 8 in `docs/plan.md`. The learner's description is saved there verbatim. |

## Open items to resolve

- [ ] **Cloudflare Zero Trust from the app.** Mechanism for web (cross-origin, cookies vs. service tokens) and Android (service token headers vs. login flow). Affects CORS, `GET /files` streaming and the Settings screen.
- [ ] **CLI adapter interface.** Session create/resume, skill invocation, streaming, job limits, normalised across Claude Code and OpenCode.
- [ ] **Model allocation** per job type (enrich, condense, answer). Separate discussion.
- [ ] **Build the renderer** (Markdown + directives to HTML, reading-position hook). Spec in `skills/_shared/render-contract.md`.
- [ ] **Build `needs_input` job state.** Decided: yes. A job can pause with questions, the app asks, the answers are saved and the job resumes. `level-check` still falls back to `unassumed` until it exists. Design the question/answer shape (likely the `level-check` questions as JSON) with the API.
- [ ] **Contract changes the skills assume:** `library/profile.md` is the one file a skill writes outside its topic folder (via `level-check`, covered in the safety rules); `topic.json` gains `learning`; auto-discovery and the app ignore `_`-prefixed files and folders; `ledger.jsonl` and `claims.jsonl` live in `sources/`. Update the brief's folder contract.
- [ ] **PDF to Markdown converter** on the server: which one, and what the skill does when conversion quality is poor.
- [ ] **`curl` fallback bypasses CLI fetch controls.** Decide in the adapter's safety rules whether shell `curl` stays allowed for unattended jobs, and whether to restrict domains.
- [ ] **OpenCode search enablement:** `OPENCODE_ENABLE_EXA=1` or `OPENCODE_ENABLE_PARALLEL=1` (or the OpenCode provider) on the server. Check before first run.
- [ ] **Validate the cost ceilings** in `limits.md` (searches, opens). They are guesses until we run real topics. Raise them if good topics keep hitting them.
- [ ] **Profile UI:** app screen to view and edit `library/profile.md`, and to mark a topic as read (adds `via: read`).
- [ ] How many sources should `enrich-topic` gather? First answer is in `limits.md`; confirm after real runs.
- [ ] Android share menu: links as well as files?
- [ ] App name (working name: Studyo).
- [ ] Unattended-job limits per skill (see D4).
- [ ] Hard inputs: paywalled or JS-heavy links, failed fetches, what the pack says when a source can't be retrieved.
- [ ] Job-complete notification delivery (web and Android).
- [ ] Chat session resume after a CLI/server restart.

## Backlog (post-v1)

- Study aids from saved sources: quizzes, flashcards, spaced repetition (candidates: `jacquardlabs/study-skills`, `mordor-forge/study-skill`).
- Shareable PDF export generated from the HTML pack/condensed doc.
- Android Auto (build step 8; verify sideload visibility first).
- Native iPhone app / CarPlay.
- Chat: pick the model per chat from the chat screen (today it uses the CLI default).
- Chat: thumbs up / down on each reply, kept with the question so the worst answers feed an AI-judged improvement loop for the `answer` skill.
- **Never break the UI on a format the AI gets wrong.** The renderer throws on a slip in generated content (unknown directive or callout kind, bad front matter, unmatched source markers, a missing image), and the reader then shows "This document couldn't be shown". Instead: repair what it can, fall back for the rest (unknown directive as a code block, unknown callout as a note, missing image as its alt text), record a warning in the job log, and have the reader fall back to plain text with a small notice if rendering still fails. Add a test per case with a deliberately broken document. Hit twice on Oct 4 and 5, 2026: a skill corrupted `topic.json` (now guarded), and a code block inside a fenced `predict` block closed the fence early (the predict block is now a quote plus an HTML `<details>`).
