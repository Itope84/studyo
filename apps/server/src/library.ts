import { existsSync, mkdirSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type {
  ContinueItem,
  Job,
  Progress,
  Resource,
  ResourceType,
  Topic,
  TopicStatus,
  TopicSummary,
} from '@studyo/api';
import { parseFile } from 'music-metadata';
import { HttpError, notFound, nowIso, readJson, slugify, today, writeJsonAtomic } from './util.ts';

const TOPIC_ID = /^[a-z0-9][a-z0-9-]*$/;
export const AUDIO_EXT = new Set([
  '.mp3',
  '.m4a',
  '.aac',
  '.wav',
  '.ogg',
  '.oga',
  '.opus',
  '.flac',
]);
export const VIDEO_EXT = new Set(['.mp4', '.m4v', '.mov', '.webm', '.mkv']);
const SOURCE_EXT = new Set(['.md', '.pdf', '.txt', '.html', '.htm']);

/** The manifest as stored. Unknown fields are kept on write. */
export type Manifest = Topic & Record<string, unknown>;

export function mediaTypeFor(name: string): ResourceType | null {
  const ext = extname(name).toLowerCase();
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (VIDEO_EXT.has(ext)) return 'video';
  return null;
}

export function titleFromFilename(name: string): string {
  const stem = basename(name, extname(name))
    .replace(/^S\d+-/, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  return stem ? stem.charAt(0).toUpperCase() + stem.slice(1) : name;
}

export class Library {
  constructor(readonly root: string) {}

  get topicsDir() {
    return join(this.root, 'topics');
  }

  get inboxDir() {
    return join(this.root, 'inbox');
  }

  topicDir(id: string): string {
    if (!TOPIC_ID.test(id)) throw notFound('Topic');
    return join(this.topicsDir, id);
  }

  async topicIds(): Promise<string[]> {
    const entries = await readdir(this.topicsDir, { withFileTypes: true }).catch(() => []);
    const ids: string[] = [];
    for (const e of entries) {
      if (
        e.isDirectory() &&
        TOPIC_ID.test(e.name) &&
        existsSync(join(this.topicsDir, e.name, 'topic.json'))
      ) {
        ids.push(e.name);
      }
    }
    return ids;
  }

  async exists(id: string): Promise<boolean> {
    return existsSync(join(this.topicDir(id), 'topic.json'));
  }

  async readManifest(id: string): Promise<Manifest> {
    const raw = await readJson<Partial<Manifest>>(join(this.topicDir(id), 'topic.json'));
    if (!raw) throw notFound('Topic');
    return normaliseManifest(id, raw);
  }

  writeManifest(id: string, manifest: Manifest) {
    const { ...stored } = manifest;
    for (const r of stored.resources) {
      delete (r as Partial<Resource>).html_path;
      delete (r as Partial<Resource>).url;
    }
    writeJsonAtomic(join(this.topicDir(id), 'topic.json'), stored);
  }

  /**
   * The manifest as the app sees it: files missing from the manifest are discovered (and written back when
   * `persist` is true), missing files are hidden, and `html_path` and `url` are derived.
   */
  async readTopic(id: string, { persist }: { persist: boolean }): Promise<Topic> {
    const manifest = await this.readManifest(id);
    const dir = this.topicDir(id);
    const discovered = await discover(dir, manifest);
    if (discovered.length && persist) {
      manifest.resources.push(...discovered);
      manifest.updated = nowIso();
      this.writeManifest(id, manifest);
    } else if (discovered.length) {
      manifest.resources = [...manifest.resources, ...discovered];
    }
    const ledger = await readLedger(dir);
    const resources: Resource[] = [];
    for (const r of manifest.resources) {
      if (!existsSync(join(dir, r.path))) continue;
      const htmlPath = r.path.replace(/\.md$/, '.html');
      resources.push({
        ...r,
        html_path: r.path.endsWith('.md') && existsSync(join(dir, htmlPath)) ? htmlPath : null,
        url: ledger.get(r.id) ?? ledger.get(r.path) ?? null,
      });
    }
    return { ...manifest, resources };
  }

  async readProgress(id: string): Promise<Progress> {
    const raw = await readJson<Partial<Progress>>(join(this.topicDir(id), 'progress.json'));
    return { items: raw?.items ?? {}, last: raw?.last ?? null };
  }

  writeProgress(id: string, progress: Progress) {
    writeJsonAtomic(join(this.topicDir(id), 'progress.json'), progress);
  }

  async createTopic(input: {
    title: string;
    origin: Manifest['origin'];
    slugHint: string;
  }): Promise<Manifest> {
    let id = slugify(input.slugHint);
    for (let n = 2; existsSync(join(this.topicsDir, id)); n++)
      id = `${slugify(input.slugHint, 44)}-${n}`;
    const dir = this.topicDir(id);
    for (const sub of ['sources', 'pack', 'outputs', 'chat'])
      mkdirSync(join(dir, sub), { recursive: true });
    const now = nowIso();
    const manifest: Manifest = {
      id,
      title: input.title,
      status: 'captured',
      origin: input.origin,
      session_id: null,
      resources: [],
      created: now,
      updated: now,
    };
    this.writeManifest(id, manifest);
    this.writeProgress(id, { items: {}, last: null });
    return manifest;
  }

  async setStatus(id: string, status: TopicStatus, failure_reason: string | null = null) {
    const m = await this.readManifest(id);
    m.status = status;
    m.failure_reason = failure_reason;
    m.updated = nowIso();
    this.writeManifest(id, m);
  }

  async summary(id: string, activeJob: Job | null): Promise<TopicSummary> {
    const topic = await this.readTopic(id, { persist: false });
    const progress = await this.readProgress(id);
    return summarise(topic, progress, activeJob);
  }

  /** The most recent unfinished item across all topics, for Home's Continue card. */
  async continueItem(ids: string[]): Promise<ContinueItem | null> {
    let best: ContinueItem | null = null;
    for (const id of ids) {
      const progress = await this.readProgress(id);
      if (!progress.last) continue;
      const item = progress.items[progress.last.resource_id];
      if (!item || item.done) continue;
      if (best && best.item.updated >= item.updated) continue;
      const topic = await this.readTopic(id, { persist: false });
      if (topic.status === 'archived') continue;
      const resource = topic.resources.find((r) => r.id === progress.last?.resource_id);
      if (resource) best = { topic_id: id, topic_title: topic.title, resource, item };
    }
    return best;
  }
}

export function summarise(topic: Topic, progress: Progress, activeJob: Job | null): TopicSummary {
  const count = (types: ResourceType[]) => topic.resources.filter((r) => types.includes(r.type));
  const trackable = count(['pack', 'condensed', 'audio', 'video']);
  return {
    id: topic.id,
    title: topic.title,
    status: topic.status,
    origin: topic.origin,
    counts: {
      sources: count(['source']).length,
      docs: count(['pack', 'condensed']).length,
      media: count(['audio', 'video']).length,
    },
    progress: {
      done: trackable.filter((r) => progress.items[r.id]?.done).length,
      total: trackable.length,
    },
    failure_reason: topic.failure_reason ?? null,
    active_job: activeJob,
    updated: topic.updated,
  };
}

function normaliseManifest(id: string, raw: Partial<Manifest>): Manifest {
  if (!raw.origin || typeof raw.origin !== 'object') {
    throw new HttpError(500, 'bad_manifest', `topic.json for ${id} has no origin.`);
  }
  return {
    ...raw,
    id,
    title: raw.title || id,
    status: raw.status ?? 'captured',
    origin: raw.origin,
    session_id: raw.session_id ?? null,
    resources: (raw.resources ?? []).filter((r) => r && typeof r.path === 'string'),
    created: raw.created ?? nowIso(),
    updated: raw.updated ?? raw.created ?? nowIso(),
  } as Manifest;
}

async function readLedger(dir: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const text = await readFile(join(dir, 'sources', 'ledger.jsonl'), 'utf8').catch(() => '');
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as { id?: string; url?: string; saved?: string };
      if (!entry.url) continue;
      if (entry.id) map.set(entry.id, entry.url);
      if (entry.saved) map.set(entry.saved, entry.url);
    } catch {
      // A half-written line from a running skill; ignore it.
    }
  }
  return map;
}

