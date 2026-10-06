# Studyo skills

Plain-file skills that run the same from Claude Code, OpenCode or the job runner. Each skill is a folder with a `SKILL.md` (only `name` and `description` in the frontmatter, so both CLIs load it). Shared rules live in `_shared/` and are referenced by relative path, so keep the folder together.

| Skill | When | Depth |
| --- | --- | --- |
| `level-check` | Called by the others. Keeps `library/profile.md` (the person) and `topic.json → learning` (this topic's goal and gaps). | One batch question at most, skipped when the profile already answers |
| `enrich-document` | Topic started from a link or PDF | Standard, bounded |
| `enrich-topic` | Topic started from a name | Standard, bounded. Finds an anchor source, then follows `enrich-document` |
| `enrich-deep` | Only when the user asks, on a topic with a pack | Deep, large budget, verification and counter-review |
| `condense` | Only when the user asks | Teaches the pack's material at the learner's level; facts from the pack, explanation is its own |
| `narrate` | Only when the user asks for audio | Turns a condensed document into a spoken script (JSON, two hosts or one narrator), complete in coverage and written for the ear, in parts; the server turns it into sound |
| `answer` | Chat in a topic, chapter or course | Read-only, no web. Rework planned |
| `course-outline` | Course from a PDF or link | Structure only, never the whole book. Asks to approve the outline, then what you know |
| `course-plan` | Course from a subject name | Finds a spine (syllabus, textbook), then `course-outline` |
| `enrich-chapter` | Build one course chapter, or the Prelim | Like `enrich-document` on the chapter's slice, minus what earlier chapters teach |
| `quiz`, `quiz-grade` | Only when the learner asks | Questions from the pack, free-text grading against a rubric |
| `assignment`, `assignment-review` | Only when the learner asks | Take-home from optional context; review reads, never runs, submissions |

The stopping rule for enrichment is sufficiency, not a section count. `_shared/limits.md` holds only cost ceilings.

Courses: `course-outline` (or `course-plan` first) writes `courses/<id>/course.json`; chapters are then built one at a time with `enrich-chapter`. See `_shared/course-folder.md`.

Typical flow for a topic: `enrich-document` or `enrich-topic` → (optional) `enrich-deep` → (optional) `condense`. `answer` works at any point after a pack exists. All budgets are in `_shared/limits.md`.

## Install

Both CLIs read `.claude/skills/`. Point the library's project directory at this folder, so one copy serves both:

```
ln -s /path/to/studyo/skills <library>/.claude/skills
```

Search and fetch use each CLI's own tools, and the skills name none. OpenCode's search tool needs `OPENCODE_ENABLE_EXA=1` or `OPENCODE_ENABLE_PARALLEL=1` (or the OpenCode provider) set on the server. Check this before the first run.

Tool permissions (what each skill may read, write and run) belong in the CLI adapter, not in the skills. See "unattended safety" in `docs/decisions-and-backlog.md`.

## Borrowed from

Studied in full, then reduced to what Studyo needs. The copies are kept in `_reference/` for comparison.

- `daymade/claude-code-skills`, `deep-research`: source ledger, claim ledger, "never invent URLs; reopen the original for load-bearing claims", the `official`/`academic`/`secondary-industry`/`journalism`/`community` labels, independent evidence vs repeated copies, counter-review, confidence markers. Used in `source-ledger.md`, `enrich-deep`.
- `199-biotechnologies/claude-deep-research-skill`: depth tiers with budgets, persisted citations, validate-then-fix loop, Markdown as source of truth with HTML and PDF rendered from it. Used in `limits.md`, the verify steps and `render-contract.md`.
- `zarazhangrui/codebase-to-course`: engagement principles (start concrete, show don't tell, short blocks, define terms at first use, non-repeating metaphors) and the idea of a fixed design system kept apart from content. Used in `condense` and `render-contract.md`. Its HTML templates were not copied, because Studyo renders from Markdown.

## Not built yet

- The renderer (`render-contract.md` is its spec).
- A helper for editing `topic.json` safely.
- Quote-check script. For now, the skills run the check with plain text search.
- The CLI adapter and job runner that supply `topic_path` and `interactive`.
