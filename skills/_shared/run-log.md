# Run log

At the end of each enrichment run (`enrich-document`, `enrich-topic`, `enrich-deep`), append **one line** to `<topic>/runs.jsonl`. It exists to answer one question: are the ceilings in `limits.md` too small? `condense` and `answer` do not write one.

```json
{"run":"2026-10-03-enrich-document","skill":"enrich-document","searches":9,"opened":["S2","S3","S4"],"stopped_by":"sufficiency","dropped_for_ceiling":[]}
```

| Field | Meaning |
| --- | --- |
| `run` | Date plus skill name, with `-2`, `-3` if repeated the same day. |
| `skill` | The skill that ran. |
| `searches` | How many search queries you ran. Count them as you go. |
| `opened` | Ledger ids opened or partly opened this run, excluding the original. Take them from the ledger, not from memory. |
| `stopped_by` | `sufficiency` (the learner could follow the material), `ceiling` (a limit in `limits.md` ended the run before that), or `failure`. Be honest: this is the field that tells us whether the limits are too small. |
| `dropped_for_ceiling` | Concepts left unexplained *because a ceiling was reached*, most important first. Concepts with no source found do not belong here: they go under Gaps in the pack. |

Write the line even when the run fails or hits a ceiling. If the run is killed before it can write, no line exists, and that is acceptable.
