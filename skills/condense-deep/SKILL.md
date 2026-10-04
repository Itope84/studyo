---
name: condense-deep
description: Write an in-depth study guide for a Studyo topic. Where `condense` gives an overview, this skill goes deeper: worked examples, step-by-step code or traces, predict-then-reveal checks, and coverage of every concept the chapter teaches. Facts come from the pack only. Runs when the user picks "Longer" depth. Produces Markdown for the Reader view and for NotebookLM.
---

# Condense Deep (in-depth guide)

Read first, in this order:
`../_shared/topic-folder.md`, `../_shared/grounding-and-citations.md`, `../_shared/render-contract.md`, `../_shared/teaching-craft.md`.

Runs only when the user asks, or when the app sends `depth: longer`. Never start on its own.

Parameters beyond the shared ones:
- `scope`: `all`, or a list of pack section ids to cover.
- `output_path`: where to write the document, relative to the topic folder. When given, write exactly there and do **not** edit `topic.json`: the app registers, titles and labels the document itself, and a hand edit of that file can corrupt it. Never overwrite another condensed doc. Without `output_path`, use the slug rule below and update `topic.json` as usual.
- `notes`: what the learner asked to have covered or stressed (free text, optional). It steers focus and emphasis only. Facts still come from the pack alone; if the pack does not cover what the notes ask, say so in the closing note rather than filling it.
- `depth`: always `longer` for this skill. Treat it as a confirmation.

Output: `output_path` when given, otherwise `outputs/condensed-deep-<slug>.md` (and `.html` when the renderer exists), assets under `outputs/assets/`, an updated `topic.json`. The slug is the scope plus the date, so earlier deep guides are kept alongside the standard ones.

## In a course

If `topic.json` has `course`, this topic is a chapter. Read `../../courses/<course id>/course.json` (the path is `course_path` when given) and the `teaches` of the prerequisite chapters the learner has finished (a pack item with `done: true` in their `progress.json`). Treat those concepts as known: do not re-explain them, refer to them in a clause ("as in the replication chapter") and move on. Do not explain a prerequisite concept twice.

## Coverage check

Before writing, compare the chapter's `teaches` list (from `topic.json`) against the pack's sections. If a concept in `teaches` is missing from the pack:
1. Note the gap in `sources/_work/condense-deep-gaps.md`.
2. Set `failed` on `topic.json` with a message naming the missing concepts, and print `[studyo] condense-deep: enrich needed for: <list>`. Stop. The server will offer an enrich job first.

If all concepts are covered by the pack, continue.

## The job

**You are a teacher writing a study guide for one person who wants to go deep.** This is not a longer summary. It is a guide that teaches every concept in `teaches` to the point where the reader can apply, explain and predict — level 3 (shown by a worked example, code or trace) or level 4 (checked by a predict-then-reveal).

Understand first, then explain. Read the entire pack until you could explain the subject without it in front of you. Then write the explanation as one connected piece.

**What the reader needs from an in-depth guide**
- **A clear start.** The opening says what this is in plain words, why it matters to this person, what they will be able to do after reading it, and where the guide is going. It does not describe the learner or the process.
- **Nothing used before it is explained.** The first time a named thing appears (a product, a term, an acronym), say what it is, right there.
- **One thread.** Each part picks up from the last. The reader should never wonder why they are reading a section.
- **Every concept in `teaches` at level 3 or higher.** For each concept: name it, explain it, show it in a worked example or trace, and give a predict-then-reveal check. No concept left at "named only" or "explained in prose only" — show it working.
- **Worked examples and code are first-class citizens.** For systems: trace one request through every part. For code: show the smallest working thing, then grow it. For math or science: show the picture, then the calculation, then ask the reader to predict a variation.
- **The ideas, not the sources.** Say each idea in your own voice. Do not narrate where it came from.
- **Details that help.** Limits and defaults are usually lookup material; include one if the reader needs it to understand how the system behaves.

**Where the facts come from.** Facts come from the pack. You do not cite anything.
- A *fact* is something specific that could be checked: how a system behaves, a guarantee, a number, who said what. Every fact you state must be something the pack or its saved sources say.
- *Teaching* is yours: explanations, ordering, examples, analogies, worked traces, predict-then-reveal checks, and any wording that clarifies without adding facts.
- A *basic definition* is allowed even when the pack lacks it: a short plain-words explanation, a sentence or two, of a general background term the learner needs (what a key pair or a hash is), the kind any textbook entry states. It must carry nothing specific to this subject: no numbers, behaviours or guarantees of the systems in the pack. Those come from the pack only.
- Simplify without making a fact false. Qualify where needed ("roughly", "usually").

## Steps

### 1. Prepare
Read `topic.json`, `pack/pack.md`, `library/profile.md`. If there is no pack, set `failed` with "no pack to condense-deep" and stop. Print `[studyo] condense-deep: starting`.

### 2. Coverage check
Run the coverage check described above. If any concept in `teaches` is missing from the pack, stop and report.

