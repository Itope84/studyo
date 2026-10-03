# Topic folder

The contract between skills, server and app. Skills work inside **one topic folder** and write nowhere else, with one exception: `level-check` updates `library/profile.md` (the person profile, kept at the library root next to `topics/`). Never read or write outside it, except to read these shared files.

```
<topic>/
  topic.json
  progress.json            do not touch: the app writes it
  runs.jsonl               one line per enrich run, see run-log.md
  sources/
    ledger.jsonl           see source-ledger.md
    S1-<slug>.md|.pdf      originals and saved sources, with S<n>-assets/
    _work/                 scratch notes for a run; not part of the topic
  pack/
    pack.md                the pack (source of truth)
    pack.html              rendered from pack.md by the renderer
    assets/                images used by the pack
    pack.prev.md           backup made before enrich-deep rewrites the pack
  outputs/
    condensed-<slug>.md    condensed docs (source of truth)
    condensed-<slug>.html  rendered
    assets/
  chat/                    written by the server, not by skills
  quizzes/<id>.json        written by the quiz skill, on request (see skills/quiz)
  assignments/<id>/        take-home work: assignment.json, context/, submissions/, reviews/ (see skills/assignment)
  _job/                    written by the job runner and by skills asking questions (see below)
```

The library root also holds `_studyo/` (server state: jobs, events, shared renderer assets). Skills never touch it.

Folders and files starting with `_` are scratch. Auto-discovery and the app must ignore them.

## topic.json

Skills read it first and update it when they finish. Edit by reading the whole file, changing it and writing the whole file back. Never leave `status` as `enriching` when you exit.

- `status`: set `ready` on success. On an unrecoverable failure set `failed` and add `failure_reason` (one plain sentence), and print `[studyo] FAILED: <reason>`.
- `resources`: add or update an entry for each file you produce, with `id`, `type` (`source` | `pack` | `condensed`), `title`, `path` (relative to the topic folder), `made_with` (the CLI and model name if known), `size`, `added`.
- Add the `pack.html` and `condensed-*.html` files as the same resource as their `.md` source. They are renderings, not separate resources.
- `course`: present when this topic is a chapter of a course (`course_id`, `kind`, `order`, `prereqs`, `teaches`, `assumes`, `source_range`, `summary`). Owned by the server and the course skills. Chapter skills read it and never change it. See `course-folder.md`.
- `learning`: `{goal, gaps, updated}`, written by `level-check`. Gaps are the concepts to explain for this topic.
- `summary`: one plain sentence on what the topic is about, written by the enrich skills when they finish (for example "How log-structured storage engines trade read speed for fast writes."). The app shows it under the title.
- `updated`: now, ISO 8601.
- Do not change `id`, `origin` or `session_id`.

## Job parameters

The job runner (or you, by hand) gives each skill these. Read them from the prompt.

- `topic_path` (required for topic and chapter skills): absolute path to the topic folder.
- `course_path`: absolute path to the course folder, for course skills and for chapter skills. See `course-folder.md`.
- `interactive`: how a person can answer questions during the run.
  - `true` (default when run by hand): ask in the conversation.
  - `app`: the job runner relays questions to the Studyo app. See "Asking through the app" below.
  - `false`: nobody can answer. Never wait. Each skill says what to assume instead.
- Skill-specific parameters are listed in each skill (`anchor`, `scope`, `focus`).

## Asking the learner

When `interactive` is `true`, ask with the CLI's own question tool if it has one, otherwise in plain text. When it is `false`, never wait for an answer. Each skill says what to do instead.

### Asking through the app (`interactive: app`)

Nobody is watching the terminal. Do not use a question tool and do not ask in plain text. Instead:

1. Write `_job/questions.json` in the topic folder (create `_job/` if needed):

```json
{
  "id": "level-1",
  "title": "Before I build your pack",
  "intro": "One quick question so the pack starts at the right level.",
  "questions": [
    {
      "id": "known",
      "kind": "multi",
      "label": "Which of these do you already understand? I've ticked the ones your profile suggests.",
      "options": [
        {"id": "hash-functions", "label": "Hash functions", "group": "Concepts the material uses", "checked": false},
        {"id": "tls", "label": "TLS", "group": "What they build on", "checked": true, "note": "In your profile"}
      ]
    },
    {"id": "goal", "kind": "text", "label": "What do you want to be able to do or understand when you're done?", "placeholder": "One line"}
  ]
}
```

   `kind` is `multi` (tick any), `single` (pick one) or `text`. Option ids are short slugs. Use `group` to show headings, `checked` to pre-tick, `note` for a few words of why. Give each question set a new `id`.

2. Save anything you will need afterwards (your concept list, what step you are on) in `sources/_work/`, because the conversation is resumed later, possibly after hours.
3. Print `[studyo] NEEDS_INPUT` on its own line and **end your turn**. Leave `status` as `enriching`; this is the one case where you may exit with it.
4. The job runner resumes this same session with a message that starts `[studyo] ANSWERS` followed by the answers as JSON (`{"question_set_id": ..., "answers": {"known": {"selected": [...]}, "goal": {"text": "..."}}}`). Delete `_job/questions.json`, then continue from the step you stopped at.

If the answers are empty or say "skip", carry on as if `interactive` were `false`.
