---
name: narrate
description: Turn a Studyo topic's condensed document into a spoken script, to be made into audio by the server. Two hosts (or one narrator) teach the whole document as a lively conversation a listener can follow without seeing anything: nothing the document teaches is dropped, but it is rewritten for the ear, with a hook, an arc, recaps, questions, pauses and tone marked per segment. Facts come from the document only. Runs only when the user asks for audio.
---

# Narrate (spoken script)

Read first, in this order:
`../_shared/topic-folder.md`, `../_shared/grounding-and-citations.md`, `../_shared/teaching-craft.md`.

Runs only when the user asks for audio. Never start on its own. This skill writes the **script**. It never makes audio and never names a voice, a model or a speech engine: the server turns the script into sound with whichever engine it has. Write for the ear, not for any one engine.

**The condensed document already decided what to teach, in what order and at what level.** This skill does not re-decide that. It does not summarise, select or shorten the teaching. Its job is to say all of it, well: as people talking, not as a document read aloud. Complete in coverage, free in expression.

Parameters beyond the shared ones:
- `source_path` (required): the condensed document to narrate, relative to the topic folder (`outputs/condensed-*.md`). If it is missing, or is the pack, set `failed` on `topic.json` with "narrate needs a condensed document" and stop.
- `scope`: `all` (default), or a list of the document's section headings to cover.
- `voices`: `2` (default: a host and a co-host talking it through; see "Two voices") or `1` (one narrator).
- `output_path`: where to write the script, relative to the topic folder. When given, write exactly there and do **not** edit `topic.json`. Without it, write `outputs/audio/narration-<slug>.script.json` (slug: scope plus date) and still leave `topic.json` alone: the server registers the audio when it renders it. Never overwrite another script.

There is no target length, but the script must not balloon. Speech is slower than reading (about 140 words a minute against about 240), so the same words already take longer to hear than to read. Keep the script to **at most 1.15 times the document's word count**. Signposts, questions and recaps fit inside that; if you are over it, the extra is repetition: cut it.

Do not ask the learner questions, whatever `interactive` says. Read `library/profile.md` and `topic.json → learning` only to hear who the listener is; the document already reflects it.

## In a course

If `topic.json` has `course`, this topic is a chapter. Read `course.json` (`course_path`) and the `teaches` of the prerequisite chapters the learner has finished (`done: true` in their `progress.json`). Whatever the document treats as known stays known: touch it in a clause and move on.

## The job

**Two people teach one friend who is listening, not looking.** They cannot scroll back, skim ahead, see a table or reread a sentence. Everything must arrive in order, in words, once, clearly. The aim is that the listener stays with it the whole way and could retell it afterwards.

This is a deep dive, not a recap. It teaches and connects: each idea is explained, shown working, and tied to the one before. It must not sound flat, like a voiceover reading notes.

### What makes it work to the ear

- **A hook.** Open with the question, the surprise or the thing that does not work yet, in one or two sentences. Never a greeting, never "In this episode", never "Let's dive in".
- **A story arc.** One thread from first segment to last, the same thread the document has: a question the listener wants answered, steps that each follow from the one before, an ending that closes it. Say why each step comes next ("so that raises a problem").
- **Say where we are.** The listener has no headings. At each section change give a short signpost ("that's how it breaks. Now, how do we measure it?"). Roughly every few minutes say what has been covered and what is next.
- **Recap in words.** After each major idea, one plain sentence that restates it another way. Before the end, a recap of each thing to keep.
- **One idea per breath.** Sentences of about 8 to 18 words, rarely over 25. Mix short ones in for weight. Three short sentences then a longer one is good; five long ones in a row is not.
- **Spoken words.** Contractions. "So", "now", "here's the thing". Questions to the listener followed by a beat, then the answer. Not slang, not filler, not forced enthusiasm.
- **Concrete first.** The document's own examples carry the teaching: keep them, with their numbers, and tell them as small stories ("say a user has two hundred followers…"). Use the document's analogies (and say they are analogies). Do not add new analogies of your own unless one carries an idea the document leaves abstract, and then it adds no fact about the subject.
- **Name the wrong picture** when the document does, then correct it.
- **Land the key sentence.** Put the word that matters at the end of a short sentence and let a pause follow it. That is how emphasis works when nothing else can mark it.
- **Variety.** If three segments in a row open the same way, rewrite two of them. Do not let the same filler phrase recur.

### What does not go in a script

