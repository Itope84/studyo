import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Resource } from '@studyo/api';
import type { Library } from './library.ts';
import { nowIso } from './util.ts';

export type CondenseDepth = 'default' | 'longer';
export type CondenseScope = 'all' | string[];

/** What a condense job remembers, so the finished doc can be labelled and an old one replaced. */
export interface CondenseParams {
  depth: CondenseDepth;
  scope: CondenseScope;
  notes: string | null;
  replace: string | null;
  /** Ids of the topic's condensed docs when the job was queued; anything else afterwards is this job's. */
  before: string[];
  /** Where the skill must write, relative to the topic folder. Never an existing file. */
  output_path: string;
}

const DAY = () => nowIso().slice(0, 10);

/** A path under outputs/ that does not exist yet, so a new condense never overwrites an older one. */
export function newOutputPath(topicDir: string, depth: CondenseDepth, scope: CondenseScope) {
  const base = `condensed-${depth === 'longer' ? 'deep-' : ''}${scope === 'all' ? 'all' : 'parts'}-${DAY()}`;
  let name = `${base}.md`;
  for (let n = 2; existsSync(join(topicDir, 'outputs', name)); n++) name = `${base}-${n}.md`;
  return `outputs/${name}`;
}

function firstHeading(file: string): string | null {
  try {
    return /^#\s+(.+)$/m.exec(readFileSync(file, 'utf8'))?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

/** Remove a condensed doc, its renderings, and the reading progress that pointed at it. */
export async function deleteCondensed(library: Library, topicId: string, resource: Resource) {
  const dir = library.topicDir(topicId);
  for (const ext of ['.md', '.html', '.pdf']) {
    rmSync(join(dir, resource.path.replace(/\.md$/, ext)), { force: true });
  }
  const manifest = await library.readManifest(topicId);
  manifest.resources = manifest.resources.filter((r) => r.id !== resource.id);
  manifest.updated = nowIso();
  library.writeManifest(topicId, manifest);
  const progress = await library.readProgress(topicId);
  delete progress.items[resource.id];
  if (progress.last?.resource_id === resource.id) progress.last = null;
  library.writeProgress(topicId, progress);
}

/**
 * After a condense job: label the new doc (depth, scope, notes, a "Deep dive" title) and, when the run was a
 * regenerate, delete the doc it replaces. Returns the new resource, or null when the skill produced none.
 */
export async function finalizeCondense(
  library: Library,
  topicId: string,
  p: CondenseParams,
): Promise<Resource | null> {
  const topic = await library.readTopic(topicId, { persist: true });
  const fresh = topic.resources.filter((r) => r.type === 'condensed' && !p.before.includes(r.id));
  const made = fresh.find((r) => r.path === p.output_path) ?? fresh[fresh.length - 1];
  if (!made) return null;
  const dir = library.topicDir(topicId);
  const manifest = await library.readManifest(topicId);
  const entry = manifest.resources.find((r) => r.id === made.id);
  if (entry) {
    const heading = firstHeading(join(dir, made.path));
    const prefix = p.depth === 'longer' ? 'Deep dive: ' : '';
    const base = heading ?? entry.title;
    entry.title = base.startsWith(prefix) ? base : `${prefix}${base}`;
    entry.depth = p.depth;
    entry.scope = p.scope;
    entry.notes = p.notes;
    manifest.updated = nowIso();
    library.writeManifest(topicId, manifest);
  }
  if (p.replace && p.replace !== made.id) {
    const old = topic.resources.find((r) => r.id === p.replace && r.type === 'condensed');
    if (old) await deleteCondensed(library, topicId, old);
  }
  return made;
}

/**
 * A skill edits topic.json by hand, and a bad edit makes the whole topic unreadable ("Topic not found").
 * Take a copy before a job; afterwards, if the file no longer parses, put the copy back (the documents the
 * job made are found again from the folder). Returns true when it had to restore.
 */
export function guardManifest(library: Library, topicId: string): () => boolean {
  let file: string;
  let before: string;
  try {
    file = join(library.topicDir(topicId), 'topic.json');
    before = readFileSync(file, 'utf8');
    JSON.parse(before);
  } catch {
    return () => false; // a course scope, or nothing to protect
  }
  return () => {
    try {
      JSON.parse(readFileSync(file, 'utf8'));
      return false;
    } catch {
      writeFileSync(file, before);
      return true;
    }
  };
}
