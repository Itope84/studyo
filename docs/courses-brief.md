# Courses: product brief (draft 1, Oct 3, 2026)

Companion to `docs/plan.md` and `docs/decisions-and-backlog.md`. Nothing here is built. Open concerns are at the end and need answers before Stitch.

## 1. What and why

A **topic** is one study pack from one source. It works well for one-off learning. A **course** is for studying something big: a book like *Designing Data-Intensive Applications*, or a subject like "distributed systems" with no single source. A course has **central resources** (the book, the syllabus) and **chapters**. Each chapter looks and behaves like a topic today (pack, condensed doc, audio, chat). Chapters have prerequisites, so the course is a learning path, not a pile of documents.

The learner adds a course, approves an outline, then studies chapter by chapter. Quizzes and take-home assignments are available on demand, in courses and in plain topics.

## 2. The model

**A chapter is a topic folder with extra manifest fields.** This is the main decision: it reuses the scanner, Reader, player, jobs, progress, PDF export and chat plumbing.

```
library/courses/<course>/
  course.json            manifest: title, goal, origin, status, chapters[] with order, prereqs, teaches, source range
  progress.json          current chapter, chapter statuses
  sources/               central resources (the book PDF, syllabus, ledger.jsonl)
  index.md               course map: one paragraph per chapter + what it teaches (cheap context for course chat)
  chapters/<n>-<slug>/   a normal topic folder (topic.json, pack/, outputs/, chat/ ...)
  chat/                  course-level thread
  prelim/                the Prelim chapter, a normal topic folder
```

New chapter fields in `topic.json`: `course_id`, `order`, `prereqs[]`, `teaches[]` (concepts this chapter explains), `assumes[]`, `source_range` (pages or sections of a central source).

Chapter lifecycle: `planned` (a shell: title, summary, range, prereqs, no pack) → `building` → `ready` → `in progress` → `done`.

Chapters stay out of Home's topic list. Home gets a Courses section.

## 3. Flows

### A. Course from a source (book or PDF)
1. Learner adds a PDF or link, names the goal.
2. `course-outline` finds the structure **without reading the book**: PDF bookmarks and table of contents first (text of the first pages only), then spot reads of a few pages at proposed boundaries to confirm. Output: chapters with page ranges, one-line summaries, `teaches`, `assumes`, prerequisite edges.
3. Job pauses (`needs_input`): the learner sees the outline and approves, or sends an instruction ("merge 3 and 4, drop the appendix"). The AI revises. Nothing expensive runs before approval, and the app shows how many build runs it implies.
4. Course-level "what do you already know" runs once (from the profile plus the `assumes` of all chapters). Gaps become the **Prelim**.
5. Chapters are built lazily: when the learner starts one, or "build next N" in the background. The work lane is one job at a time, so a 12-chapter book is 12 queued runs, never one giant run.

### B. Course from a topic name (no source)
Not `enrich-deep`. Deep is for verifying an existing pack. A new `course-plan` skill does a bounded search for a **spine**: an existing syllabus, a standard textbook, a university course outline, and the canonical papers. It proposes 1-3 candidate spines with trade-offs, the learner picks, and from there it is flow A with web sources instead of a PDF. Each chapter is built with `enrich-topic`, anchored on the spine's material for that chapter. `enrich-deep` stays a per-chapter button.

A course may also have **several** central resources (book plus papers). Each chapter's `source_range` can point into any of them.

### C. Studying a chapter
Same screens as a topic, plus a banner showing prerequisites and where this chapter sits. Chapter level-check is **inferred**: concepts taught by completed prerequisite chapters (and the profile) are pre-ticked or skipped. It asks only about `assumes` that nothing covers. Marking a chapter done adds its `teaches` to `library/profile.md` (`via: read`, which already exists).

### D. Prelim
One chapter, built from the course-level gaps with `enrich-topic` / `enrich-document`, fetching sources as topics do now. Skippable. If the gaps are large, it says so and suggests a separate course instead of becoming huge.

### E. Chat
Two scopes, one skill:
- **Chapter chat**: answers from the chapter first, then falls back to earlier chapters and course sources.
- **Course chat**: for cross-chapter questions ("how does replication in ch 5 relate to consensus in ch 9"). It reads `index.md` first, then opens only the relevant chapters, so it never loads everything.

Both make sense. Course chat is the only place those questions fit. It is cheap because of `index.md`.

