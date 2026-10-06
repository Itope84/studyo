import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanTail } from '../src/voice/clean-tail.ts';
import { geminiEngine } from '../src/voice/gemini.ts';
import { findFfmpeg } from '../src/voice/render.ts';
import { parseScript } from '../src/voice/script.ts';
import { expectSchema, makeServer, waitFor } from './helpers.ts';

type Server = Awaited<ReturnType<typeof makeServer>>;
let s: Server;
afterEach(() => {
  s?.close();
  s = undefined as never;
});

const TOPIC = 'pc-ca-mcts';
const DOC = 'condensed-all-2026-10-03';
const jobStatus = async (id: string) => (await s.call('GET', `/jobs/${id}`)).json;
const resources = async () =>
  (await s.call('GET', `/topics/${TOPIC}`)).json.topic.resources as {
    id: string;
    type: string;
    title: string;
    path: string;
    source_id?: string | null;
    voices?: number | null;
    chapters?: { title: string; start: number }[] | null;
    duration?: number | null;
  }[];

async function makeAudio(body: Record<string, unknown> = {}) {
  const job = (
    await s.call('POST', `/topics/${TOPIC}/jobs`, { kind: 'audio', source: DOC, ...body })
  ).json;
  await waitFor(
    async () => ['succeeded', 'failed'].includes((await jobStatus(job.id)).status),
    20_000,
  );
  return jobStatus(job.id);
}

