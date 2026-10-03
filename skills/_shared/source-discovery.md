# Source discovery

How to find good sources with the search and fetch tools your CLI provides. Use whatever it has. If it has no way to search or fetch, stop and mark the job failed with that reason.

This file deliberately names no sites or venues. Where to look depends on the field. Work out where that field's authoritative material lives instead of defaulting to one place.

## Method

1. **Start with what you already have.** For a document, its own reference list, inline links and citations are the first leads. Follow them backward to the originals.
2. **Learn the vocabulary.** One or two broad searches in plain language show the terms the field uses. Use those terms in later queries.
3. **Ask where this field's authorities publish.** Decide what an original source looks like for this topic: who first produced the idea, who maintains the official record, who is accountable for it. Search for that, not for explainers.
4. **Prefer primary over secondary.** A summary or explainer is a pointer to the original. Open the original. Use a secondary source only when no primary one is retrievable, and label it as such.
5. **Chase citations.** When a good source cites the origin of a claim, fetch that. Citation chasing usually beats another search.
6. **Vary the sources.** If every candidate comes from one domain or one type, search again from a different angle. Do not let one venue dominate.
7. **Dead or blocked links.** Try an archived copy once. If that fails, log the source as `unavailable` and move on.
8. **Open before citing.** Fetch and read the source. Snippets are leads only.
9. **Check independence.** Two pages repeating the same original count as one source, so cite the original.

## Fit to the learner

Use `profile.json` (see `level-check`). The level changes which sources you choose, not whether they are sourced:

- Newer to the topic: for each concept the learner is missing, look for the most accessible source that is still reliable, such as an official primer, introduction or documentation. Pick it for clarity and still cite it.
- Working knowledge or above: prefer the originating or most authoritative material. Skip basics the profile marks as known.

## Stop rules

Stop searching for a gap when any of these is true:
- A source you opened answers it.
- Two different search angles found nothing usable. Record it as a gap.
- The run's budget in `limits.md` is spent.

## Tagging

Tag each source with a type label from `source-ledger.md` as you record it. Check the mix before you assemble. If the pack rests on one type only, say so in the Gaps section.