### 3. Level
Run `level-check` with the key concepts of the in-scope pack and `scope`. It asks nothing the profile already answers, and at most one batch question. Unattended, it assumes the concepts not in the profile are gaps.

### 4. Plan
Read the in-scope pack content, including all background sections. Then write a detailed plan to `sources/_work/condense-deep-outline.md`:
- **The thread:** the one question the document answers, and the chain of sub-questions that carries the reader from start to finish.
- **Concept map:** for each concept in `teaches`, which pack section(s) support it, and the order to introduce them so nothing is used before it is explained.
- **Depth plan per concept:** which teaching move to use (worked example, trace, code walkthrough, analogy + check), and the specific predict-then-reveal question.
- **Where to place checks:** roughly one predict-then-reveal check every two or three concepts, or after each major idea.
- Where a diagram or figure would carry the idea better than prose.

### 5. Write
Write the whole guide in one pass. Connect to what the learner already knows or cares about. Answer "why does this matter?" before "how does it work?".

**Depth is not length.** Length follows coverage. Every concept in `teaches` must reach level 3 (shown) or level 4 (checked). Do not pad; do not truncate a concept to save space.

**Style**
- Clear, warm, direct. No lecture tone.
- Define each term the first time it appears, in plain words. Stable names: do not rename a thing. When the pack uses two names for one thing, say so.
- One idea per paragraph, at most four sentences. Keep table cells to a phrase or short sentence.
- Break text up with whatever helps: a table, list, diagram, code block, worked example, analogy. Most parts need good prose plus one demonstration.
- Every heading is a stable navigation point.

**Required devices for in-depth material — use each where it fits, not as a checklist:**
- **Worked examples or code.** For every concept that has a procedural or mechanical side: show it step by step, with output. The smallest version that shows the point, then optionally one extension.
- **Traces for systems.** Pick one concrete operation and trace it through every component. Show what each part does to the data or request. Then break one part and show what changes.
- **Predict-then-reveal checks**, written as `predict` blocks. After teaching a concept, ask a short question the reader can answer by applying what they just read to a new case (a count, a next step, where something stops, why a result is what it is). Give the answer and the reasoning right after. Build it only from facts and numbers already stated in the text. Aim for one check every two to three concepts, minimum.
- **Analogies (for math and science).** Use one whenever it carries the structure of the idea. Say plainly it is an analogy, say where it breaks, and add no fact the pack does not state.
- **Diagrams** (`mermaid`) for relationships or processes.
- **Reference box** at the end for limits, quotas and options the learner's goal does not need during reading.

**Variety is part of quality.** Read the headings and first lines of every part together before finishing. If several parts open the same way, rewrite them to differ where the ideas allow. If a device appears more than twice in the same part, ask whether some uses add nothing — cut those.

### 6. Check the facts
Go through the finished text. Any specific fact the pack does not support: cut it, or rework it into what the pack does say. Also look for facts that slip in as elaboration: your own arithmetic or estimates, a list of items where the pack names fewer, a consequence the pack does not state, a requirement made stricter or looser than stated, a qualifier added to a claim. Cut each back to the pack's own words and numbers. Check that worked examples and traces use only numbers and behaviours from the pack. Check that analogies imply nothing false about the subject. Add nothing to the text to show this was done.

### 7. Coverage audit
Go through the `teaches` list. For each concept:
- What level did the guide reach? (0 absent, 1 named, 2 explained, 3 shown, 4 checked)
- If below 3, expand that concept now: add a worked example, trace or code block.
- If no predict-then-reveal check exists for it, add one.

Do not finish until every concept is at level 3 or higher.

### 8. Read it as the learner
Read it start to finish as someone who knows only what the profile says. Fix what fails:
- After the first paragraph, can you say what this is, why it matters and what you will be able to do?
- Is any name used before it is explained?
- Does every part start from the one before?
- Can you actually answer the predict-then-reveal checks from what the guide has told you so far?
- Does any sentence narrate a source, or mention the pack or the profile?

If something the learner needs is missing from the pack, do not fill it. Add a short closing note saying what the material does not cover, and suggest running enrich for it.

### 9. Finish
Render if the renderer is available. Unless `output_path` was given, update `topic.json` with the new `condensed-deep` resource (type `condensed`, depth `longer`). Print:
`[studyo] condense-deep: done. <n> sections, <k> concepts at level 3+, <j> predict-then-reveal checks, <m> items not covered by the pack.`

## Do not

- Do not state facts from outside the pack, even to smooth a gap. Teaching, orientation, examples and checks are yours. Facts are the pack's.
- Do not alter the pack, the ledger or the sources. Only add to `outputs/` and `topic.json`, and update `library/profile.md` through `level-check`.
- Do not write outside the topic folder, except as `level-check` does.
- Do not confuse length with depth. A concept shown by a worked example and checked by a predict-then-reveal question is deep, regardless of word count. A concept covered only in prose is not deep, regardless of word count.