describe.skipIf(!findFfmpeg())('audio jobs', () => {
  it('says audio is available, and the job writes a script, speaks it and adds the audio', async () => {
    s = await makeServer();
    const info = (await s.call('GET', '/server')).json;
    expectSchema('ServerInfo', info);
    expect(info.audio.available).toBe(true);

    const done = await makeAudio();
    expectSchema('Job', done);
    expect(done.status).toBe('succeeded');
    const audio = (await resources()).find((r) => r.type === 'audio' && r.source_id === DOC);
    expect(audio?.title).toMatch(/^Audio: /);
    expect(audio?.voices).toBe(2);
    expect(audio?.duration ?? 0).toBeGreaterThan(1);
    // The parts come from the audio notes file, so the existing player shows them as chapters.
    expect(audio?.chapters?.map((c) => c.title)).toEqual(['What it is', 'Why it matters']);
    expect(existsSync(join(s.library, 'topics', TOPIC, 'outputs/audio'))).toBe(true);
    // The request cache is scratch and is cleared once the audio exists.
    expect(existsSync(join(s.library, 'topics', TOPIC, '_job/audio-cache'))).toBe(false);
  });

  it('refuses audio from something that is not a condensed doc, or with nothing to replace', async () => {
    s = await makeServer();
    const noDoc = await s.call('POST', `/topics/${TOPIC}/jobs`, { kind: 'audio', source: 'pack' });
    expect(noDoc.status).toBe(400);
    const badReplace = await s.call('POST', `/topics/${TOPIC}/jobs`, {
      kind: 'audio',
      source: DOC,
      replace: 'nope',
    });
    expect(badReplace.status).toBe(400);
  });

  it('keeps the audio when its doc is deleted, unless asked to delete it too', async () => {
    s = await makeServer();
    await makeAudio();
    // A second doc to delete, so the first one's audio is untouched either way.
    const condense = (
      await s.call('POST', `/topics/${TOPIC}/jobs`, { kind: 'condense', scope: 'all' })
    ).json;
    await waitFor(async () => (await jobStatus(condense.id)).status === 'succeeded');
    const second = (await resources()).find((r) => r.type === 'condensed' && r.id !== DOC) as {
      id: string;
    };
    expect((await s.call('DELETE', `/topics/${TOPIC}/resources/${DOC}`)).status).toBe(204);
    let after = await resources();
    expect(after.some((r) => r.id === DOC)).toBe(false);
    const audio = after.find((r) => r.type === 'audio' && r.source_id === DOC);
    expect(audio).toBeTruthy(); // kept
    await makeAudio({ source: second.id });
    const mine = (await resources()).find((r) => r.type === 'audio' && r.source_id === second.id);
    expect(
      (await s.call('DELETE', `/topics/${TOPIC}/resources/${second.id}?audio=true`)).status,
    ).toBe(204);
    after = await resources();
    expect(after.some((r) => r.id === mine?.id)).toBe(false); // gone with its doc
    expect(after.some((r) => r.id === audio?.id)).toBe(true); // the other one stays
  });

  it('regenerates audio on its own, replacing the old one only once the new one exists', async () => {
    s = await makeServer();
    await makeAudio();
    const first = (await resources()).find((r) => r.type === 'audio' && r.source_id === DOC) as {
      id: string;
    };
    await makeAudio({ replace: first.id });
    const audios = (await resources()).filter((r) => r.type === 'audio' && r.source_id === DOC);
    expect(audios).toHaveLength(1);
    expect(audios[0]?.id).not.toBe(first.id);
  });

  it('regenerating a doc can regenerate its audio too, and leaves the audio alone otherwise', async () => {
    s = await makeServer();
    await makeAudio();
    const oldAudio = (await resources()).find((r) => r.type === 'audio' && r.source_id === DOC) as {
      id: string;
    };
    // Unchecked: the doc is replaced, the audio is left as it was.
    let job = (
      await s.call('POST', `/topics/${TOPIC}/jobs`, {
        kind: 'condense',
        scope: 'all',
        replace: DOC,
      })
    ).json;
    await waitFor(async () => (await jobStatus(job.id)).status === 'succeeded');
    let now = await resources();
    expect(now.some((r) => r.id === oldAudio.id)).toBe(true);
    const newDoc = now.find((r) => r.type === 'condensed' && r.depth !== undefined) as {
      id: string;
    };

    // Checked: a second audio job follows and replaces the audio made from the replaced doc.
    await makeAudio({ source: newDoc.id, replace: oldAudio.id });
    job = (
      await s.call('POST', `/topics/${TOPIC}/jobs`, {
        kind: 'condense',
        scope: 'all',
        replace: newDoc.id,
        audio: true,
      })
    ).json;
    await waitFor(async () => (await jobStatus(job.id)).status === 'succeeded');
    await waitFor(async () => {
      const jobs = (await s.call('GET', `/jobs?topic_id=${TOPIC}`)).json.jobs as {
        kind: string;
        status: string;
      }[];
      return jobs.some((j) => j.kind === 'audio' && j.status === 'succeeded') &&
        !jobs.some((j) => ['queued', 'running'].includes(j.status))
        ? true
        : null;
    }, 20_000);
    now = await resources();
    const audios = now.filter((r) => r.type === 'audio' && r.source_id);
    expect(audios).toHaveLength(1);
    expect(now.some((r) => r.id === audios[0]?.source_id && r.type === 'condensed')).toBe(true);
  });

  it('deletes generated audio, and nothing else uploaded', async () => {
    s = await makeServer();
    await makeAudio();
    const made = (await resources()).find((r) => r.type === 'audio' && r.source_id) as {
      id: string;
    };
    expect((await s.call('DELETE', `/topics/${TOPIC}/resources/${made.id}`)).status).toBe(204);
    expect((await resources()).some((r) => r.id === made.id)).toBe(false);
    const uploaded = (await resources()).find((r) => r.type === 'audio' && !r.source_id);
    if (uploaded)
      expect((await s.call('DELETE', `/topics/${TOPIC}/resources/${uploaded.id}`)).status).toBe(
        400,
      );
  });
});