/** Files present in the topic folder but missing from the manifest. */
async function discover(dir: string, manifest: Manifest): Promise<Resource[]> {
  const known = new Set(manifest.resources.map((r) => r.path));
  const ids = new Set(manifest.resources.map((r) => r.id));
  const found: Resource[] = [];

  const add = async (path: string, type: ResourceType, title: string, idHint: string) => {
    if (known.has(path)) return;
    let id = idHint;
    for (let n = 2; ids.has(id); n++) id = `${idHint}-${n}`;
    ids.add(id);
    const full = join(dir, path);
    const info = await stat(full);
    let duration: number | null = null;
    if (type === 'audio' || type === 'video') {
      duration = await parseFile(full, { duration: true })
        .then((m) => m.format.duration ?? null)
        .catch(() => null);
    }
    found.push({
      id,
      type,
      title,
      path,
      made_with: null,
      duration,
      size: info.size,
      added: today(),
    });
  };

  const list = async (sub: string) =>
    (await readdir(join(dir, sub), { withFileTypes: true }).catch(() => []))
      .filter((e) => e.isFile() && !e.name.startsWith('_') && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort();

  if (existsSync(join(dir, 'pack', 'pack.md')))
    await add('pack/pack.md', 'pack', 'Study pack', 'pack');

  for (const name of await list('sources')) {
    const ext = extname(name).toLowerCase();
    if (!SOURCE_EXT.has(ext) || name === 'ledger.jsonl') continue;
    // A rendering next to its Markdown is not a separate source.
    if (
      (ext === '.html' || ext === '.htm') &&
      existsSync(join(dir, 'sources', name.replace(/\.html?$/, '.md')))
    )
      continue;
    const sid = /^(S\d+)-/.exec(name)?.[1] ?? slugify(basename(name, ext));
    await add(`sources/${name}`, 'source', titleFromFilename(name), sid);
  }

  for (const name of await list('outputs')) {
    const ext = extname(name).toLowerCase();
    const media = mediaTypeFor(name);
    if (media)
      await add(`outputs/${name}`, media, titleFromFilename(name), slugify(basename(name, ext)));
    else if (ext === '.md')
      await add(
        `outputs/${name}`,
        'condensed',
        titleFromFilename(name),
        slugify(basename(name, ext)),
      );
  }
  return found;
}
