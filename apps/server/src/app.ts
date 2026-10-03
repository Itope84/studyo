import { timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type {
  AnswerSet,
  AssignInbox,
  ChatHistory,
  CliId,
  CreateJob,
  CreateTopic,
  Job,
  Profile,
  ProgressUpdate,
  PushSubscription,
  ServerInfo,
  Settings,
  TopicDetail,
  TopicList,
  TopicWithJob,
  UpdateTopic,
} from '@studyo/api';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { claudeAdapter } from './adapters/claude.ts';
import { opencodeAdapter } from './adapters/opencode.ts';
import { replayAdapter } from './adapters/replay.ts';
import type { CliAdapter } from './adapters/types.ts';
import { ChatStore } from './chat.ts';
import { type Config, VERSION } from './config.ts';
import { openDb } from './db.ts';
import { EventBus } from './events.ts';
import { serveFile } from './files.ts';
import { inboxKind, listInbox } from './inbox.ts';
import { Runner } from './jobs/runner.ts';
import { type JobRecord, JobStore, publicJob } from './jobs/store.ts';
import { Library, mediaTypeFor, titleFromFilename } from './library.ts';
import { markRead, readProfile, writeProfile } from './profile.ts';
import { Push } from './push.ts';
import { ensureRendered } from './render.ts';
import { SettingsStore } from './settings.ts';
import {
  badRequest,
  conflict,
  HttpError,
  notFound,
  nowIso,
  safeJoin,
  slugify,
  today,
} from './util.ts';
import { watchLibrary } from './watch.ts';

export interface ServerOptions {
  /** Replace the CLI adapters (tests). */
  adapters?: Partial<Record<CliId, CliAdapter>>;
  dbFile?: string;
  watch?: boolean;
}

const MAX_UPLOAD = 1024 * 1024 * 1024; // 1 GB

export async function createServer(config: Config, options: ServerOptions = {}) {
  mkdirSync(config.stateDir, { recursive: true });
  const library = new Library(config.library);
  const db = openDb(config.stateDir, options.dbFile);
  const bus = new EventBus(db);
  const store = new JobStore(db, bus);
  const chat = new ChatStore((id) => library.topicDir(id));
  const adapters: Record<CliId, CliAdapter> = config.replayDir
    ? {
        claude: replayAdapter(config.replayDir, 'claude'),
        opencode: replayAdapter(config.replayDir, 'opencode'),
      }
    : { claude: claudeAdapter(), opencode: opencodeAdapter() };
  Object.assign(adapters, options.adapters);

  const detected = Object.fromEntries(
    await Promise.all(Object.values(adapters).map(async (a) => [a.id, await a.detect()] as const)),
  ) as Record<CliId, { installed: boolean; version: string | null }>;
  const settings = new SettingsStore(
    config.stateDir,
    detected.claude.installed ? 'claude' : 'opencode',
  );
  const push = new Push(db, config.stateDir);
  const runner = new Runner({
    library,
    store,
    bus,
    chat,
    adapters,
    settings: () => settings.get(),
    notify: (job, topic) => void push.notifyJob(job, topic),
  });
  runner.start();
  const stopWatch = options.watch === false ? () => {} : watchLibrary(library, bus, store);

  const app = new Hono();

  app.use(
    '*',
    cors({
      origin: config.origins === '*' ? '*' : config.origins,
      allowHeaders: [
        'Authorization',
        'Content-Type',
        'Range',
        'Last-Event-ID',
        'CF-Access-Client-Id',
        'CF-Access-Client-Secret',
      ],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      exposeHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length'],
      maxAge: 600,
    }),
  );

  app.onError((err, c) => {
    if (err instanceof HttpError)
      return c.json({ error: { code: err.code, message: err.message } }, err.status);
    console.error(err);
    return c.json(
      { error: { code: 'internal', message: 'Something went wrong on the server.' } },
      500,
    );
  });
  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'No such endpoint.' } }, 404));

  const tokenBuf = Buffer.from(config.token);
  app.use('*', async (c, next) => {
    const path = c.req.path;
    if (c.req.method === 'OPTIONS' || path === '/health' || path.startsWith('/f/')) return next();
    const header = c.req.header('Authorization') ?? '';
    const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '');
    if (given.length !== tokenBuf.length || !timingSafeEqual(given, tokenBuf)) {
      throw new HttpError(401, 'unauthorized', 'The access token is missing or wrong.');
    }
    return next();
  });

  // ---- Server ---------------------------------------------------------------

  app.get('/health', (c) => c.json({ ok: true, name: 'studyo' as const, version: VERSION }));

  app.get('/server', async (c) => {
    const info: ServerInfo = {
      version: VERSION,
      file_token: config.fileToken,
      clis: Object.values(adapters).map((a) => ({
        id: a.id,
        label: a.label,
        installed: detected[a.id].installed,
        version: detected[a.id].version,
      })),
      settings: settings.get(),
      storage: { library_bytes: await librarySize(config.library) },
    };
    return c.json(info);
  });

  app.get('/settings', (c) => c.json(settings.get()));
  app.put('/settings', async (c) => {
    const body = await json<Settings>(c);
    if (body.cli && !detected[body.cli]?.installed)
      throw badRequest(`${body.cli} is not installed on the server.`);
    return c.json(settings.set(body));
  });

  // ---- Topics ---------------------------------------------------------------

  app.get('/topics', async (c) => {
    const includeArchived = c.req.query('include_archived') === 'true';
    const ids = await library.topicIds();
    const active = new Map(
      store.list({ active: true, lane: 'work', limit: 500 }).map((j) => [j.topic_id, j]),
    );
    const topics = [];
    for (const id of ids) {
      try {
        const job = active.get(id);
        const summary = await library.summary(id, job ? publicJob(job) : null);
        if (summary.status === 'archived' && !includeArchived) continue;
        topics.push(summary);
      } catch (e) {
        console.warn(`Skipping topic ${id}: ${(e as Error).message}`);
      }
    }
    topics.sort((a, b) => b.updated.localeCompare(a.updated));
    const body: TopicList = {
      topics,
      continue: await library.continueItem(ids),
      inbox_count: (await listInbox(config.library)).length,
    };
    return c.json(body);
  });

  app.post('/topics', async (c) => {
    const type = c.req.header('Content-Type') ?? '';
    let result: TopicWithJob;
    if (type.startsWith('multipart/form-data')) {
      const form = await c.req.parseBody();
      const file = form.file;
      if (!(file instanceof File)) throw badRequest('Attach a PDF as "file".');
      if (extname(file.name).toLowerCase() !== '.pdf')
        throw badRequest('Only PDF files can start a topic.');
      if (file.size > MAX_UPLOAD) throw new HttpError(413, 'too_large', 'That file is too large.');
      const title = String(form.title || '') || titleFromFilename(file.name);
      const safeName = `${slugify(basename(file.name, '.pdf'))}.pdf`;
      const manifest = await library.createTopic({
        title,
        origin: { type: 'pdf', file: `sources/${safeName}` },
        slugHint: title,
      });
      writeFileSync(
        join(library.topicDir(manifest.id), 'sources', safeName),
        Buffer.from(await file.arrayBuffer()),
      );
      result = await afterCreate(manifest.id, String(form.enrich ?? 'true') !== 'false');
    } else {
      const body = await json<CreateTopic>(c);
      const origin = body.origin;
      if (origin?.type === 'link') {
        let url: URL;
        try {
          url = new URL(String(origin.link));
        } catch {
          throw badRequest('That link is not a valid URL.');
        }
        if (!/^https?:$/.test(url.protocol))
          throw badRequest('Links must start with http or https.');
        const title = body.title?.trim() || prettyLinkTitle(url);
        const manifest = await library.createTopic({
          title,
          origin: { type: 'link', link: url.href },
          slugHint: title,
        });
        result = await afterCreate(manifest.id, body.enrich !== false);
      } else if (origin?.type === 'topic') {
        const name = String(origin.name ?? '').trim();
        if (name.length < 2) throw badRequest('Give the topic a name.');
        const manifest = await library.createTopic({
          title: body.title?.trim() || name,
          origin: { type: 'topic', name },
          slugHint: name,
        });
        result = await afterCreate(manifest.id, body.enrich !== false);
      } else {
        throw badRequest('origin.type must be link or topic (use multipart for a PDF).');
      }
    }
    return c.json(result, 201);
  });

  async function afterCreate(topicId: string, enrich: boolean): Promise<TopicWithJob> {
    let job: Job | null = null;
    if (enrich) job = publicJob(enqueue(topicId, 'enrich', {}));
    bus.emit('topic.updated', { topic_id: topicId });
    return { topic: await library.readTopic(topicId, { persist: true }), job };
  }

  function enqueue(
    topicId: string,
    kind: CreateJob['kind'] | 'answer',
    params: Record<string, unknown>,
  ): JobRecord {
    const job = store.create({ topic_id: topicId, kind, cli: settings.get().cli, params });
    runner.kick();
    return job;
  }

  app.get('/topics/:id', async (c) => {
    const id = c.req.param('id');
    const topic = await library.readTopic(id, { persist: !store.activeWork(id) });
    const jobs = store.list({ topic_id: id, limit: 10 });
    const active = jobs.filter((j) => ['queued', 'running', 'needs_input'].includes(j.status));
    const recent = jobs.filter((j) => !active.includes(j)).slice(0, 5);
    const body: TopicDetail = {
      topic,
      progress: await library.readProgress(id),
      jobs: [...active, ...recent].map(publicJob),
    };
    return c.json(body);
  });

  app.patch('/topics/:id', async (c) => {
    const id = c.req.param('id');
    const body = await json<UpdateTopic>(c);
    if (store.activeWork(id) && (body.title !== undefined || body.resource_order)) {
      throw conflict('Wait for the current job to finish before renaming or reordering.');
    }
    const m = await library.readManifest(id);
    if (body.title !== undefined) {
      if (!body.title.trim()) throw badRequest('The title cannot be empty.');
      m.title = body.title.trim();
    }
    if (body.archived === true) m.status = 'archived';
    if (body.archived === false && m.status === 'archived') {
      m.status = m.resources.some((r) => r.type === 'pack') ? 'ready' : 'captured';
    }
    if (body.resource_order) {
      const order = new Map(body.resource_order.map((rid, i) => [rid, i]));
      const indexed = m.resources.map((r, i) => ({ r, i }));
      indexed.sort((a, b) => (order.get(a.r.id) ?? 1e6 + a.i) - (order.get(b.r.id) ?? 1e6 + b.i));
      m.resources = indexed.map((x) => x.r);
    }
    m.updated = nowIso();
    library.writeManifest(id, m);
    bus.emit('topic.updated', { topic_id: id });
    return c.json(await library.readTopic(id, { persist: false }));
  });

  app.post('/topics/:id/resources', async (c) => {
    const id = c.req.param('id');
    if (!(await library.exists(id))) throw notFound('Topic');
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) throw badRequest('Attach the file as "file".');
    if (file.size > MAX_UPLOAD) throw new HttpError(413, 'too_large', 'That file is too large.');
    const ext = extname(file.name).toLowerCase();
    const type = mediaTypeFor(file.name) ?? (ext === '.md' ? 'condensed' : null);
    if (!type) throw badRequest('Add audio, video or a Markdown document.');
    const outDir = join(library.topicDir(id), 'outputs');
    mkdirSync(outDir, { recursive: true });
    let name = `${slugify(basename(file.name, ext), 60)}${ext}`;
    for (let n = 2; existsSync(join(outDir, name)); n++)
      name = `${slugify(basename(file.name, ext), 56)}-${n}${ext}`;
    writeFileSync(join(outDir, name), Buffer.from(await file.arrayBuffer()));
    // Discovery adds it to the manifest with its duration; then apply the title and made_with given.
    const topic = await library.readTopic(id, { persist: !store.activeWork(id) });
    const resource = topic.resources.find((r) => r.path === `outputs/${name}`);
    if (!resource)
      throw new HttpError(500, 'upload_failed', 'The file was saved but could not be added.');
    const title = String(form.title || '').trim();
    const madeWith = String(form.made_with || '').trim();
    if ((title || madeWith) && !store.activeWork(id)) {
      const m = await library.readManifest(id);
      const r = m.resources.find((x) => x.id === resource.id);
      if (r) {
        if (title) r.title = title;
        if (madeWith) r.made_with = madeWith;
        library.writeManifest(id, m);
      }
      if (title) resource.title = title;
      if (madeWith) resource.made_with = madeWith;
    }
    bus.emit('topic.updated', { topic_id: id });
    return c.json(resource, 201);
  });

  app.get('/topics/:id/resources/:rid/rendered', async (c) => {
    const id = c.req.param('id');
    const topic = await library.readTopic(id, { persist: false });
    const resource = topic.resources.find((r) => r.id === c.req.param('rid'));
    if (!resource) throw notFound('Document');
    return c.json(ensureRendered(library, id, resource));
  });

  app.post('/topics/:id/mark-read', async (c) => {
    const id = c.req.param('id');
    const topic = await library.readTopic(id, { persist: false });
    const profile = markRead(config.library, id, topic.learning?.gaps ?? []);
    return c.json(profile);
  });

  // ---- Files ----------------------------------------------------------------

  app.get('/files/*', async (c) => {
    const rel = decodeURIComponent(c.req.path.slice('/files/'.length));
    return serveFile(config.library, rel, c.req.header('Range'));
  });

  app.get('/f/:token/*', async (c) => {
    const given = Buffer.from(c.req.param('token'));
    const want = Buffer.from(config.fileToken);
    if (given.length !== want.length || !timingSafeEqual(given, want)) {
      throw new HttpError(401, 'unauthorized', 'The file link is not valid.');
    }
    const prefix = `/f/${c.req.param('token')}/`;
    const rel = decodeURIComponent(c.req.path.slice(prefix.length));
    return serveFile(config.library, rel, c.req.header('Range'));
  });

  // ---- Progress -------------------------------------------------------------

  app.get('/topics/:id/progress', async (c) => {
    const id = c.req.param('id');
    if (!(await library.exists(id))) throw notFound('Topic');
    return c.json(await library.readProgress(id));
  });

  app.put('/topics/:id/progress', async (c) => {
    const id = c.req.param('id');
    if (!(await library.exists(id))) throw notFound('Topic');
    const u = await json<ProgressUpdate>(c);
    if (!u.resource_id || typeof u.position !== 'number' || !u.updated) {
      throw badRequest('resource_id, position and updated are required.');
    }
    const progress = await library.readProgress(id);
    const prev = progress.items[u.resource_id];
    if (!prev || prev.updated <= u.updated) {
      progress.items[u.resource_id] = {
        position: Math.max(0, u.position),
        duration: u.duration ?? prev?.duration ?? null,
        section: u.section ?? prev?.section ?? null,
        done: u.done ?? prev?.done ?? false,
        updated: u.updated,
      };
      if (!progress.last || progress.last.updated <= u.updated) {
        progress.last = { resource_id: u.resource_id, updated: u.updated };
      }
      library.writeProgress(id, progress);
    }
    return c.json(progress);
  });

  // ---- Jobs -----------------------------------------------------------------

  app.post('/topics/:id/jobs', async (c) => {
    const id = c.req.param('id');
    const topic = await library.readTopic(id, { persist: false });
    const body = await json<CreateJob>(c);
    if (!['enrich', 'enrich-deep', 'condense'].includes(body.kind))
      throw badRequest('Unknown job kind.');
    if (store.activeWork(id))
      throw conflict('This topic already has a job running or waiting for you.');
    const hasPack = topic.resources.some((r) => r.type === 'pack');
    if ((body.kind === 'condense' || body.kind === 'enrich-deep') && !hasPack) {
      throw conflict('This topic has no pack yet. Enrich it first.');
    }
    if (!detected[settings.get().cli]?.installed) {
      throw conflict(
        `${settings.get().cli} is not installed on the server. Pick another CLI in Settings.`,
      );
    }
    const params: Record<string, unknown> = {};
    if (body.kind === 'condense') params.scope = body.scope ?? 'all';
    if (body.kind === 'enrich-deep' && body.focus) params.focus = body.focus;
    return c.json(publicJob(enqueue(id, body.kind, params)), 202);
  });

  app.get('/jobs', (c) => {
    const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
    const jobs = store.list({
      active: c.req.query('active') === 'true',
      topic_id: c.req.query('topic_id') || undefined,
      limit,
    });
    return c.json({ jobs: jobs.map(publicJob) });
  });

  app.get('/jobs/:id', (c) => {
    const job = store.get(c.req.param('id'));
    if (!job) throw notFound('Job');
    const lines = Math.min(Number(c.req.query('log_lines') ?? 200), 2000);
    return c.json({ ...publicJob(job), log: store.logLines(job.id, lines) });
  });

  app.post('/jobs/:id/answers', async (c) => {
    const body = await json<AnswerSet>(c);
    if (!body.question_set_id || typeof body.answers !== 'object')
      throw badRequest('question_set_id and answers are required.');
    const job = runner.answer(c.req.param('id'), body);
    if (!job) throw notFound('Job');
    return c.json(publicJob(job), 202);
  });

  app.post('/jobs/:id/cancel', async (c) => {
    const job = await runner.cancel(c.req.param('id'));
    if (!job) throw notFound('Job');
    return c.json(publicJob(job));
  });

  // ---- Chat -----------------------------------------------------------------

  const chatAvailability = async (
    id: string,
  ): Promise<{ available: boolean; reason: string | null }> => {
    const topic = await library.readTopic(id, { persist: false });
    const work = store.activeWork(id);
    if (work?.status === 'needs_input')
      return { available: false, reason: 'Answer the open question first; it holds this topic.' };
    if (work)
      return {
        available: false,
        reason: work.kind === 'condense' ? 'Writing a condensed doc…' : 'Enriching…',
      };
    if (
      !topic.resources.some(
        (r) => r.type === 'pack' || r.type === 'source' || r.type === 'condensed',
      )
    ) {
      return { available: false, reason: 'Nothing to ask about yet. Enrich the topic first.' };
    }
    if (!detected[settings.get().cli]?.installed)
      return { available: false, reason: 'The selected CLI is not installed.' };
    return { available: true, reason: null };
  };

  app.get('/topics/:id/chat', async (c) => {
    const id = c.req.param('id');
    if (!(await library.exists(id))) throw notFound('Topic');
    const { available, reason } = await chatAvailability(id);
    const body: ChatHistory = {
      messages: chat.read(id).messages,
      available,
      unavailable_reason: reason,
    };
    return c.json(body);
  });

  app.post('/topics/:id/chat', async (c) => {
    const id = c.req.param('id');
    if (!(await library.exists(id))) throw notFound('Topic');
    const { text } = await json<{ text: string }>(c);
    if (!text?.trim()) throw badRequest('Type a question.');
    const { available, reason } = await chatAvailability(id);
    if (!available) throw conflict(reason ?? 'Chat is not available right now.');
    const turn = chat.addTurn(id, text.trim());
    const job = enqueue(id, 'answer', { message_id: turn.assistant.id, question: text.trim() });
    const assistant =
      chat.updateMessage(id, turn.assistant.id, { job_id: job.id }) ?? turn.assistant;
    bus.emit('chat.message', { topic_id: id, message: turn.user });
    bus.emit('chat.message', { topic_id: id, message: assistant });
    return c.json({ user: turn.user, assistant, job: publicJob(job) }, 202);
  });

  // ---- Inbox ----------------------------------------------------------------

  app.get('/inbox', async (c) => c.json({ items: await listInbox(config.library) }));

  app.post('/inbox', async (c) => {
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) throw badRequest('Attach the file as "file".');
    if (file.size > MAX_UPLOAD) throw new HttpError(413, 'too_large', 'That file is too large.');
    const ext = extname(file.name).toLowerCase();
    let name = `${slugify(basename(file.name, ext), 80)}${ext}`;
    for (let n = 2; existsSync(join(library.inboxDir, name)); n++)
      name = `${slugify(basename(file.name, ext), 76)}-${n}${ext}`;
    writeFileSync(join(library.inboxDir, name), Buffer.from(await file.arrayBuffer()));
    bus.emit('inbox.updated', {});
    const item = (await listInbox(config.library)).find((i) => i.name === name);
    return c.json(item, 201);
  });

  app.post('/inbox/assign', async (c) => {
    const body = await json<AssignInbox>(c);
    if (!body.path?.startsWith('inbox/')) throw badRequest('path must be an inbox file.');
    const from = safeJoin(config.library, body.path);
    if (!existsSync(from)) throw notFound('Inbox file');
    const name = basename(from);
    const kind = inboxKind(name);
    let result: TopicWithJob;
    if (body.topic_id) {
      const id = body.topic_id;
      if (!(await library.exists(id))) throw notFound('Topic');
      const sub = kind === 'audio' || kind === 'video' ? 'outputs' : 'sources';
      mkdirSync(join(library.topicDir(id), sub), { recursive: true });
      renameSync(from, uniquePath(join(library.topicDir(id), sub), name));
      result = {
        topic: await library.readTopic(id, { persist: !store.activeWork(id) }),
        job: null,
      };
    } else if (body.new_topic) {
      if (kind !== 'pdf')
        throw badRequest(
          'Only a PDF can start a new topic. Assign other files to an existing topic.',
        );
      const title = body.new_topic.title?.trim() || titleFromFilename(name);
      const safeName = `${slugify(basename(name, '.pdf'))}.pdf`;
      const manifest = await library.createTopic({
        title,
        origin: { type: 'pdf', file: `sources/${safeName}` },
        slugHint: title,
      });
      renameSync(from, join(library.topicDir(manifest.id), 'sources', safeName));
      result = await afterCreate(manifest.id, body.new_topic.enrich !== false);
    } else {
      throw badRequest('Give a topic_id or new_topic.');
    }
    bus.emit('inbox.updated', {});
    bus.emit('topic.updated', { topic_id: result.topic.id });
    return c.json(result);
  });

  // ---- Profile --------------------------------------------------------------

  app.get('/profile', (c) => c.json(readProfile(config.library)));
  app.put('/profile', async (c) => {
    const body = await json<Profile>(c);
    if (!Array.isArray(body.knows) || typeof body.notes !== 'string')
      throw badRequest('knows and notes are required.');
    const valid = new Set(['self-reported', 'inferred', 'read', 'forgot']);
    const knows = body.knows
      .filter((k) => k && typeof k.term === 'string' && k.term.trim())
      .map((k) => ({
        ...k,
        term: k.term.trim(),
        via: valid.has(k.via) ? k.via : 'self-reported',
        date: k.date ?? today(),
      }));
    writeProfile(config.library, { knows, notes: body.notes });
    return c.json(readProfile(config.library));
  });

  // ---- Push -----------------------------------------------------------------

  app.get('/push/key', (c) => c.json({ public_key: push.publicKey }));
  app.post('/push/subscriptions', async (c) => {
    const body = await json<PushSubscription>(c);
    if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth)
      throw badRequest('Invalid subscription.');
    push.add(body);
    return c.body(null, 204);
  });
  app.delete('/push/subscriptions', async (c) => {
    const body = await json<{ endpoint: string }>(c);
    push.remove(body.endpoint);
    return c.body(null, 204);
  });

  // ---- Events ---------------------------------------------------------------

  app.get('/events', (c) => {
    const after = Number(c.req.header('Last-Event-ID') ?? c.req.query('after') ?? Number.NaN);
    c.header('X-Accel-Buffering', 'no');
    c.header('Cache-Control', 'no-cache, no-transform');
    return streamSSE(c, async (stream) => {
      const queue: Array<{ id: number; type: string; at: string; data: unknown }> = [];
      let wake: (() => void) | null = null;
      const unsubscribe = bus.subscribe((e) => {
        queue.push(e);
        wake?.();
      });
      let open = true;
      stream.onAbort(() => {
        open = false;
        unsubscribe();
        wake?.();
      });
      if (Number.isFinite(after)) {
        const missed = bus.replay(after);
        if (missed === null) {
          await stream.writeSSE({
            id: String(bus.latestId()),
            event: 'resync',
            data: JSON.stringify({ id: bus.latestId(), type: 'resync', at: nowIso(), data: {} }),
          });
        } else {
          const seen = new Set(missed.map((m) => m.id));
          queue.splice(0, queue.length, ...missed, ...queue.filter((q) => !seen.has(q.id)));
        }
      } else {
        await stream.write(`retry: 3000\n\n`);
      }
      const ping = setInterval(() => {
        void stream.write(': ping\n\n').catch(() => {});
      }, 20_000);
      try {
        while (open) {
          while (queue.length) {
            const e = queue.shift() as (typeof queue)[number];
            await stream.writeSSE({ id: String(e.id), event: e.type, data: JSON.stringify(e) });
          }
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          wake = null;
        }
      } finally {
        clearInterval(ping);
        unsubscribe();
      }
    });
  });

  const close = () => {
    runner.stop();
    stopWatch();
    db.close();
  };

  return { app, runner, bus, store, library, close, config };
}

async function json<T>(c: { req: { json: () => Promise<unknown> } }): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw badRequest('The request body must be JSON.');
  }
}

function prettyLinkTitle(url: URL): string {
  const last = url.pathname.split('/').filter(Boolean).pop();
  const words = last
    ? decodeURIComponent(last)
        .replace(/\.[a-z0-9]+$/i, '')
        .replace(/[-_]+/g, ' ')
        .trim()
    : '';
  if (words && words.length > 3) return words.charAt(0).toUpperCase() + words.slice(1);
  return url.hostname.replace(/^www\./, '');
}

function uniquePath(dir: string, name: string): string {
  const ext = extname(name);
  const stem = basename(name, ext);
  let candidate = join(dir, name);
  for (let n = 2; existsSync(candidate); n++) candidate = join(dir, `${stem}-${n}${ext}`);
  return candidate;
}

async function librarySize(root: string): Promise<number> {
  const { readdir, stat } = await import('node:fs/promises');
  let total = 0;
  const walk = async (dir: string) => {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.name === '_studyo' || e.name === '.claude') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) total += (await stat(p)).size;
    }
  };
  await walk(root);
  return total;
}
