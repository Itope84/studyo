---
name: quiz
description: Write a quiz for a Studyo topic, chapter or whole course, only when the learner asks. Questions come from the pack and condensed docs, test understanding more than recall, point to the section to reread, and carry the answers, explanations and grading rubrics in a JSON file the app reads. Read-only apart from the quiz file. No web access.
---

# Quiz

Read first: `../_shared/topic-folder.md`, `../_shared/course-folder.md` (for course scope), `../_shared/grounding-and-citations.md`.

Parameters: `topic_path` or `course_path` (the scope), `quiz_id`, `count` (default 8), `focus` (optional: a concept or section), `chapter_ids` (optional, course scope), `interactive: false`. Nobody can answer questions. The learner asked for this quiz, so make it.

## Steps

### 1. Gather the material
- **Topic or chapter:** read `pack/pack.md` and any `outputs/condensed-*.md`. Note each section's heading id (the Reader jumps to it).
- **Course:** read `index.md` and `course.json`. Draw from chapters in `chapter_ids`, else the chapters the learner has finished (a pack item with `done: true` in `topics/<id>/progress.json`), else every chapter that has a pack. For each chosen chapter read its `course.teaches` and skim its pack. Questions should mix chapters and connect them where the material does.
- With `focus`, concentrate there.
If the material is too thin for `count` good questions, write fewer. Never pad.

### 2. Write the questions
- Test whether the learner understood, not whether they can recall a phrase. Prefer "what happens if" and "which of these would break" over "what is the name of".
- Mix: about half `choice` (one right answer, three or four options, plausible wrong answers that reflect real misunderstandings), the rest `short` (a sentence or two), `explain` (explain it in your own words) and `spot_error` (a short statement with one mistake to find, shown in the prompt).
- One concept per question. Spread across sections and chapters. Order from easier to harder.
- Every fact a question rests on must be in the material. Nothing from your own knowledge.
- Each question has: `id` (`q1`, `q2`…), `type`, `prompt` (Markdown, maths as `$…$`), `concept` (short name), `section` (the pack heading id to reread, or null), `chapter_id` (course quizzes), and:
  - `choice`: `options` (`[{"id": "a", "label": "…"}]`), `answer` (the right option id), `explanation` (one or two sentences on why, and why the likeliest wrong option is wrong).
  - others: `rubric` (what a good answer must contain, as a short list in one string) and `explanation` (a model answer in two or three sentences).
- Do not give away answers in other questions' prompts. Randomise which option is right.

### 3. Write the file
Write `quizzes/<quiz_id>.json` (create the folder) in the scope's folder:
```json
{"id": "<quiz_id>", "title": "Short title", "status": "ready", "scope": "<topic id or course--id>", "focus": null, "created": "<ISO>", "questions": [], "attempts": []}
```
Keep `scope`, `focus` and `created` if the file already exists (the server starts it as `generating`); replace `status`, `title` and `questions`. Print `[studyo] quiz: <n> questions`.

## Do not

- Do not use the web or your own knowledge for facts.
- Do not change any other file. Do not schedule or repeat quizzes; the learner asks each time.
