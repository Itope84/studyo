import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { expectSchema, makeServer, TOKEN, waitFor } from './helpers.ts';

type Server = Awaited<ReturnType<typeof makeServer>>;
let s: Server;
afterEach(() => s?.close());

const jobStatus = async (id: string) => (await s.call('GET', `/jobs/${id}`)).json;

describe('server basics', () => {
  it('serves health without auth and refuses other calls without a token', async () => {
    s = await makeServer();
    expect((await s.app.request('/health')).status).toBe(200);
    const res = await s.app.request('/topics');
    expect(res.status).toBe(401);
    expectSchema('Error', await res.json());
  });

  it('lists the library and matches the contract', async () => {
    s = await makeServer();
    const list = await s.call('GET', '/topics');
    expect(list.status).toBe(200);
    expectSchema('TopicList', list.json);
    expect(list.json.topics[0].id).toBe('pc-ca-mcts');
    const detail = await s.call('GET', '/topics/pc-ca-mcts');
    expectSchema('TopicDetail', detail.json);
    const s1 = detail.json.topic.resources.find((r: { id: string }) => r.id === 'S1');
    expect(s1.url).toBe('https://blog.cloudflare.com/pq-ca-with-mtcs/');
    expectSchema('ServerInfo', (await s.call('GET', '/server')).json);
    expectSchema('Profile', (await s.call('GET', '/profile')).json);
  });

  it('renders documents on demand and serves them under the file token', async () => {
    s = await makeServer();
    const r = await s.call('GET', '/topics/pc-ca-mcts/resources/pack/rendered');
    expect(r.status).toBe(200);
    expectSchema('Rendered', r.json);
    const info = (await s.call('GET', '/server')).json;
    const page = await s.app.request(`/f/${info.file_token}/${r.json.html_path}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('studyo-renderer');
    expect((await s.app.request(`/f/wrong/${r.json.html_path}`)).status).toBe(401);
    expect((await s.app.request(`/f/${info.file_token}/_studyo/token`)).status).toBe(404);
  });

  it('answers Range requests', async () => {
    s = await makeServer();
    const res = await s.app.request('/files/topics/pc-ca-mcts/pack/assets/S1-fig1.png', {
      headers: { Authorization: `Bearer ${TOKEN}`, Range: 'bytes=10-19' },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toMatch(/^bytes 10-19\/\d+$/);
    expect((await res.arrayBuffer()).byteLength).toBe(10);
  });

  it('keeps the most recent progress write', async () => {
    s = await makeServer();
    const put = (position: number, updated: string) =>
      s.call('PUT', '/topics/pc-ca-mcts/progress', { resource_id: 'pack', position, updated });
    await put(0.5, '2026-10-03T10:00:00Z');
    const stale = await put(0.1, '2026-10-03T09:00:00Z');
    expect(stale.json.items.pack.position).toBe(0.5);
    expectSchema('Progress', stale.json);
    const home = (await s.call('GET', '/topics')).json;
    expect(home.continue.resource.id).toBe('pack');
  });

  it('uploads media into outputs with a title', async () => {
    s = await makeServer();
    const form = new FormData();
    form.append('file', new File([new Uint8Array(2048)], 'Deep Dive.mp3', { type: 'audio/mpeg' }));
    form.append('title', 'Deep dive');
    form.append('made_with', 'NotebookLM');
    const res = await s.call('POST', '/topics/pc-ca-mcts/resources', form);
    expect(res.status).toBe(201);
    expectSchema('Resource', res.json);
    expect(res.json).toMatchObject({
      type: 'audio',
      title: 'Deep dive',
      made_with: 'NotebookLM',
      path: 'outputs/deep-dive.mp3',
    });
    const manifest = JSON.parse(
      readFileSync(join(s.library, 'topics/pc-ca-mcts/topic.json'), 'utf8'),
    );
    expect(
      manifest.resources.some((r: { path: string }) => r.path === 'outputs/deep-dive.mp3'),
    ).toBe(true);
  });
});

describe('jobs', () => {
  it('runs an enrich job through a question and on to a rendered pack', async () => {
    s = await makeServer();
    const created = await s.call('POST', '/topics', {
      origin: { type: 'link', link: 'https://example.com/article' },
    });
    expect(created.status).toBe(201);
    expectSchema('TopicWithJob', created.json);
    const { topic, job } = created.json;
    expect(job.status).toBe('queued');

    const waiting = await waitFor(async () => {
      const j = await jobStatus(job.id);
      return j.status === 'needs_input' ? j : null;
    });
    expectSchema('JobDetail', waiting);
    expect(waiting.questions.questions[0].kind).toBe('multi');
    expect(
      waiting.log.some(
        (l: { kind: string; text: string }) => l.kind === 'progress' && l.text.includes('capture'),
      ),
    ).toBe(true);

    // The waiting job shows on every resume.
    const active = (await s.call('GET', '/jobs?active=true')).json.jobs;
    expect(active.map((j: { id: string }) => j.id)).toContain(job.id);

    // Chat is held while the topic's session waits.
    expect((await s.call('POST', `/topics/${topic.id}/chat`, { text: 'hi' })).status).toBe(409);

    const stale = await s.call('POST', `/jobs/${job.id}/answers`, {
      question_set_id: 'old',
      answers: {},
    });
    expect(stale.status).toBe(409);
    const answered = await s.call('POST', `/jobs/${job.id}/answers`, {
      question_set_id: waiting.questions.id,
      answers: { known: { selected: ['tls'] }, goal: { text: 'Explain it to a friend' } },
    });
    expect(answered.status).toBe(202);

    const done = await waitFor(async () => {
      const j = await jobStatus(job.id);
      return j.status === 'succeeded' ? j : null;
    });
    expect(done.error).toBeNull();
    const detail = (await s.call('GET', `/topics/${topic.id}`)).json;
    expect(detail.topic.status).toBe('ready');
    expect(detail.topic.session_id).toMatch(/^replay-/);
    const pack = detail.topic.resources.find((r: { type: string }) => r.type === 'pack');
    expect(pack.html_path).toBe('pack/pack.html');
    expect(existsSync(join(s.library, 'topics', topic.id, '_job/answers.json'))).toBe(true);

    // The event log can replay the whole run.
    const events = s.bus.replay(0) ?? [];
    const statuses = events
      .filter(
        (e) => e.type === 'job.updated' && (e.data as { job: { id: string } }).job.id === job.id,
      )
      .map((e) => (e.data as { job: { status: string } }).job.status);
    expect(statuses).toEqual(
      expect.arrayContaining(['queued', 'running', 'needs_input', 'succeeded']),
    );
  });

  it('streams a chat reply, keeps it, and offers to enrich', async () => {
    s = await makeServer();
    const sent = await s.call('POST', '/topics/pc-ca-mcts/chat', {
      text: 'What replaces the chain?',
    });
    expect(sent.status).toBe(202);
    expectSchema('ChatTurn', sent.json);
    await waitFor(async () => (await jobStatus(sent.json.job.id)).status === 'succeeded');
    const history = (await s.call('GET', '/topics/pc-ca-mcts/chat')).json;
    expectSchema('ChatHistory', history);
    const reply = history.messages.at(-1);
    expect(reply.status).toBe('complete');
    expect(reply.text).toMatch(/^Merkle Tree Certificates replace/);
    expect(reply.text).not.toContain('Let me check');
    expect(reply.text).not.toContain('suggest-enrich');
    expect(reply.suggest_enrich).toBe('How MTCs handle revocation');
    const deltas = (s.bus.replay(0) ?? []).filter((e) => e.type === 'chat.delta');
    expect(deltas.length).toBeGreaterThan(3);
  });

  it('writes a condensed doc and renders it', async () => {
    s = await makeServer();
    const job = (
      await s.call('POST', '/topics/pc-ca-mcts/jobs', { kind: 'condense', scope: 'all' })
    ).json;
    expectSchema('Job', job);
    await waitFor(async () => (await jobStatus(job.id)).status === 'succeeded');
    const detail = (await s.call('GET', '/topics/pc-ca-mcts')).json;
    const doc = detail.topic.resources.find((r: { id: string }) => r.id === 'condensed-all-demo');
    expect(doc.html_path).toBe('outputs/condensed-all-demo.html');
  });

  it('reports a failed run and keeps the pack usable', async () => {
    s = await makeServer();
    const job = (
      await s.call('POST', '/topics/pc-ca-mcts/jobs', { kind: 'enrich-deep', focus: 'revocation' })
    ).json;
    const failed = await waitFor(async () => {
      const j = await jobStatus(job.id);
      return j.status === 'failed' ? j : null;
    });
    expect(failed.error).toContain('overloaded');
    expect((await s.call('GET', '/topics/pc-ca-mcts')).json.topic.status).toBe('ready');
  });

  it('cancels a job waiting for answers', async () => {
    s = await makeServer();
    const { job, topic } = (
      await s.call('POST', '/topics', { origin: { type: 'topic', name: 'Raft consensus' } })
    ).json;
    await waitFor(async () => (await jobStatus(job.id)).status === 'needs_input');
    const cancelled = await s.call('POST', `/jobs/${job.id}/cancel`);
    expect(cancelled.json.status).toBe('cancelled');
    expect((await s.call('GET', `/topics/${topic.id}`)).json.topic.status).toBe('captured');
    expect(existsSync(join(s.library, 'topics', topic.id, '_job/questions.json'))).toBe(false);
  });

  it('replays missed events over SSE and asks for a resync when too far behind', async () => {
    s = await makeServer();
    s.bus.emit('inbox.updated', {});
    s.bus.emit('inbox.updated', {});
    const controller = new AbortController();
    const res = await s.app.request('/events?after=1', {
      headers: { Authorization: `Bearer ${TOKEN}` },
      signal: controller.signal,
    });
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain('id: 2');
    expect(text).toContain('event: inbox.updated');
    controller.abort();
    await reader.cancel().catch(() => {});

    const res2 = await s.app.request('/events?after=999', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const r2 = (res2.body as ReadableStream<Uint8Array>).getReader();
    const first = new TextDecoder().decode((await r2.read()).value);
    expect(first).toContain('event: resync');
    await r2.cancel().catch(() => {});
  });
});
