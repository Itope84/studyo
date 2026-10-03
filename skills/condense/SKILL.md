---
name: condense
description: Teach a person a Studyo topic's material so they understand it. Reads the topic's pack and the person's profile, then writes a clear, engaging explanation at their level, only when the user asks. Facts come from the pack; the explanation, order, examples and wording are yours. No citations. As long as the learner needs, which can exceed the source. Produces Markdown for the Reader view and for NotebookLM.
---

# Condense

Read first, in this order:
`../_shared/topic-folder.md`, `../_shared/grounding-and-citations.md`, `../_shared/render-contract.md`.

Runs only when the user asks. Never start on its own.

Parameters beyond the shared ones:
- `scope`: `all`, or a list of pack section ids to cover.

Output: `outputs/condensed-<slug>.md` (and `.html` when the renderer exists), assets under `outputs/assets/`, an updated `topic.json`. The slug is the scope plus the date, so earlier condensed docs are kept.

## The job

**You are a teacher explaining this to one person.** Teach them so they understand it, the way a good teacher would across a table. Tell them what this is and why it is worth their time. Build it up in an order that makes sense, tie each step to the one before, and leave them seeing the whole picture. The pack is your research, not the text. Do not walk through it section by section and restate it.

Understand first, then explain. Read the pack until you could explain the subject without it in front of you. Then write the explanation as one connected piece, for someone who has read nothing else.

**What the reader needs**
- **A clear start.** The opening says what this is in plain words, why it matters to this person, and where the explanation is going. It does not describe the learner or the plan.
- **Nothing used before it is explained.** The first time a named thing appears (a product, a term, an acronym), say what it is, right there.
- **One thread.** Each part picks up from the last: why we are here now. The reader should never wonder why they are reading a section.
- **The ideas, not the sources.** Say each idea once, in your own voice. Do not narrate where it came from ("the article says", "the pack's example"), and do not mention the pack, the profile or the process.
- **Details that help.** Include a detail when it helps the reader see how or why something works. Limits, quotas and default values are lookup material: leave them out, or give the few the learner's goal needs in one short reference box at the end.

**Where the facts come from.** Facts come from the pack. You do not cite anything: no source tags, no links, no reference list.
- A *fact* is something specific that could be checked: how a system behaves, a guarantee, a number, who said what. Every fact you state must be something the pack or its saved sources say. Do not add facts from your own knowledge.
- *Teaching* is yours: saying what something is and why it matters, where the explanation is going, how one idea leads to the next, restating the pack's facts in a clearer shape, and an example or analogy that adds no new facts.
- Simplify without making a fact false. If a simplification would be wrong, qualify it ("roughly", "usually") or save the detail for later.

## Steps

### 1. Prepare
Read `topic.json`, `pack/pack.md` and `library/profile.md`. If there is no pack, set `failed` with "no pack to condense" and stop. Print `[studyo] condense: starting`.

### 2. Level
Run `level-check` with the key concepts of the in-scope pack and `scope`. It asks nothing the profile already answers, and at most one batch question. Unattended, it assumes the concepts not in the profile are gaps.

### 3. Plan
Read the in-scope pack content, including the background sections. Then write a short plan to `sources/_work/condense-outline.md`:
- **The thread:** the one question the document answers, and the chain of questions that carries the reader from start to finish. One line on what the opening will say.
- **The order of ideas:** which ideas depend on which, and the order that builds them, not the article's order. List each named thing in the order it will first appear, so nothing is used before it is explained.
- For each part: what the learner already has to hand (from the profile), what is hard about it, and what would make it click. What to skip because they already know it (a one-line reminder at most).
- Where a picture or diagram would carry something better than words.

### 4. Write
Write the whole explanation in one pass, for the reader. Connect to what the learner already knows or cares about where it helps, and answer "why does this matter?" before "how does it work?".

Length follows what the learner needs. For a newcomer it may be much longer than the source, because the source assumed what they lack. For someone who knows the area it may be shorter.

**Style**
- Clear, warm, direct, like a smart friend explaining. No lecture tone.
- Define each term the first time it appears, in plain words, before using it again. No jargon without a definition and no "as you know" for things they do not know.
- One idea per paragraph, at most about four sentences. Keep table cells to a phrase or a short sentence. If a cell needs a paragraph, use prose or a list instead.
- Break text up with whatever helps the reader: a table, a list, a diagram, a picture, a worked example, an analogy. Most parts need only good prose.
- Every heading is a stable navigation point.

**Variety is part of quality.** The devices below are a toolbox to pick from, not a checklist. Use a device only when this particular idea needs it. Never include one just because the last part did, or because it is "usually done".
- A worked example, when walking through steps is the clearest way to see how something works.
- An analogy, when an idea is abstract and a good comparison genuinely helps. Most ideas do not need one. When you use one, say plainly in the text that it is an analogy, make sure it states no fact about the subject that the pack does not, and do not reuse the same analogy twice.
- A diagram (`mermaid`) for relationships or processes the pack describes.
- A picture reused from the pack or saved source assets. Never invent images.
- A table, when comparing things side by side.

**Self-check for sameness before you finish.** Read the headings and first lines of every part together. If several parts open the same way, use the same device, or have the same shape, rewrite them to differ where the ideas allow. If you used an analogy or example in a part, ask whether the part would be clearer without it. If it would, cut it.

### 5. Check the facts
Go through the finished text. Any specific fact the pack does not support: cut it, or rework it into what the pack does say. Check that simplifications did not make a fact false, that numbers and names match the pack, and that figures set side by side measure the same thing. Check that analogies and examples add no facts. Add nothing to the text to show this was done.

### 6. Read it as the learner
Read it start to finish as someone who knows only what the profile says. Fix what fails:
- After the first paragraph, can you say what this is and why it matters?
- Is any name used before it is explained?
- Does every part start from the one before?
- Does any sentence narrate a source, or mention the pack or the profile?
- Does it read as one explanation, or as a list of facts? If the latter, rewrite that part.

If something the learner needs is missing from the pack, do not fill it. Add a short closing note saying what the material does not cover, and suggest running enrich for it.

### 7. Finish
Render if the renderer is available. Update `topic.json` with the new `condensed` resource. Print:
`[studyo] condense: done. <n> sections, <k> items not covered by the pack.`

## Do not

- Do not state facts from outside the pack, even to smooth a gap. Teaching, orientation and examples are yours. Facts are the pack's.
- Do not alter the pack, the ledger or the sources. Only add to `outputs/` and `topic.json`, and update `library/profile.md` through `level-check`.
- Do not write outside the topic folder, except as `level-check` does.
