---
name: level-check
description: Work out what the learner already understands about a topic, using one batch question and the person profile in the Studyo library (library/profile.md), and record the topic's goal and gaps. Asks once, shows the concepts the material needs and what they build on, pre-ticks what the profile already implies, and skips questions the profile can answer. Used by enrich-document, enrich-topic and condense.
---

# Level check

Read first: `../_shared/topic-folder.md`.

Two things come out of this skill:
1. **`library/profile.md`**: what we know about this person across all topics. Updated, never rebuilt.
2. **`topic.json` → `learning`**: this topic's `goal` and `gaps` (the concepts to explain).

The aim is to ask as little as possible: **at most one batch question** plus an optional goal line, and none when the profile already answers it.

## Inputs

- `topic_path`, `interactive` (see topic-folder.md). The library root is the parent of `topics/`; the profile is `<library>/profile.md`.
- `terms`: the key concepts the material uses or assumes, chosen by the calling skill. For `enrich-topic` before an anchor exists, this may be empty.
- `scope` (optional): when called by `condense`, the part of the topic covered.

## Profile file

`library/profile.md` has a YAML front matter that the app can read and write, and a free-text body for everything else.

```markdown
---
knows:
  - term: certificate authority
    via: self-reported        # self-reported | inferred | read
    topic: pc-ca-mcts         # topic id, or omit
    date: 2026-10-03
  - term: TLS
    via: self-reported
    date: 2026-10-03
---

# About this person

Free text: background, role, how they like things explained, what to avoid. Written from what they have said, not guessed.
```

- `via: read` is added by the app later when a topic is marked read. Treat it as known.
- Only record what the person said or confirmed, or an app event. Never record your own guess.
- An entry is never deleted by a skill. If the person says they do not know something they were recorded as knowing, change it to a `forgot` entry or remove it on their say-so.

## Steps

1. **Build the concept list.** From `terms`, add what each one builds on: the things a person would need to understand first. Go **two layers down at most**. Use judgment from reading the material. Stop there, and do not add layers below it. Group the list as "concepts the material uses" and "what they build on".

2. **Apply the profile.** Mark each concept as known if it is in `knows` (any `via`), or **presumed known** if a known entry or the profile body clearly implies it. Presumed known examples: someone who knows how TLS works probably knows what a hash is; a software engineer probably knows what an API is. Judge conservatively. A wrong presumption is worse than an extra tick.

3. **Decide whether to ask.**
   - Everything is known or presumed known: skip to step 5.
   - `interactive` is false: do not wait. Treat known and presumed-known as known, and every other concept as a gap. Print `[studyo] level-check: unattended, <n> gaps assumed`. Skip to step 5. (This is a stopgap until the job runner can pause for input.)

4. **Ask once.** With `interactive: app`, ask through the app as described in `topic-folder.md` ("Asking through the app"): one `multi` question listing the concepts (grouped, pre-ticked, with notes), plus a `text` question for the goal if there is none, then end your turn and continue at step 5 when the answers arrive. Otherwise, one question, one list, grouped as in step 1:
   "Which of these do you already understand? I've ticked the ones your profile suggests."
   - Pre-tick the known and presumed-known ones, and say why in a few words for the presumed ones.
   - Accept "all", "none", ticks, or free text such as "I'm a software engineer, skip the basics".
   - Do not ask follow-up probes or quiz the person. Do not ask about the topic's facts. If their answer is vague, take the more cautious reading.
   - Ask for the goal in the same message if `topic.json` has none: "What do you want to be able to do or understand when you're done?" One line.

5. **Record.**
   - Add every concept the person confirmed (ticked, or accepted as presumed) to `knows` in `library/profile.md` with `via: self-reported` and today's date, and add what you learned about them to the body. Presumed concepts they accepted count as confirmed. Unticked ones are not recorded, since "doesn't know it" is just the absence of an entry.
   - Write `learning` in `topic.json`: `{"goal": "...", "gaps": ["..."], "updated": "YYYY-MM-DD"}`. `gaps` are the concepts not known, ordered by how much they block understanding, with a short note on what each builds on.
   - Print `[studyo] level-check: <n> known, <m> gaps`.

## Course modes

Two extra modes for courses (see `../_shared/course-folder.md`). Everything above applies unless this section changes it.

**Course mode** (called by `course-outline`, with `course_path`): `terms` is the union of the chapters' `assumes`. The goal is the course `goal`. In step 5 write `learning` (`goal`, `gaps`, `updated`) into `course.json`, not into a topic. The gaps become the Prelim. Ask in the same single batch question, and keep it short: group by "the course assumes", skip anything the profile covers.

**Chapter mode** (called by `enrich-chapter`, with `course_path` and a chapter): `terms` is the chapter's `assumes`. Before applying the profile, treat as known every concept in the `teaches` of a prerequisite chapter the learner has finished (a pack item with `done: true` in that chapter's `progress.json`), and as presumed known those taught by an unfinished prerequisite only if the profile also implies them. Ask only about what is left. Most of the time nothing is left, so ask nothing. Record answers in the profile and `learning` in the chapter's `topic.json` as usual. Never ask about the course goal again.

## Rules

- Never ask about the same concept twice across topics: the profile is the memory.
- Never put your own knowledge of the topic into the profile. It records the person.
- Plain words. No scoring or level labels in the questions.
- This skill writes two things outside the topic folder's usual scope: `library/profile.md` and nothing else. Do not touch any other library file.
