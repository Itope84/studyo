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
10. **Search before recalling.** Prefer URLs that came from a page you retrieved or a search result. If a source you need is not linked anywhere you have read, search for it. If search does not find what you need, you may try a URL you recall from memory as a last resort. Fetch it, and cite it only if the fetch succeeds and you read the content. Log it with `found_via: memory`. Never cite a URL you could not open.

## Fetching

Use the CLI's own fetch tool. If it fails or is unavailable, shell `curl` is allowed as a fallback. Log `fetched_with: curl` in the ledger entry. If a site only serves its content to a browser-like client, note that in the entry's `note`.

## Fit to the learner

Use `library/profile.md` and the topic's `learning.gaps` (see `level-check`). The level changes which sources you choose, not whether they are sourced:

- Newer to the topic: for each concept the learner is missing, look for the most accessible source that is still reliable, such as an official primer, introduction or documentation. Pick it for clarity and still cite it.
- Working knowledge or above: prefer the originating or most authoritative material. Skip basics the profile marks as known.

## Stop rules

Stop searching for a gap when any of these is true:
- A source you opened answers it.
- Two different search angles found nothing usable. Record it as a gap.
- The run's budget in `limits.md` is spent.

## Tagging

Tag each source with a type label from `source-ledger.md` as you record it. Check the mix before you assemble. If the pack rests on one type only, say so in the Gaps section.