- **Nothing visual.** No tables, bullets, headings, code blocks, diagrams, formulas, URLs or citations. If the idea lives in one, say it in words. A table becomes "three things differ: …". A formula becomes what it claims, in one plain sentence. A diagram is described by walking along it. Code becomes what it does and what comes out, step by step, never its characters. Do not say "as shown above" or "in the table".
- **No source talk.** Do not mention the document, the guide, the pack, "the source", or where an idea came from.
- **No markup of any kind in the text:** no Markdown, no asterisks, no brackets, no emoji, no stage directions in the text (those go in the fields).
- **Write what should be said.** Spell out what a speech engine would get wrong: numbers as spoken ("about twelve percent", "two to the power of ten", "ninety-ninth percentile"), symbols as words, acronyms as they are said (spell letters with hyphens: "S-S-D"; write the word if it is said as one: "RAM"), abbreviations expanded, a hyphenated reading for odd names. Keep a name the same every time it appears.
- **No long lists.** At most three items said in a row; beyond that, group them, or walk through them as a story.

### Where the facts come from

Every fact (a number, a behaviour, a guarantee, who did what) must be in the document. Teaching is yours: how a thing is said, the questions between the speakers, the small stories that carry the document's examples. A basic general definition is allowed, a sentence or two, with nothing specific to the subject. Add no arithmetic, estimate, example number or claim of your own. Simplify without making anything false; qualify where needed ("roughly", "usually"). No citations are spoken or written.

### Predict-then-reveal checks

The document has them. In a script they become the best moments: the question is asked, the listener gets a beat to think (`pause_after: long`), then the answer and its reasoning come. With two voices the co-host guesses aloud, sometimes wrong, and the host confirms or corrects with the reasoning from the document. Keep the document's own question, numbers and answer.

### The reference box and the closing note

A reference box (limits, options, lookup material) is spoken as one short passage that says what is in it and names each item, because lookups are not for listening and the page holds the detail. Do not read tables of numbers digit by digit. If the document ends with a note on what it does not cover, say it as the last lines.

## Two voices

With `voices: 2` the script is a conversation, as in a podcast. It must teach better than one voice would, not just sound livelier.

- **Roles.** `host` knows the material and leads: explains, builds the thread, lands the recaps. `cohost` is the listener's stand-in: asks what a curious person who does not know this would ask, at the moment they would ask it; tries an idea back in their own words; names the tempting wrong picture and gets it corrected; says when something has not landed yet. The host speaks about 75 to 80% of the words; the co-host's turns are short.
- **Do not echo.** A co-host turn that only repeats what the host just said ("So X, and Y") is padding, and it is the main way a script grows too long. Restate only when the idea is hard and the listener may have lost it, and then at most one co-host turn in four. Most co-host turns should be a real question, a guess, an objection or a link to an earlier idea, in one or two sentences.
- **A question has to earn its place.** Each co-host turn does one of: asks the next thing the listener is wondering, restates an idea in other words so the host can confirm or sharpen it, raises a doubt or objection the material answers, or ties two ideas together. No praise ("great point", "that's fascinating"), no reaction for its own sake, no laughing, no filler.
- **Turns are short.** One to three sentences. A host turn may run to four short sentences when explaining. Consecutive segments by the same speaker are fine.
- **Facts stay with the document, for both.** A co-host restatement must be true to the document, and a deliberately wrong guess must be corrected in the next host turn. Neither speaker's analogy may imply anything false about the subject.
- **No names, no greetings.** Neither speaker names themselves or the other, introduces a show, or signs off. Open on the hook.
- **Do not make them agree about everything.** A real objection that gets answered is better than constant "right, exactly".
- **The format fields work as before.** `pause_after` is `short` between turns by default, `none` for a quick interjection, `medium` or `long` at the same moments as with one voice.

With `voices: 1`, one `narrator` does all of this alone: the co-host's questions become questions to the listener ("so why would that matter?"), followed by a beat.

## Parts

Write the script in **parts**: groups of whole sections of about 1,000 to 1,500 words of script each, which is about 8 to 11 minutes spoken. Break only at section boundaries. Every part after the first opens with one short recap of where we are and what the last part ended on, then goes on. The server may play the parts as one episode or as separate ones, so each part must make sense on its own after its recap.

## Steps

### 1. Prepare
Read `topic.json`, the document in scope, and `library/profile.md`. Print `[studyo] narrate: starting`.

### 2. Coverage map
Write `sources/_work/narrate-coverage.md`. List, in the document's order, everything that must be said, as short lines: every section; every concept it teaches; every example with its numbers; every named analogy, wrong picture and trap; every predict-then-reveal check; each item in the reference box; the closing note. Mark where each part begins. This is the list the script is checked against.

### 3. Plan
Under the coverage map, plan the arc: the one question the whole thing answers, how each part opens (its recap) and ends, which co-host question or objection goes at which point, and where the checks fall.

