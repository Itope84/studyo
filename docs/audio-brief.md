# Audio brief (narrated study packs)

Started Oct 5, 2026. Status and checklist: `docs/plan.md`, slice 11. The skill: `skills/narrate/SKILL.md`.

## What it is

A condensed document turned into a spoken, two-host conversation (host and co-host, one male and one female voice) that teaches the whole document and can be listened to in the app. Reading text aloud was rejected: it drones and loses the listener. The goal is a teacher-like, lively explanation, closer to NotebookLM's audio overview than to an audiobook.

## Decisions

- **Two skills' worth of craft, kept apart.** `condense` is built for reading and is not touched by this work. `narrate` is its own skill: it takes a condensed document as its source, so it never re-decides what to teach, in what order or at what level, but it must write an engaging script, not a flat read-through. Complete in coverage, free in expression.
- **One mode, not two.** An earlier "story" mode (pick the highlights and compress to N minutes) was dropped. Length follows the document's depth: a standard condensed doc gives a short episode, a deep dive a long one. Narrower cuts use `scope` (sections). A "highlights" audio is a short condensed doc, narrated in full.
- **Always from a condensed doc.** If the learner asks for audio with no condensed doc, the job condenses first, then narrates. The condensed doc is kept: it is the source and the transcript, and it is the cheaper step.
- **The script is engine-neutral JSON** (segments with `speaker`, `text`, `tone`, `pace`, `pause_after`, `emphasis`, `part`). The skill never names a voice or an engine. A server-side voice adapter, like the CLI adapters and `LibraryStore`, turns it into audio. Local default and hosted engines sit behind the same interface.
- **Parts.** The script is always written in parts of about 8 to 11 minutes, broken at section boundaries, each after the first opening with a recap. Presentation is a setting: one episode with chapter markers, or separate parts. Rendering per part makes failures cheap to retry and lets part 1 play early. The split costs no extra model calls.
- **Fact check** is a coverage and fidelity check against the condensed doc (every concept, example and number present; nothing added), not a source check. Cheaper than the pack-level check.
- **Settings in three tiers.** Per request, in the sheet: voices, scope, parts. Per user, as defaults in the profile: voice count, parts. Ours, hidden: engine, model, chunking. Playback speed lives in the player.
- **Test skills through OpenCode, not Claude Code** (it is what runs in production, and Claude burns the user's tokens). See `CLAUDE.md`.

## UX

- **Reader header** keeps three actions visible: Outline, Listen, Ask. Download, Mark as read, Regenerate and Delete move into one overflow menu. No floating button.
- **Listen** opens a bottom sheet (voices, scope, parts, estimated length and time) with one "Make audio" button. When audio already exists, Listen plays it. When the doc was regenerated since, it offers to make the audio again.
- **From the topic page** with no condensed doc: the same sheet plus a depth choice and a line saying a condensed doc is written first.
- **Topic page:** "Add file" is renamed "Upload media" (it only takes audio and video). The pack-rebuild action (today the `reenrich` sheet) becomes "Recondense" and sits beside the pack. Consider one "Make" entry and sheet (condense, deeper, audio, quiz, take-home) separate from consuming (read, listen, chat), so the page stops growing buttons.

## Engine findings so far (one 6 minute test, Oct 5)

- **Kokoro (local, free, 82M):** clean but flat, no emotion control: a voiceover. About 5x real time on the M1 8 GB Mac mini. Rejected for the engaging goal; kept as a free offline fallback.
- **Gemini 3.8 Flash TTS:** "serviceable", clearly better. Native two-speaker mode, free tier works but rate limits (429s, retried). No system instruction in multi-speaker mode and every part needs a speaker, so delivery comes from a `[tone]` tag in front of each turn. Each request ends with a loud noise burst before silence (found by checking the signal: about 0.5 RMS against 0.15 for speech). `scripts/voice/clean_tail.py` trims it.
- **Not tried:** OpenAI gpt-4o-mini-tts, Gemini 2.5 Flash TTS (free-text style prompt), Google Chirp 3 HD (free 1M characters a month, no style prompt), Chatterbox (too heavy for 8 GB, would need a GPU host such as RunPod). Cost per 15 minute episode is roughly $0.15 to $0.50 for all hosted options, so quality decides.
- **Cloud design:** audio rendering is its own step after the container writes the script, called through the gateway so the ledger can meter it. Cloudflare Containers has no GPU.

## Open

- Does a faithful conversion of a condensed doc sound as engaging as the story version? (First test: DDIA chapter 1, in progress.)
- Voice choices (Gemini has about 30), Kokoro cadence is a separate problem.
- Pause control inside a Gemini request (the model paces turns itself; `pause_after` only acts between requests).
- A renderer fix for bad front matter (see the backlog item "Never break the UI on a format the AI gets wrong"); a skill rule to quote front matter values.
