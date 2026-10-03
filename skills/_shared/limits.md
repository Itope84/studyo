# Limits (tune here)

The real stopping rule is **sufficiency**, not a count: add what a reader with this learner's profile needs to follow the document, and stop. Nothing here caps how many background sections that takes.

The numbers below are cost ceilings, a safety net against runaway runs. They are first guesses and not measured. Revisit after real runs, and raise them if good topics keep hitting them.

A **search** is one query. An **open** is one page or PDF fetched and read in full, not a search snippet.

| | `enrich-document` | `enrich-topic` | `enrich-deep` |
| --- | --- | --- | --- |
| Searches | 15 | 20 | 40 |
| Opens (the original excluded) | 15 | 20 | 40 |
| Subagents | none | none | up to 3 in parallel, only if the CLI supports them |
| Quote and figure verification | every direct quote | every direct quote | every direct quote, figure and date |
| Counter-review pass | no | no | yes |

`enrich-topic` extra: one anchor source in full, plus other primary sources as excerpts where they help.

## Rules

- **Sufficiency decides, ceilings protect.** Work through the needed concepts in order of how much each blocks understanding. Stop when the learner could follow the original, or when a ceiling is reached.
- **If a ceiling is reached,** finish with what you have. List what is still unexplained in Gaps, most important first, so the user can see exactly what is missing and ask for more. Never go over a ceiling to fill a gap.
- **No rabbit holes.** Only add background for concepts covered by the learner's question in `level-check`. Do not discover new layers of prerequisites mid-run and chase them.
- Print a progress line after each phase: `[studyo] <phase>: <what happened>`. The job runner shows these lines in the app, and they keep partial work usable if the run is cut off.
- Wall-clock time, turn count and spend are enforced by the CLI adapter, not by these skills. If a run is killed, the topic folder must still be consistent: write the ledger as you go, not at the end.