### 4. Write
Write the script as JSON in the format below, **one part at a time**. Create the file with the header and the first part, ending with the closing lines `  ]` and `}` on their own lines. For each next part, insert its segments before those closing lines using a file edit. Do not try to write the whole script in one call, and do not write helper scripts.

### 5. Check
- **Coverage:** go through `narrate-coverage.md` line by line against the script. Anything missing: add it where it belongs. Nothing may be missing, except what truly cannot be said in words (a long listing of code, a large table of figures). Record such items in `skipped` with a reason; a skipped item must be described in a sentence, not dropped silently.
- **Facts:** every number, name and claim in the script is in the document, unchanged. Anything the document does not say: cut it or rework it to what it does say. Check that no simplification made a fact false, that a speaker's guess is corrected, and that no analogy implies a falsehood.
- **For the ear:** read each segment as if speaking it. Any sentence you would trip over, split. Anywhere the listener must hold three new things at once, slow down. Anything that needs seeing, rewrite in words.
- **Format:** the rules under "Format" hold: the JSON parses, every segment has the required fields, no text contains Markdown characters, `[`, `]`, URLs or symbol formulas you would not say.
- **Not flat:** read the first line of ten segments in a row. If they sound like notes being read, the hook, the questions and the stories are missing; fix that before finishing.

### 6. Finish
Print `[studyo] narrate: done. <p> parts, <n> segments, <w> words, about <m> minutes, <c> of <t> coverage items, <k> skipped.` (`c` must equal `t` unless something is listed in `skipped`.)

## Format

One JSON file. Plain, flat, engine-neutral.

```json
{
  "version": 1,
  "title": "Why logs make writes fast",
  "voices": 2,
  "minutes": 36.4,
  "words": 5100,
  "source_path": "outputs/condensed-all-2026-10-04.md",
  "parts": [
    {"n": 1, "title": "What can go wrong"},
    {"n": 2, "title": "Measuring load"}
  ],
  "skipped": [],
  "segments": [
    {
      "id": "s1",
      "part": 1,
      "speaker": "cohost",
      "text": "Here's a puzzle. A database can take hundreds of thousands of writes a second, on a spinning disk that can barely do a hundred. How?",
      "tone": "curious",
      "pace": "normal",
      "pause_after": "medium",
      "emphasis": ["How"]
    }
  ]
}
```

Rules for the fields:
- `part`: the part number the segment belongs to. Parts are in order. Each `parts` entry has a short plain title (what the part is about, as a phrase).
- `skipped`: list of `{"item": ..., "reason": ...}`; empty when nothing was skipped.
- `speaker`: `"narrator"` when `voices` is 1; `"host"` or `"cohost"` when `voices` is 2. Which actual voice each one gets is the server's business; do not describe, name or gender them in the script.
- `text`: what is said, as plain text, one to four sentences, **at most 350 characters**. Split a longer thought into more segments. Start a new segment where a person would take a breath or a beat, and where tone or pace changes.
- `tone`: exactly one of `warm`, `curious`, `serious`, `playful`, `surprised`, `reflective`, `emphatic`, `neutral`. Choose by what the moment is doing (a puzzle is `curious`, a pitfall `serious`, a punchline `emphatic`). Use `neutral` for plain explanation. Do not change tone every segment.
- `pace`: `slow`, `normal` or `fast`. `normal` unless a moment needs room (`slow` for the key sentence, a number, a definition) or a quick aside (`fast`, rarely).
- `pause_after`: `none`, `short`, `medium` or `long`. `short` between turns of one thought; `medium` between thoughts and after a question the listener should think about; `long` before a reveal, at a change of section and after a key point. Never a pause only for effect.
- `emphasis`: optional list of up to two words from the segment's text the speaker should lean on. Only where a word carries the meaning. Engines may ignore it, so the sentence must still work without it.
- `id`: `s1`, `s2`, … in order, unique.
- Top level: `voices` is the number you wrote for. `words` is the total word count of all `text` fields. `minutes` is the actual length (`words / 140`, one decimal).

## Do not

- Do not drop, merge away or shorten what the document teaches. Complete coverage is the point of this skill.
- Do not add facts the document does not state, even to smooth a gap.
- Do not read the document aloud, section by section. Rebuild it as talk.
- Do not use any text a speech engine cannot say: markup, code, tables, URLs, citations, stage directions inside `text`.
- Do not mention a voice, an engine, a model or audio settings in the script.
- Do not edit the document, the pack, the ledger or the sources. Write only the script and `sources/_work/`.
- Do not write outside the topic folder: no helper scripts in `/tmp` or elsewhere. Count words and check lengths by hand.
- Do not pad. Length that comes from a recap or a question is fine; length that repeats is not.
