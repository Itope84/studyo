import { parse as parseYaml } from 'yaml';

/** Values that start like YAML syntax of their own (quotes, flow collections, block scalars, anchors, tags). */
const OWN_SYNTAX = /^(["'[{|>&*!%@`]|-\s*$)/;

/**
 * Quote the unquoted text values in front matter, so a colon, `#` or leading dash inside one no longer breaks
 * the file. Only plain `key: value` and `- key: value` lines are touched; a trailing comment after two or more
 * spaces is kept as a comment. Values that are already quoted or are numbers, dates, booleans or null stay as they are.
 */
export function quoteFrontMatter(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const m = /^(\s*(?:-\s+)?[A-Za-z_][\w-]*:[ \t]+)(.*?)(\s{2,}#.*)?$/.exec(line);
      if (!m) return line;
      const [, head, value = '', comment = ''] = m;
      if (!value || OWN_SYNTAX.test(value)) return line;
      if (/^(-?\d+(\.\d+)?|\d{4}-\d{2}-\d{2}|true|false|null|~)$/i.test(value)) return line;
      return `${head}"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"${comment}`;
    })
    .join('\n');
}

/** Parse front matter; if it is not valid YAML, quote its text values and try once more. */
export function parseFrontMatter<T = Record<string, unknown>>(text: string): T | null {
  try {
    return (parseYaml(text) as T) ?? null;
  } catch (first) {
    try {
      return (parseYaml(quoteFrontMatter(text)) as T) ?? null;
    } catch {
      throw first;
    }
  }
}
