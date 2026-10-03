# Source ledger

`sources/ledger.jsonl`: one JSON object per line, append-only. Write each entry when you open (or fail to open) a source, not at the end of the run. This is also what keeps the pack consistent if a run is killed.

| Field | Meaning |
| --- | --- |
| `id` | `S1`, `S2`, … assigned in order, never reused. The original document is `S1` unless the topic already has a ledger. |
| `url` | Exact URL retrieved (or `null` for an uploaded file). Final URL after redirects, plus `requested_url` if it differs. |
| `title` | As shown by the source. |
| `type` | One of the labels below. |
| `status` | `opened` (read in full), `partial` (read in part, say which in `note`), `unavailable` (could not retrieve), `rejected` (opened, not used). |
| `retrieved` | Date of retrieval, `YYYY-MM-DD`. |
| `published` | Publication or last-updated date if shown, else `null`. |
| `saved` | Path under `sources/` where the extracted text or file is stored, else `null`. |
| `used_for` | Why it was fetched: the gap or concept it answers. |
| `note` | Reason for `rejected` / `unavailable` / `partial`, and anything a reader should know. |

## Source types

Tag every source with one label.

| Label | Meaning |
| --- | --- |
| `official` | Primary or official source from the people or body the information is about |
| `academic` | Peer-reviewed or formally published research |
| `secondary-industry` | Professional analysis, reports, trade or expert write-ups |
| `journalism` | News reporting |
| `community` | User-generated content: forums, Q&A, reviews, social posts |
| `other` | Anything that does not fit, or mixed |

## Saving sources

- Save the extracted readable text as Markdown at `sources/S<n>-<short-slug>.md`, keeping headings, tables, figure captions and the source's own reference list. Keep PDFs as `sources/S<n>-<short-slug>.pdf` with the converted text next to them.
- Save images you may reuse under `sources/S<n>-assets/`, and note the credit in the ledger `note`.
- The saved text is what quote verification runs against, so save what you actually read, not a summary.
