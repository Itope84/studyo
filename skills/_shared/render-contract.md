# Render contract

Skills write **Markdown**. A renderer script turns it into the HTML the app's Reader shows. The renderer is not built yet; this file is its spec, so skills and renderer agree.

Skills do not write HTML or CSS. That keeps token cost down and makes every pack and condensed doc look consistent. Engagement comes from structure plus the directives below.

## Front matter

```yaml
---
topic: <topic id>
kind: pack | condensed
built: YYYY-MM-DD
depth: standard | deep        # packs
scope: all | <section ids>    # condensed
---
```

## Section ids

Every heading becomes an anchor id derived from its text. Headings are stable. Don't rename them on a re-run, because reading position and chat citations point at them.

## Provenance markers (packs)

```
<!-- studyo:original:start S1 -->
...original text, verbatim...
<!-- studyo:original:end -->
```

The renderer styles the original block differently from additions, so the reader always knows which is which. Notes inserted between original sections use `<!-- studyo:added -->` on the line before them. Never insert inside a paragraph, list or table of the original.

## Directives

Fenced blocks the renderer turns into components:

- `` ```callout kind=definition `` | `key-idea` | `watch-out` ``: optional boxed note, used only where it helps. Body is Markdown. A `definition` states what a source says and carries a citation.
- `` ```mermaid ``: diagram. Only for relationships or processes that a source describes. Put the citation in the line below the block.
- Figures: `![caption](assets/file.png)` followed on the next line by `*Source: [S4](url)*`. Image credit goes in the ledger.

Citations are reference-style links: `[S3]` in the text and `[S3]: url` definitions at the end of the file. The renderer shows them as references.

Anything else is plain Markdown: headings, lists, tables, blockquotes, links.

## Renderer responsibilities (TODO)

- Markdown plus directives to a self-contained `.html` using the Studyo design system, readable on a phone, light and dark.
- Stable section ids, and a hook so the app can save and restore reading position.
- Citation links open the source URL; `S<n>` ids link to the pack's Sources list.
- Fail loudly on unknown directives or a missing `assets/` file.
- Later: shareable PDF from the HTML (backlog).

If the renderer is not available when a skill finishes, leave the `.md` in place, skip the `.html`, and say so in the final progress line. The `.md` is the source of truth.
