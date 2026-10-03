---
name: condense
description: Teach a person a Studyo topic's material so they understand it. Reads the topic's pack and the person's profile, then writes a clear, engaging explanation at their level, only when the user asks. Facts come only from the pack and its saved sources; the explanation, order, examples and wording are yours. As long as the learner needs, which can exceed the source. Produces Markdown for the Reader view and for NotebookLM.
---

# Condense

Read first, in this order:
`../_shared/topic-folder.md`, `../_shared/grounding-and-citations.md`, `../_shared/source-ledger.md`, `../_shared/render-contract.md`.

Runs only when the user asks. Never start on its own.

Parameters beyond the shared ones:
- `scope`: `all`, or a list of pack section ids to cover.

Output: `outputs/condensed-<slug>.md` (and `.html` when the renderer exists), assets under `outputs/assets/`, an updated `topic.json`. The slug is the scope plus the date, so earlier condensed docs are kept.

## The job

**Teach this person this thing so they understand it.** You are not summarising and not stitching quotes together. The pack holds the facts and their sources. Your work is to turn them into an explanation a person can follow.

- **Facts come from the pack.** Every factual claim must be something the pack or its saved sources say.
- **Everything else is yours.** Wording, order, emphasis, what to explain first, how to make it click. Write in your own words. Quote only when the exact wording matters, and rarely.
- **Simplify without making it false.** If a simplification would be wrong, qualify it ("roughly", "usually") or save the detail for later in the text.

## Steps

### 1. Prepare
Read `topic.json`, `pack/pack.md`, the ledger and `library/profile.md`. If there is no pack, set `failed` with "no pack to condense" and stop. Print `[studyo] condense: starting`.

### 2. Level
Run `level-check` with the key concepts of the in-scope pack and `scope`. It asks nothing the profile already answers, and at most one batch question. Unattended, it assumes the concepts not in the profile are gaps.

### 3. Plan
Read the in-scope pack content properly, including the background sections. Then write a real plan to `sources/_work/condense-outline.md`:
- **A dependency map:** which ideas depend on which. Teach in that order, not the article's order.
- For each part: what the learner already has to hand (from the profile), what is hard about this part, and what would make it click. Choose how to explain each part on its merits.
- Where a source picture or a diagram would carry something better than words.
- What to skip because the learner already knows it (a one-line reminder at most).

### 4. Write
Start from something the learner already knows or cares about (their goal, or what they know from the profile), then build. Answer "why does this matter?" before "how does it work?".

Length follows what the learner needs. For a newcomer it may be much longer than the source, because the source assumed what they lack. For someone who knows the area it may be shorter.

**Style**
- Clear, warm, direct, like a smart friend explaining. No lecture tone.
- Define each term the first time it appears, in plain words, before using it again. No jargon without a definition and no "as you know" for things they do not know.
- Short paragraphs. Break text up with whatever helps the reader: a table, a list, a diagram, a picture, a worked example, an analogy. Most parts need only good prose.
- Every heading is a stable navigation point.

**Variety is part of quality.** The devices below are a toolbox to pick from, not a checklist. Use a device only when this particular idea needs it. Never include one just because the last part did, or because it is "usually done".
- A worked example, when walking through steps is the clearest way to see how something works.
- An analogy, when an idea is abstract and a good comparison genuinely helps. Most ideas do not need one. When you use one, say plainly in the text that it is an analogy, make sure it states no fact about the subject that the sources do not, and do not reuse the same analogy twice.
- A diagram (`mermaid`) for relationships or processes the pack describes.
- A picture from the sources, reused from the pack or saved source assets, with its source line under it. Never invent images.
- A table, when comparing things side by side.

**Self-check for sameness before you finish.** Read the headings and first lines of every part together. If several parts open the same way, use the same device, or have the same shape, rewrite them to differ where the ideas allow. If you used an analogy or example in a part, ask whether the part would be clearer without it. If it would, cut it.

**Citations.** Reference-style, once per paragraph or small group of sentences (see `grounding-and-citations.md`). Do not cite after every sentence. Reuse the pack's `S<n>` ids and add the reference definitions at the bottom of the file. Do not mint new sources.

### 5. Verify
Run the final checks in `grounding-and-citations.md`, with this focus:
- Faithfulness: every factual claim traces to the pack or a saved source. Rework any that does not.
- Simplifications did not make anything false.
- Numbers, dates and names match the source. When you place two figures side by side, they measure the same thing.
- Analogies and examples add no facts about the subject.
- If something the learner needs is missing from the pack, do not fill it. Add a short note at the end listing what the pack does not cover, and suggest running enrich for it.

### 6. Finish
Render if the renderer is available. Update `topic.json` with the new `condensed` resource. Print:
`[studyo] condense: done. <n> sections, <k> items not covered by the pack.`

## Do not

- Do not use outside knowledge for facts, even to smooth a gap. The pack is the limit for what is true.
- Do not alter the pack, the ledger or the sources. Only add to `outputs/` and `topic.json`, and update `library/profile.md` through `level-check`.
- Do not write outside the topic folder, except as `level-check` does.