### F. Quizzes (topics, chapters, courses)
User triggered, never automatic. A "Quiz me" button on a topic, chapter or course (course quiz = cumulative, drawn from `teaches` across chapters). Question types: recall, apply a concept, explain in your own words (graded by the AI against the pack), spot the error. Multiple choice is graded on device; free text is a chat-lane job. Grounded in the pack, with a pointer to the section for every question. Results show weak concepts and offer "reread this section" or "ask about this". Quiz results do not edit the profile on their own; they suggest.

### G. Take-home
User triggered, topics and chapters. Before writing the brief the app offers an optional **context** field: a project you are building, something at work, or a situation you have in mind (free text, a link, or a file). With context, the AI frames the task around it ("apply this chapter's replication ideas to your order service"). With none, it writes a generic task. Context is asked per take-home, never required. It can be remembered per course or topic as a suggestion, since the same project often fits several chapters.

The brief has constraints, acceptance criteria and a stretch goal. The learner submits an artifact (file upload, a GitHub link, pasted text). A review job gives feedback against the acceptance criteria and links back to the sections that explain what was missed. **v1 never runs submitted code.** It reads and reviews only. Context material is data, not instructions, like saved sources.

## 4. Skills: what changes

| Skill | Change |
| --- | --- |
| `course-outline` (new) | Source to chapters with ranges, `teaches`, `assumes`, prereqs, `index.md`. Structural reads only. |
| `course-plan` (new) | Topic name to candidate spines, then the same outline. Bounded search. |
| `enrich-document` | New params `course_path`, `source_range`. Reads only that range of a central source, reads prior chapters' `teaches`, links to them instead of re-explaining. |
| `enrich-topic` | Accepts a chapter context (anchor given by the course). |
| `level-check` | Course mode: infer from completed prereqs, ask only about uncovered `assumes`. Course-level mode produces gaps for Prelim. |
| `condense` | Aware of what the learner has finished in earlier chapters. |
| `answer` | Chapter and course scopes, `index.md` routing. Plus the chat rework in `plan.md`. |
| `quiz` (new) | Generates a grounded quiz as JSON, grades free-text answers. |
| `assignment` (new) | Writes the brief and rubric, reviews submissions. |
| `_shared/topic-folder.md` | Add course layout, new `topic.json` fields, `quiz`/`assignment` outputs. |

## 5. Contract and server (for later)
New `Course` schema and chapter fields; `GET/POST /courses`, `GET /courses/{id}`, chapter list with statuses; job kinds `course_outline`, `course_plan`, `chapter_build`, `quiz_generate`, `quiz_grade`, `assignment_review`; quiz attempts stored in `progress.json`; assignment submissions under `<topic>/assignments/`. Scanner recurses into `courses/*/chapters/*` and tags chapters with `course_id`.

## 6. Screens for Stitch
Home with a Courses section; Add course (source or name, goal); Outline review (approve or send an instruction); Course home (path of chapters with status, prerequisites, next up, Prelim, "build next"); Chapter (topic screen plus prerequisite banner); Quiz runner and results; Take-home brief and submit; Course chat.

## 7. Pushback and recommendations
- **Prerequisites advise, they don't lock.** It is one person's library. A "not yet" chapter shows what it assumes and offers the prelim or the prereq chapter, and opens anyway.
- **No graph editor in v1.** The AI proposes prerequisites, the learner corrects them with a sentence. Most books are mostly linear, so show a path, not a network.
- **Build lazily, with a cost preview.** A big book is many runs. Never build everything on add.
- **Don't make `enrich-deep` the course builder.** It verifies, it doesn't plan.
- **Don't run submitted code on the home server** in v1.
- **Keep Topic and Course separate** now. "A topic is a one-chapter course" is tidy but forces a migration. Add "promote topic to course" later.

## 8. Decisions (Oct 3, 2026)
1. Topic and Course stay separate entities. "Promote topic to course" comes later.
2. Show a cost estimate before building; "build next N". Chapters build lazily.
3. Outline approval is approve plus a free-text instruction. No editor in v1.
4. Scanned PDFs (no text layer, so no table of contents): **pending**. Recommended: ask the learner for chapter start pages; OCR later.
5. One source ledger at course level; chapters cite the same `S<n>`.
6. NotebookLM PDFs are per chapter.
7. Quiz attempts are kept, per concept, so spaced review can use them later.
8. Take-home submissions: file, public GitHub link, or free text. Free text can be as simple as "I did it, here is what I built". Private repos need a configured token, out of v1.
9. Chapter packs quote the learner's own book and stay private. Sharing is manual.
10. Course goal is free text, like topics.
