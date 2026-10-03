import { existsSync, mkdirSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type {
  ChapterRef,
  ChapterState,
  ChapterView,
  Course,
  CourseChapter,
  CourseStatus,
  CourseSummary,
  Job,
  Progress,
  Topic,
  TopicSummary,
} from '@studyo/api';
import { courseScope } from '@studyo/api';
import { type Library, titleFromFilename } from './library.ts';
import { notFound, nowIso, readJson, slugify, writeJsonAtomic } from './util.ts';

const ID = /^[a-z0-9][a-z0-9-]*$/;
const SOURCE_EXT = new Set(['.md', '.pdf', '.txt', '.html', '.htm']);

/** `course.json` as stored: the public shape without the derived `sources`. Unknown fields are kept. */
export type CourseManifest = Omit<Course, 'sources'> & Record<string, unknown>;

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [];

/**
 * Clean the chapter list a skill wrote: valid unique ids, order from position, prerequisites that exist and
 * never form a loop. The skills are told the rules, but the server never trusts a file it did not write.
 */
export function normaliseChapters(courseId: string, raw: unknown): CourseChapter[] {
  const list = Array.isArray(raw) ? (raw as Array<Partial<CourseChapter>>) : [];
  const used = new Set<string>();
  const chapters: CourseChapter[] = [];
  let n = 0;
  for (const c of list) {
    if (!c || typeof c.title !== 'string' || !c.title.trim()) continue;
    const kind = c.kind === 'prelim' ? 'prelim' : 'chapter';
    if (kind === 'chapter') n++;
    const order = kind === 'prelim' ? 0 : n;
    let id = typeof c.id === 'string' && ID.test(c.id) && c.id.length <= 64 ? c.id : '';
    if (!id) {
      id =
        kind === 'prelim'
          ? `${courseId}-prelim`
          : `${courseId}-${String(order).padStart(2, '0')}-${slugify(c.title, 30)}`;
    }
    for (let i = 2; used.has(id); i++) id = `${id.replace(/-\d+$/, '')}-${i}`;
    used.add(id);
    const sr = c.source_range;
    chapters.push({
      id,
      title: c.title.trim(),
      kind,
      order,
      summary: typeof c.summary === 'string' ? c.summary : null,
      prereqs: strings(c.prereqs),
      teaches: strings(c.teaches),
      assumes: strings(c.assumes),
      source_range:
        sr && typeof sr === 'object' && typeof sr.label === 'string'
          ? {
              source: typeof sr.source === 'string' && sr.source ? sr.source : null,
              label: sr.label,
              from: typeof sr.from === 'number' ? sr.from : null,
              to: typeof sr.to === 'number' ? sr.to : null,
            }
          : null,
    });
  }
  // The Prelim comes first; the rest keep the order they were written in.
  chapters.sort((a, b) => (a.kind === 'prelim' ? -1 : b.kind === 'prelim' ? 1 : 0));
  const ids = new Set(chapters.map((c) => c.id));
  for (const c of chapters)
    c.prereqs = [...new Set(c.prereqs)].filter((p) => ids.has(p) && p !== c.id);
  breakCycles(chapters);
  return chapters;
}

/** Drop the edge that closes a loop, so the prerequisite graph stays a DAG. */
function breakCycles(chapters: CourseChapter[]) {
  const byId = new Map(chapters.map((c) => [c.id, c]));
  const state = new Map<string, 1 | 2>();
  const visit = (id: string) => {
    state.set(id, 1);
    const c = byId.get(id) as CourseChapter;
    c.prereqs = c.prereqs.filter((p) => {
      if (state.get(p) === 1) return false;
      if (!state.has(p)) visit(p);
      return true;
    });
    state.set(id, 2);
  };
  for (const c of chapters) if (!state.has(c.id)) visit(c.id);
}

export const chapterRef = (courseId: string, c: CourseChapter): ChapterRef => ({
  course_id: courseId,
  kind: c.kind,
  order: c.order,
  summary: c.summary ?? null,
  prereqs: c.prereqs,
  teaches: c.teaches,
  assumes: c.assumes,
  source_range: c.source_range ?? null,
});

export function chapterState(topic: Topic, progress: Progress, building: boolean): ChapterState {
  if (building || topic.status === 'enriching') return 'building';
  const pack = topic.resources.find((r) => r.type === 'pack');
  if (!pack) return 'planned';
  if (progress.items[pack.id]?.done) return 'done';
  const touched = Object.values(progress.items).some((i) => i.position > 0 || i.done);
  return touched ? 'in_progress' : 'ready';
}

export class Courses {
  constructor(private library: Library) {}

  async readManifest(id: string): Promise<CourseManifest> {
    const raw = await readJson<Partial<CourseManifest>>(
      join(this.library.courseDir(id), 'course.json'),
    );
    if (!raw) throw notFound('Course');
    return {
      ...raw,
      id,
      title: raw.title || id,
      goal: raw.goal ?? null,
      status: raw.status ?? 'captured',
      origin: raw.origin ?? { type: 'topic', name: raw.title || id },
      summary: raw.summary ?? null,
      failure_reason: raw.failure_reason ?? null,
      chapters: normaliseChapters(id, raw.chapters),
      created: raw.created ?? nowIso(),
      updated: raw.updated ?? raw.created ?? nowIso(),
    } as CourseManifest;
  }

  writeManifest(id: string, manifest: CourseManifest) {
    const { sources: _derived, ...stored } = manifest as CourseManifest & { sources?: unknown };
    writeJsonAtomic(join(this.library.courseDir(id), 'course.json'), stored);
  }

  /** The manifest plus the central resources found in `sources/`. */
  async readCourse(id: string): Promise<Course> {
    const manifest = await this.readManifest(id);
    const dir = this.library.courseDir(id);
    const urls = await ledgerUrls(dir);
    const files = (await readdir(join(dir, 'sources')).catch(() => [] as string[]))
      .filter(
        (f) => !f.startsWith('_') && !f.startsWith('.') && SOURCE_EXT.has(extname(f).toLowerCase()),
      )
      .sort();
    const sources = files
      .filter((f) => !/\.html?$/.test(f) || !files.includes(f.replace(/\.html?$/, '.md')))
      .map((f) => ({
        path: `sources/${f}`,
        title: titleFromFilename(f),
        url: urls.get(f.split('-')[0] ?? '') ?? null,
      }));
    return { ...manifest, sources } as Course;
  }

  async create(input: {
    title: string;
    goal: string | null;
    origin: Course['origin'];
  }): Promise<CourseManifest> {
    let id = slugify(input.title, 40);
    for (let n = 2; existsSync(join(this.library.coursesDir, id)); n++)
      id = `${slugify(input.title, 36)}-${n}`;
    const dir = this.library.courseDir(id);
    for (const sub of ['sources', 'chat', 'quizzes'])
      mkdirSync(join(dir, sub), { recursive: true });
    const now = nowIso();
    const manifest: CourseManifest = {
      id,
      title: input.title,
      goal: input.goal,
      status: 'captured',
      origin: input.origin,
      summary: null,
      failure_reason: null,
      chapters: [],
      created: now,
      updated: now,
    };
    this.writeManifest(id, manifest);
    return manifest;
  }

  async setStatus(id: string, status: CourseStatus, failure: string | null = null) {
    const m = await this.readManifest(id);
    m.status = status;
    m.failure_reason = failure;
    m.updated = nowIso();
    this.writeManifest(id, m);
  }

  /**
   * Make a topic folder for every chapter in `course.json` that has none, and keep the chapter fields in step.
   * A chapter's pack and files are never touched here.
   */
  async materialise(id: string): Promise<string[]> {
    const manifest = await this.readManifest(id);
    const created: string[] = [];
    for (const c of manifest.chapters) {
      const ref = chapterRef(id, c);
      if (!(await this.library.exists(c.id))) {
        await this.library.createTopic({
          title: c.title,
          origin: { type: 'chapter', course_id: id },
          slugHint: c.title,
          exactId: c.id,
          course: ref,
        });
        created.push(c.id);
        continue;
      }
      const m = await this.library.readManifest(c.id);
      m.course = ref;
      this.library.writeManifest(c.id, m);
    }
    // Writing back normalised chapters keeps ids and prerequisites clean for the next skill run.
    this.writeManifest(id, manifest);
    return created;
  }

  async chapterViews(
    id: string,
    activeWork: (topicId: string) => Job | null,
    summary: (topicId: string, job: Job | null) => Promise<TopicSummary>,
  ): Promise<ChapterView[]> {
    const manifest = await this.readManifest(id);
    const views: ChapterView[] = [];
    const states = new Map<string, ChapterState>();
    for (const c of manifest.chapters) {
      if (!(await this.library.exists(c.id))) continue;
      const job = activeWork(c.id);
      const topic = await this.library.readTopic(c.id, { persist: false });
      const progress = await this.library.readProgress(c.id);
      const state = chapterState(topic, progress, !!job && job.status !== 'needs_input');
      states.set(c.id, state);
      views.push({
        id: c.id,
        title: c.title,
        kind: c.kind,
        order: c.order,
        summary: c.summary ?? null,
        state,
        prereqs: c.prereqs,
        unmet_prereqs: [],
        teaches: c.teaches,
        source_range: c.source_range ?? null,
        topic: await summary(c.id, job),
      });
    }
    for (const v of views) v.unmet_prereqs = v.prereqs.filter((p) => states.get(p) !== 'done');
    return views;
  }
}

export function summariseCourse(
  course: Course,
  views: ChapterView[],
  activeJob: Job | null,
): CourseSummary {
  const real = views.filter((v) => v.kind === 'chapter');
  const done = real.filter((v) => v.state === 'done').length;
  const next = views.find((v) => v.state !== 'done') ?? null;
  const planning = activeJob?.kind === 'course-outline';
  return {
    id: course.id,
    title: course.title,
    status: planning && course.status === 'captured' ? 'planning' : course.status,
    origin: course.origin,
    summary: course.summary ?? null,
    counts: {
      chapters: real.length,
      built: real.filter((v) => v.state !== 'planned' && v.state !== 'building').length,
      done,
    },
    progress: { fraction: real.length ? done / real.length : 0 },
    next_chapter: next ? { id: next.id, title: next.title, state: next.state } : null,
    failure_reason: course.failure_reason ?? null,
    active_job: activeJob,
    updated: course.updated,
  };
}

async function ledgerUrls(dir: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const text = await readFile(join(dir, 'sources', 'ledger.jsonl'), 'utf8').catch(() => '');
  for (const line of text.split('\n')) {
    try {
      const e = JSON.parse(line) as { id?: string; url?: string };
      if (e.id && e.url) map.set(e.id, e.url);
    } catch {
      // A half-written line from a running skill.
    }
  }
  return map;
}

export { courseScope };
