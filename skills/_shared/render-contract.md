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
description: <one or two sentences>   # optional; shown in the app's document list. Defaults to the first paragraph
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

Fenced blocks the renderer turns into components. **Prefer a component.** Reach for a free-form block only when no component can show the idea.

### Components

- `` ```callout kind=<kind> `` with an optional `title="..."`. Kinds: `definition` (in a pack: states what a source says and carries a citation; in a condensed doc there are no citations), `key-idea`, `watch-out`, `example`, `analogy` (say plainly that it is one), `note`. Body is Markdown.
- `` ```details summary="..." ``: a collapsible block for optional depth. Body is Markdown.
- `` ```predict ``: a predict-then-reveal check. The question first, then a line containing only `---reveal---`, then the answer and its reasoning (both Markdown). The reader sees the question and clicks to reveal the answer. Use it for every predict check instead of writing "Predict" and "Reveal" as paragraphs or inside a callout. Build the question only from facts the text has already stated.
- `` ```mermaid ``: diagram. Only for relationships or processes that a source describes. Put the citation in the line below the block. Wide diagrams scroll sideways on a phone, so prefer `flowchart TD` (top-down) when there are more than four steps.
- Figures: `![caption](assets/file.png)` followed in a pack on the next line by `*Source: [S4](url)*`. Image credit goes in the ledger. Condensed docs have no source line. An image alone in its paragraph becomes a captioned figure.

### Free-form blocks

- `` ```svg ``: a hand-drawn diagram or annotated figure as inline SVG. Drawing elements only: scripts, event handlers, `foreignObject` and external links are removed. Use `var(--ink)`, `var(--lead)`, `var(--rule)`, `var(--surface)`, `var(--primary)`, `var(--sage)`, `var(--amber)` for colours so it follows light and dark mode. Give the root a `viewBox` and no fixed width.
- `` ```html title="..." ``: an interactive explainer (a slider, a stepper, a small simulation). It runs in a sandboxed frame with the same CSS variables and fonts, can run scripts, and cannot reach the network, the page or the app. Keep it self-contained and small. Facts in it follow the same grounding rules as text, so cite them in the paragraph around it.

A fenced block whose info string has `key=value` pairs is treated as a directive; an unknown one makes rendering fail, so stick to the list above. Ordinary code blocks (` ```python `) stay code.

In packs, citations are reference-style links: `[S3]` in the text and `[S3]: url` definitions at the end of the file. The renderer shows them as references. Condensed docs contain no citations and no reference definitions.

### Maths

`$…$` for inline maths and `$$` on their own lines for display maths, in LaTeX (KaTeX). A `$` followed by a space or used for a price stays text, so "$5" is safe. Use maths only where a source states the formula. Cite it in the sentence around it.

Anything else is plain Markdown: headings, lists, tables, blockquotes, links.

## Renderer

Built: `packages/renderer` (`pnpm --filter @studyo/renderer render <file.md> --library <library>`). The server runs it after every job and whenever a document is opened with stale HTML, so skills don't need to call it.

- Markdown plus directives to a self-contained `.html` using the Studyo design system, readable on a phone, light and dark.
- Stable section ids, and a hook so the app can save and restore reading position.
- Citation links (`S<n>` text) are styled as references and open the source URL.
- Fails loudly on unknown directives, unmatched original markers or a missing `assets/` file.
- Raw HTML written straight into the Markdown is sanitised (no scripts, no event handlers).
- Later: shareable PDF from the HTML (backlog).

If the renderer is not available when a skill finishes, leave the `.md` in place, skip the `.html`, and say so in the final progress line. The `.md` is the source of truth.
