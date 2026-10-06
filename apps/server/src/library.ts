import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type {
  ChapterRef,
  ContinueItem,
  Course,
  Job,
  Progress,
  Resource,
  ResourceType,
  Topic,
  TopicStatus,
  TopicSummary,
} from '@studyo/api';
import { courseIdOf, isCourseScope } from '@studyo/api';
import { docInfo } from '@studyo/renderer';
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

  get coursesDir() {
    return join(this.root, 'courses');
  }

  /** The folder behind a topic id, or behind a course scope id (`course--<id>`), which jobs and chat use. */
  topicDir(id: string): string {
    if (!TOPIC_ID.test(id)) throw notFound('Topic');
    if (isCourseScope(id)) return this.courseDir(courseIdOf(id));
    return join(this.topicsDir, id);
  }

  courseDir(id: string): string {
    if (!TOPIC_ID.test(id)) throw notFound('Course');
    return join(this.coursesDir, id);
  }

  async courseIds(): Promise<string[]> {
    const entries = await readdir(this.coursesDir, { withFileTypes: true }).catch(() => []);
    return entries
      .filter(
        (e) =>
          e.isDirectory() &&
          TOPIC_ID.test(e.name) &&
          existsSync(join(this.coursesDir, e.name, 'course.json')),
      )
      .map((e) => e.name);
  }

  courseExists(id: string): boolean {
    return TOPIC_ID.test(id) && existsSync(join(this.coursesDir, id, 'course.json'));
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

  /** A topic, or a course when given a course scope id. */
  async exists(id: string): Promise<boolean> {
    if (isCourseScope(id)) return this.courseExists(courseIdOf(id));
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
      delete (r as Partial<Resource>).description;
      delete (r as Partial<Resource>).read_minutes;
      delete (r as Partial<Resource>).chapters;
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
      const isDoc = (r.type === 'pack' || r.type === 'condensed') && r.path.endsWith('.md');
      const info = isDoc ? await docFacts(join(dir, r.path)) : null;
      const isMedia = r.type === 'audio' || r.type === 'video';
      resources.push({
        ...r,
        html_path: r.path.endsWith('.md') && existsSync(join(dir, htmlPath)) ? htmlPath : null,
        url: ledger.get(r.id) ?? ledger.get(r.path) ?? null,
        description: info?.description ?? null,
        read_minutes: info ? Math.max(1, Math.round(info.words / WORDS_PER_MINUTE)) : null,
        chapters: isMedia
          ? ((await mediaChapters(join(dir, r.path))) ?? partChapters(dir, r.path))
          : null,
      });
    }
    const packInfo = resources.find((r) => r.type === 'pack')?.description ?? null;
    const summary =
      typeof manifest.summary === 'string' && manifest.summary.trim() ? manifest.summary : packInfo;
    return {
      ...manifest,
      summary,
      course: manifest.course ?? null,
      cover_path: await findCover(dir),
      resources,
    };
  }

  async readProgress(id: string): Promise<Progress> {
    const raw = await readJson<Partial<Progress>>(join(this.topicDir(id), 'progress.json'));
    return { items: raw?.items ?? {}, last: raw?.last ?? null, bookmarks: raw?.bookmarks ?? [] };
  }

  writeProgress(id: string, progress: Progress) {
    writeJsonAtomic(join(this.topicDir(id), 'progress.json'), progress);
  }

  async createTopic(input: {
    title: string;
    origin: Manifest['origin'];
    slugHint: string;
    /** A chapter creates its folder under its own id, which is already unique. */
    exactId?: string;
    course?: ChapterRef;
  }): Promise<Manifest> {
    let id = input.exactId ?? slugify(input.slugHint);
    if (!input.exactId) {
      for (let n = 2; existsSync(join(this.topicsDir, id)) || isCourseScope(id); n++)
        id = `${slugify(input.slugHint, 44)}-${n}`;
    }
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
      ...(input.course ? { course: input.course } : {}),
      resources: [],
      created: now,
      updated: now,
    };
    this.writeManifest(id, manifest);
    this.writeProgress(id, { items: {}, last: null, bookmarks: [] });
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

  /**
   * The most recent unfinished audio, video or condensed doc across all topics, for Home's Continue card.
   * Study packs are reference material and never show here.
   */
  async continueItem(ids: string[]): Promise<ContinueItem | null> {
    let best: ContinueItem | null = null;
    for (const id of ids) {
      const progress = await this.readProgress(id);
      const candidates = Object.entries(progress.items)
        .filter(([, item]) => !item.done && (!best || item.updated > best.item.updated))
        .sort((a, b) => b[1].updated.localeCompare(a[1].updated));
      if (!candidates.length) continue;
      const topic = await this.readTopic(id, { persist: false });
      if (topic.status === 'archived') continue;
      for (const [rid, item] of candidates) {
        const resource = topic.resources.find((r) => r.id === rid);
        if (!resource || !CONTINUABLE.has(resource.type)) continue;
        best = { topic_id: id, topic_title: topic.title, resource, item };
        break;
      }
    }
    return best;
  }
}

