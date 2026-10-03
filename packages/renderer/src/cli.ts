#!/usr/bin/env node
import { resolve } from 'node:path';
import { RenderError, renderFile } from './index.ts';

/** Usage: studyo-render <file.md>... [--library <dir>] */
const args = process.argv.slice(2);
const libIndex = args.indexOf('--library');
let library = resolve('library');
if (libIndex >= 0) {
  library = resolve(args[libIndex + 1] ?? '.');
  args.splice(libIndex, 2);
}
if (!args.length) {
  console.error('Usage: studyo-render <file.md>... [--library <dir>]');
  process.exit(2);
}
let failed = false;
for (const file of args) {
  try {
    const out = renderFile(resolve(file), library);
    console.log(`[studyo] rendered ${out.htmlPath} (${out.headings.length} sections)`);
  } catch (e) {
    failed = true;
    const msg = e instanceof RenderError ? e.message : (e as Error).stack;
    console.error(`[studyo] render FAILED for ${file}: ${msg}`);
  }
}
process.exit(failed ? 1 : 0);