describe('audio script checks', () => {
  it('removes characters a voice would read aloud, and sets the speakers for the voice count', () => {
    const r = parseScript(
      JSON.stringify({
        title: 'T',
        segments: [
          {
            id: 'a',
            part: 1,
            speaker: 'cohost',
            text: 'See **this** [link](https://x.y) now.',
            tone: 'weird',
          },
          { part: 2, speaker: 'host', text: 'Second part.', pause_after: 'long' },
        ],
      }),
      1,
    );
    if ('error' in r) throw new Error(r.error);
    expect(r.script.segments.map((x) => x.speaker)).toEqual(['narrator', 'narrator']);
    expect(r.script.segments[0]?.text).toBe('See this link now.');
    expect(r.script.segments[0]?.tone).toBe('neutral');
    expect(r.script.parts).toEqual([
      { n: 1, title: 'Part 1' },
      { n: 2, title: 'Part 2' },
    ]);
    expect(r.script.words).toBe(6);
    expect(r.fixes.length).toBe(1);
  });

  it('rejects scripts that cannot be spoken', () => {
    expect('error' in parseScript('not json', 2)).toBe(true);
    expect('error' in parseScript('{"segments":[]}', 2)).toBe(true);
    expect('error' in parseScript('{"segments":[{"text":""}]}', 2)).toBe(true);
    expect(
      'error' in parseScript(JSON.stringify({ segments: [{ text: 'word '.repeat(200) }] }), 2),
    ).toBe(true);
  });
});

describe('noise burst at the end of a request', () => {
  const rate = 24000;
  const tone = (seconds: number, amp: number) =>
    Float32Array.from(
      { length: Math.round(seconds * rate) },
      (_, i) => Math.sin(i / 7) * amp * 1.414,
    );
  const join2 = (...parts: Float32Array[]) => {
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  };

  it('is cut, and speech is left alone', () => {
    const speech = tone(3, 0.15);
    const quiet = new Float32Array(Math.round(0.3 * rate));
    const burst = tone(0.2, 0.5);
    const { audio, trimmedSeconds } = cleanTail(join2(speech, quiet, burst), rate);
    expect(trimmedSeconds).toBeGreaterThan(0.3);
    expect(audio.length).toBeGreaterThan(speech.length);
    expect(audio.length).toBeLessThan(speech.length + quiet.length + 1);

    const clean = join2(speech, quiet, tone(0.2, 0.15));
    expect(cleanTail(clean, rate).trimmedSeconds).toBe(0);
  });
});

describe('Gemini engine', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const engine = () =>
    geminiEngine({
      apiKey: () => 'k',
      model: 'm',
      voices: { narrator: 'A', host: 'B', cohost: 'C' },
    });
  const segments = [
    {
      id: 's1',
      part: 1,
      speaker: 'host',
      text: 'Hello there.',
      tone: 'curious',
      pace: 'normal',
      pause_after: 'short',
      emphasis: [],
    },
  ] as never;

  it('waits out the daily limit and says when it will retry, then carries on', async () => {
    vi.useFakeTimers();
    const audio = Buffer.from([1, 0, 2, 0]).toString('base64');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 429,
              message: 'quota',
              details: [
                {
                  '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
                  violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }],
                },
                { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '3130s' },
              ],
            },
          }),
          { status: 429 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    { inlineData: { data: audio, mimeType: 'audio/L16;codec=pcm;rate=24000' } },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const waits: { kind: string; until: Date }[] = [];
    const run = engine().render({
      segments,
      voices: 2,
      signal: new AbortController().signal,
      onWait: (w) => waits.push(w),
    });
    await vi.advanceTimersByTimeAsync(3130_000 + 20_000);
    const out = await run;
    expect(waits).toHaveLength(1);
    expect(waits[0]?.kind).toBe('daily');
    expect(waits[0]!.until.getTime() - Date.now()).toBeLessThan(0); // the wait is over
    expect(out.pcm.length).toBe(4);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops waiting when cancelled', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: { code: 429, message: 'quota', details: [] } }), {
            status: 429,
          }),
        ),
    );
    const controller = new AbortController();
    const run = engine().render({
      segments,
      voices: 1,
      signal: controller.signal,
      onWait: () => {},
    });
    const caught = run.catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(1000);
    controller.abort();
    expect(await caught).toBe('Cancelled');
  });
});
