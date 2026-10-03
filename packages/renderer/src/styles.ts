import { cssVars, tokens } from './tokens.ts';

const light = cssVars(tokens.light);
const dark = cssVars(tokens.dark);

/** Theme variables: light by default, dark by preference, either forced with `data-theme`. */
export const themeCss = `
:root { ${light} color-scheme: light; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${dark} color-scheme: dark; } }
:root[data-theme="dark"] { ${dark} color-scheme: dark; }
:root[data-theme="light"] { ${light} color-scheme: light; }
`;

export const documentCss = `
${themeCss}
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
body {
  margin: 0; background: var(--canvas); color: var(--ink);
  font-family: ${tokens.font.content}; font-size: 19px; line-height: 1.6;
  font-optical-sizing: auto; text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased;
}
main { max-width: 680px; margin: 0 auto; padding: 28px 20px 120px; }
@media (max-width: 480px) { body { font-size: 18px; } main { padding: 20px 16px 120px; } }

.doc-meta {
  font-family: ${tokens.font.apparatus}; font-size: 12px; font-weight: 500; letter-spacing: 0.04em;
  text-transform: uppercase; color: var(--lead); display: flex; flex-wrap: wrap; gap: 6px 12px; margin: 0 0 18px;
}
.doc-meta .kind { color: var(--primary-ink); }
h1, h2, h3, h4 { font-weight: 500; line-height: 1.2; letter-spacing: -0.01em; scroll-margin-top: 24px; text-wrap: balance; }
h1 { font-size: 34px; font-weight: 400; letter-spacing: -0.02em; margin: 0 0 20px; }
h2 { font-size: 26px; margin: 48px 0 14px; padding-top: 20px; border-top: 1px solid var(--rule); }
h3 { font-size: 21px; margin: 32px 0 10px; }
h4 { font-size: 18px; margin: 24px 0 8px; }
@media (max-width: 480px) { h1 { font-size: 30px; } h2 { font-size: 23px; } }
p, ul, ol, blockquote, table, figure, pre, .callout { margin: 0 0 18px; }
ul, ol { padding-left: 1.3em; }
li { margin: 4px 0; }
li > p { margin: 0 0 8px; }
strong { font-weight: 600; }
hr { border: 0; border-top: 1px solid var(--rule); margin: 36px 0; }
a { color: var(--primary-ink); text-decoration-thickness: 1px; text-underline-offset: 2px; }
a:hover { text-decoration-thickness: 2px; }
a.cite {
  font-family: ${tokens.font.apparatus}; font-size: 0.68em; font-weight: 500; letter-spacing: 0.02em;
  text-decoration: none; color: var(--sage); background: var(--sage-soft); border-radius: 3px;
  padding: 1px 5px; white-space: nowrap; vertical-align: 0.12em;
}
a.cite:hover { background: var(--sage); color: var(--canvas); }
code {
  font-family: ${tokens.font.mono}; font-size: 0.82em; background: var(--surface); border: 1px solid var(--rule);
  border-radius: 3px; padding: 1px 4px;
}
pre { background: var(--surface); border: 1px solid var(--rule); border-radius: 4px; padding: 14px 16px; overflow-x: auto; }
pre code { background: none; border: 0; padding: 0; font-size: 13px; line-height: 1.55; }
blockquote { margin-left: 0; padding: 2px 0 2px 18px; border-left: 2px solid var(--rule-strong); color: var(--lead); font-style: italic; }
.table-wrap { overflow-x: auto; margin: 0 0 18px; -webkit-overflow-scrolling: touch; }
table { border-collapse: collapse; width: 100%; font-size: 16px; line-height: 1.45; margin: 0; }
th, td { text-align: left; vertical-align: top; padding: 9px 10px; border-bottom: 1px solid var(--rule); }
th { font-family: ${tokens.font.apparatus}; font-size: 12px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; color: var(--lead); background: var(--surface); }
img, svg { max-width: 100%; height: auto; }

/* Provenance: the original text versus what the pack added around it. */
.original { position: relative; margin: 36px 0; padding: 0 0 0 18px; border-left: 3px solid var(--rule-strong); }
.original > .provenance { margin-left: -18px; padding-left: 18px; }
.original > h2:first-of-type, .original > .provenance + h2 { border-top: 0; padding-top: 0; }
.provenance {
  font-family: ${tokens.font.apparatus}; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--lead); display: flex; align-items: center; gap: 8px; margin: 0 0 14px;
}
.provenance::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--rule-strong); }
.provenance.end { margin: 18px 0 0; }
.added-note { background: var(--tint); border: 1px dashed var(--rule-strong); border-radius: 4px; padding: 12px 14px; font-size: 17px; }
.added-note::before {
  content: 'Added note'; display: block; font-family: ${tokens.font.apparatus}; font-size: 11px; font-weight: 600;
  letter-spacing: 0.06em; text-transform: uppercase; color: var(--primary-ink); margin-bottom: 4px;
}
.added-note > :last-child { margin-bottom: 0; }

/* Callouts */
.callout { border-radius: 4px; padding: 14px 16px; background: var(--surface); border-left: 3px solid var(--lead); font-size: 17.5px; }
.callout > :last-child { margin-bottom: 0; }
.callout-label {
  font-family: ${tokens.font.apparatus}; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--lead); margin: 0 0 6px; display: block;
}
.callout-definition { border-left-color: var(--sage); background: var(--sage-soft); }
.callout-definition .callout-label { color: var(--sage); }
.callout-key-idea { border-left-color: var(--primary); background: var(--primary-soft); }
.callout-key-idea .callout-label { color: var(--primary-ink); }
.callout-watch-out { border-left-color: var(--amber); background: var(--amber-soft); }
.callout-watch-out .callout-label { color: var(--amber); }
.callout-analogy { border-left-style: dashed; }
.callout-example { border-left-color: var(--ink); }

/* Figures and diagrams */
figure { margin: 26px 0; }
figure img, figure svg { display: block; margin: 0 auto; border-radius: 4px; }
figure img { background: #fff; }
figcaption { font-family: ${tokens.font.apparatus}; font-size: 13px; line-height: 1.45; color: var(--lead); margin-top: 8px; }
figcaption .credit { display: block; color: var(--faint); margin-top: 2px; }
figcaption .credit a { color: inherit; }
.diagram { background: var(--surface); border: 1px solid var(--rule); border-radius: 4px; padding: 16px; overflow-x: auto; text-align: center; }
.diagram pre.mermaid { background: none; border: 0; padding: 0; margin: 0; font-family: ${tokens.font.apparatus}; font-size: 14px; color: var(--lead); white-space: pre-wrap; text-align: left; }
.diagram pre.mermaid[data-processed] { text-align: center; }
.freeform-svg { color: var(--ink); }
.freeform-svg svg { width: 100%; height: auto; }
iframe.freeform-html { width: 100%; border: 1px solid var(--rule); border-radius: 4px; background: var(--canvas); min-height: 120px; display: block; }

/* Details */
details { border: 1px solid var(--rule); border-radius: 4px; padding: 10px 14px; margin: 0 0 18px; }
summary { cursor: pointer; font-family: ${tokens.font.apparatus}; font-size: 14px; font-weight: 500; }

/* Highlight when jumping to a section from chat */
.flash { animation: flash 1.6s ease-out; }
@keyframes flash { 0% { background: var(--primary-soft); } 100% { background: transparent; } }
`;

/** Minimal styles for a sandboxed free-form HTML block: tokens and fonts, nothing else. */
export const frameCss = `
${themeCss}
html, body { margin: 0; background: transparent; color: var(--ink); font-family: ${tokens.font.content}; font-size: 17px; line-height: 1.55; }
body { padding: 12px; }
button, input, select { font-family: ${tokens.font.apparatus}; font-size: 14px; }
`;