export function summarise(topic: Topic, progress: Progress, activeJob: Job | null): TopicSummary {
  const count = (types: ResourceType[]) => topic.resources.filter((r) => types.includes(r.type));
  const trackable = count(['pack', 'condensed', 'audio', 'video']);
  return {
    id: topic.id,
    course_id: topic.course?.course_id ?? null,
    title: topic.title,
    status: topic.status,
    origin: topic.origin,
    counts: {
      sources: count(['source']).length,
      docs: count(['pack', 'condensed']).length,
      media: count(['audio', 'video']).length,
    },
    summary: topic.summary ?? null,
    progress: {
      done: trackable.filter((r) => progress.items[r.id]?.done).length,
      total: trackable.length,
      fraction: trackable.length
        ? trackable.reduce((sum, r) => sum + itemFraction(r, progress), 0) / trackable.length
        : 0,
    },
    failure_reason: topic.failure_reason ?? null,
    active_job: activeJob,
    updated: topic.updated,
  };
}

const WORDS_PER_MINUTE = 230;
const CONTINUABLE = new Set<ResourceType>(['audio', 'video', 'condensed']);
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg)$/i;

/** The first figure saved with the pack (or a condensed doc), for cover art. */
async function findCover(dir: string): Promise<string | null> {
  for (const sub of ['pack/assets', 'outputs/assets']) {
    const files = (await readdir(join(dir, sub)).catch(() => [] as string[]))
      .filter((f) => IMAGE_EXT.test(f) && !f.startsWith('.'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (files[0]) return `${sub}/${files[0]}`;
  }
  return null;
}

/** Parts of audio the app made: the notes file next to its script lists where each part starts. */
function partChapters(dir: string, path: string): { title: string; start: number }[] | null {
  const meta = join(dir, 'outputs', 'audio', `${basename(path, extname(path))}.audio.json`);
  try {
    const parts = (JSON.parse(readFileSync(meta, 'utf8')) as { parts?: unknown }).parts;
    if (!Array.isArray(parts) || !parts.length) return null;
    return parts.map((p: { title?: string; start?: number }, i) => ({
      title: String(p.title ?? `Part ${i + 1}`),
      start: Number(p.start ?? 0),
    }));
  } catch {
    return null;
  }
}

/** Chapter markers inside an audio or video file, cached by modification time. */
const chapterCache = new Map<
  string,
  { mtime: number; chapters: { title: string; start: number }[] | null }
>();
async function mediaChapters(path: string): Promise<{ title: string; start: number }[] | null> {
  try {
    const { mtimeMs } = await stat(path);
    const hit = chapterCache.get(path);
    if (hit && hit.mtime === mtimeMs) return hit.chapters;
    const meta = await parseFile(path, {
      includeChapters: true,
      duration: false,
      skipCovers: true,
    });
    const raw = meta.format.chapters ?? [];
    const rate = meta.format.sampleRate ?? 1;
    const chapters = raw.length
      ? raw.map((c, i) => ({
          title: c.title || `Chapter ${i + 1}`,
          // start/timeScale is seconds; without a time scale fall back to the sample offset, then milliseconds.
          start: c.timeScale
            ? c.start / c.timeScale
            : c.sampleOffset !== undefined
              ? c.sampleOffset / rate
              : c.start / 1000,
        }))
      : null;
    chapterCache.set(path, { mtime: mtimeMs, chapters });
    return chapters;
  } catch {
    return null;
  }
}

/** How far through one item: a document's scroll fraction, or media position over duration. */
function itemFraction(r: Resource, progress: Progress): number {
  const item = progress.items[r.id];
  if (!item) return 0;
  if (item.done) return 1;
  if (r.type === 'audio' || r.type === 'video') {
    const duration = item.duration ?? r.duration ?? 0;
    return duration > 0 ? Math.min(1, item.position / duration) : 0;
  }
  return Math.min(1, Math.max(0, item.position));
}

/** Description and length of a Markdown document, cached by modification time. */
const factsCache = new Map<string, { mtime: number; description: string | null; words: number }>();
async function docFacts(
  path: string,
): Promise<{ description: string | null; words: number } | null> {
  try {
    const { mtimeMs } = await stat(path);
    const hit = factsCache.get(path);
    if (hit && hit.mtime === mtimeMs) return hit;
    const info = docInfo(await readFile(path, 'utf8'));
    const value = { mtime: mtimeMs, description: info.description, words: info.words };
    factsCache.set(path, value);
    return value;
  } catch {
    return null;
  }
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
