import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Resource } from '@studyo/api';
import type { Library } from './library.ts';
import { nowIso } from './util.ts';
import type { RenderResult } from './voice/render.ts';
import type { Script } from './voice/script.ts';

/** What an audio job remembers: where the doc is, where the files go, and what the finished audio replaces. */
export interface AudioParams {
  /** The condensed doc, by id and by path (relative to the topic folder). */
  source_id: string;
  source_path: string;
  /** `all`, or section headings. */
  scope: 'all' | string[];
  voices: 1 | 2;
  /** The audio this run replaces once it succeeds. */
  replace: string | null;
  /** Where the skill writes the script, relative to the topic folder. */
  output_path: string;
  /** Where the server writes the finished audio, relative to the topic folder. */
  audio_path: string;
  /** Where the server writes what it knows about the audio, relative to the topic folder. */
  meta_path: string;
}

export interface AudioMeta {
  version: 1;
  source_id: string;
  source_path: string;
  voices: 1 | 2;
  engine: string;
  model: string;
  created: string;
  duration: number;
  words: number;
  parts: RenderResult['parts'];
}

/** Paths for a new audio that do not exist yet, so a new run never overwrites an older one. */
export function newAudioPaths(topicDir: string, doc: Resource) {
  const stem = basename(doc.path).replace(/\.md$/, '');
  const base = `audio-${stem}`;
  let name = base;
  for (
    let n = 2;
    existsSync(join(topicDir, 'outputs', `${name}.m4a`)) ||
    existsSync(join(topicDir, 'outputs', 'audio', `${name}.script.json`));
    n++
  )
    name = `${base}-${n}`;
  return {
    output_path: `outputs/audio/${name}.script.json`,
    audio_path: `outputs/${name}.m4a`,
    meta_path: `outputs/audio/${name}.audio.json`,
  };
}

/** Audio the app made from a doc (not an upload): it carries a `source_id`. */
export const isGeneratedAudio = (r: Resource) => r.type === 'audio' && !!r.source_id;

/** The audio made from this doc, newest first. */
export const audioFor = (resources: Resource[], docId: string) =>
  resources.filter((r) => isGeneratedAudio(r) && r.source_id === docId);

/** Remove an audio, its script and notes, and the listening progress and bookmarks that pointed at it. */
export async function deleteAudio(library: Library, topicId: string, resource: Resource) {
  const dir = library.topicDir(topicId);
  const stem = basename(resource.path).replace(/\.m4a$/, '');
  for (const rel of [
    resource.path,
    `outputs/audio/${stem}.script.json`,
    `outputs/audio/${stem}.audio.json`,
  ])
    rmSync(join(dir, rel), { force: true });
  const manifest = await library.readManifest(topicId);
  manifest.resources = manifest.resources.filter((r) => r.id !== resource.id);
  manifest.updated = nowIso();
  library.writeManifest(topicId, manifest);
  const progress = await library.readProgress(topicId);
  delete progress.items[resource.id];
  if (progress.last?.resource_id === resource.id) progress.last = null;
  progress.bookmarks = progress.bookmarks.filter((b) => b.resource_id !== resource.id);
  library.writeProgress(topicId, progress);
}

/**
 * After an audio job: label the new audio (title, source doc, voices, made with), write its notes file, and when
 * the run was a regenerate, delete the audio it replaces. Returns the new resource, or null when none appeared.
 */
export async function finalizeAudio(
  library: Library,
  topicId: string,
  p: AudioParams,
  script: Script,
  result: RenderResult,
  engine: { id: string; label: string; model: string },
): Promise<Resource | null> {
  const topic = await library.readTopic(topicId, { persist: true });
  const made = topic.resources.find((r) => r.type === 'audio' && r.path === p.audio_path);
  if (!made) return null;
  const doc = topic.resources.find((r) => r.id === p.source_id);
  const dir = library.topicDir(topicId);
  const meta: AudioMeta = {
    version: 1,
    source_id: p.source_id,
    source_path: p.source_path,
    voices: p.voices,
    engine: engine.id,
    model: engine.model,
    created: nowIso(),
    duration: result.duration,
    words: script.words,
    parts: result.parts,
  };
  writeFileSync(join(dir, p.meta_path), JSON.stringify(meta, null, 2));
  const manifest = await library.readManifest(topicId);
  const entry = manifest.resources.find((r) => r.id === made.id);
  if (entry) {
    entry.title = `Audio: ${doc?.title ?? script.title}`;
    entry.made_with = engine.label;
    entry.source_id = p.source_id;
    entry.voices = p.voices;
    manifest.updated = nowIso();
    library.writeManifest(topicId, manifest);
  }
  if (p.replace && p.replace !== made.id) {
    const old = topic.resources.find((r) => r.id === p.replace && isGeneratedAudio(r));
    if (old) await deleteAudio(library, topicId, old);
  }
  return made;
}

/** Read the script file a skill wrote, or null. */
export function readScriptFile(topicDir: string, rel: string): string | null {
  try {
    return readFileSync(join(topicDir, rel), 'utf8');
  } catch {
    return null;
  }
}
