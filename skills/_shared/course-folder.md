# Course folder

A **course** is a path of chapters over one or more central resources (a book, a syllabus). Skills that work on a whole course use this contract. Chapters are ordinary topic folders (see `topic-folder.md`), so everything that works on a topic works on a chapter.

```
courses/<course>/
  course.json            the manifest (below)
  index.md               the course map: one short paragraph per chapter, written by course-outline
  sources/
    S1-<slug>.pdf|md     central resources (the book, a syllabus, a saved spine page)
    ledger.jsonl         see source-ledger.md. Chapters cite these as the same S<n>
    _work/               scratch
  chat/                  written by the server (the course-level thread)
  quizzes/               cumulative course quizzes, see quiz skill
  _job/                  question files, as for topics

topics/<chapter-id>/     one topic folder per chapter, made by the server from course.json
```

Courses live in `courses/` next to `topics/` at the library root. A skill working on a course writes only inside its course folder (and `library/profile.md` through `level-check`). A skill working on a chapter writes only inside the chapter's topic folder, and **reads** the course folder and earlier chapters.

## course.json

Read the whole file, change it, write the whole file back.

```json
{
  "id": "ddia",
  "title": "Designing Data-Intensive Applications",
  "goal": "Design storage and replication for a service I'm building",
  "status": "planning",
  "origin": {"type": "pdf", "file": "sources/S1-ddia.pdf"},
  "summary": "One sentence on what the course covers.",
  "learning": {"goal": "...", "gaps": ["..."], "updated": "2026-10-03"},
  "chapters": [
    {
      "id": "ddia-01-reliable-scalable",
      "title": "Reliable, Scalable, Maintainable Applications",
      "kind": "chapter",
      "order": 1,
      "summary": "What the three properties mean and how to measure them.",
      "prereqs": [],
      "teaches": ["reliability", "scalability", "percentile latency"],
      "assumes": ["client-server architecture"],
      "source_range": {"source": "sources/S1-ddia.pdf", "label": "pp. 3 to 28", "from": 3, "to": 28}
    }
  ],
  "created": "...",
  "updated": "..."
}
```

- `status`: `planning` while the outline job runs, `ready` when it finishes, `failed` with `failure_reason` (one plain sentence) when it cannot continue. Never leave `planning` when you exit, except when you end your turn to ask a question.
- Chapter `id` is the chapter's topic id: `<course id>-<order, two digits>-<slug of the title, at most 30 characters>`. The Prelim is `<course id>-prelim`, `kind: "prelim"`, `order: 0`. Ids are lowercase letters, digits and dashes. Never change an id once the outline is approved.
- `prereqs`: ids of chapters that must be understood first. Direct dependencies only. They advise; nothing is locked. No cycles.
- `teaches`: 3 to 8 concepts this chapter explains, as short noun phrases. These feed the person profile when the chapter is marked done, and later quizzes, so make them specific.
- `assumes`: concepts the chapter takes for granted that it does not teach.
- `source_range`: where the chapter's material is. `source` is a path under the course folder, a URL, or `null` when the chapter has no single source (a web spine: say where to look in `label`). `from` and `to` are PDF page numbers (the PDF's own page index from 1, not the printed number) or null.
- `index.md`: a heading per chapter in order, then two or three sentences on what it covers, what it teaches and what it builds on. This is what course chat reads instead of everything. Keep it under about 1,500 words.

## Job parameters

Same as for topics, with `course_path` (absolute path to the course folder) in place of `topic_path` for course-level skills. Chapter-level skills get both `topic_path` (the chapter) and `course_path`.
