import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { cleanTail } from './clean-tail.ts';
import type { VoiceEngine, WaitInfo } from './engine.ts';
import type { Script, Segment } from './script.ts';

/** About ten minutes of speech: a long request is cheaper in quota, a short one is safer to retry. */
const MAX_CHARS_PER_REQUEST = 9000;
const GAP_SECONDS = 0.9;

/** Find ffmpeg: an explicit path, PATH, then the usual Homebrew spots (a login item's PATH is short). */
export function findFfmpeg(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [
    env.STUDYO_FFMPEG,
    ...(env.PATH ?? '').split(delimiter).map((d) => (d ? join(d, 'ffmpeg') : '')),
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
  ];
  return candidates.find((p) => p && existsSync(p)) ?? null;
}

export interface RenderProgress {
  /** Requests finished so far, and in all. */
  done: number;
  total: number;
  part: number;
  parts: number;
}

export interface RenderOptions {
  script: Script;
  engine: VoiceEngine;
  ffmpeg: string;
  /** Where the finished m4a goes. */
  outPath: string;
  /** Finished requests are kept here, so a retry after a failure does not pay for them twice. */
  cacheDir: string;
  signal: AbortSignal;
  onProgress: (p: RenderProgress) => void;
  onWait: (w: WaitInfo) => void;
}

export interface RenderedPart {
  n: number;
  title: string;
  start: number;
  end: number;
}

export interface RenderResult {
  duration: number;
  parts: RenderedPart[];
  trimmedBursts: number;
}

function chunksOf(segments: Segment[]): Segment[][] {
  const out: Segment[][] = [];
  let cur: Segment[] = [];
  let n = 0;
  for (const s of segments) {
    if (cur.length && n + s.text.length > MAX_CHARS_PER_REQUEST) {
      out.push(cur);
      cur = [];
      n = 0;
    }
    cur.push(s);
    n += s.text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

const toFloat = (pcm: Buffer) => {
  const x = new Float32Array(Math.floor(pcm.length / 2));
  for (let i = 0; i < x.length; i++) x[i] = pcm.readInt16LE(i * 2) / 32768;
  return x;
};

function toPcm(x: Float32Array): Buffer {
  const b = Buffer.alloc(x.length * 2);
  for (let i = 0; i < x.length; i++) {
    const v = Math.max(-1, Math.min(1, x[i] as number));
    b.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  return b;
}

/** Speak a script: one request per slice of each part, cached, tails trimmed, joined and encoded with chapters. */
export async function renderScript(o: RenderOptions): Promise<RenderResult> {
  mkdirSync(o.cacheDir, { recursive: true });
  mkdirSync(dirname(o.outPath), { recursive: true });
  const raw = `${o.outPath}.pcm.tmp`;
  rmSync(raw, { force: true });

  const byPart = new Map<number, Segment[]>();
  for (const s of o.script.segments) byPart.set(s.part, [...(byPart.get(s.part) ?? []), s]);
  const plan = [...byPart.entries()].sort((a, b) => a[0] - b[0]);
  const total = plan.reduce((n, [, segs]) => n + chunksOf(segs).length, 0);

  let done = 0;
  let sampleRate = 0;
  let written = 0; // samples
  let trimmedBursts = 0;
  const parts: RenderedPart[] = [];
  try {
    for (const [i, [n, segs]] of plan.entries()) {
      const start = written;
      let partEnd = written;
      for (const chunk of chunksOf(segs)) {
        if (o.signal.aborted) throw new Error('Cancelled');
        const key = createHash('sha1')
          .update(
            JSON.stringify([
              o.engine.id,
              o.engine.model,
              o.script.voices,
              chunk.map((s) => [s.speaker, s.text, s.tone]),
            ]),
          )
          .digest('hex')
          .slice(0, 20);
        const cached = join(o.cacheDir, `${key}.pcm`);
        const meta = join(o.cacheDir, `${key}.rate`);
        let pcm: Buffer;
        if (existsSync(cached) && existsSync(meta)) {
          pcm = readFileSync(cached);
          sampleRate = Number(readFileSync(meta, 'utf8'));
        } else {
          const r = await o.engine.render({
            segments: chunk,
            voices: o.script.voices,
            signal: o.signal,
            onWait: o.onWait,
          });
          pcm = r.pcm;
          sampleRate = r.sampleRate;
          writeFileSync(cached, pcm);
          writeFileSync(meta, String(sampleRate));
        }
        const { audio, trimmedSeconds } = cleanTail(toFloat(pcm), sampleRate);
        if (trimmedSeconds > 0) trimmedBursts++;
        const gap = new Float32Array(Math.round(GAP_SECONDS * sampleRate));
        appendFileSync(raw, Buffer.concat([toPcm(audio), toPcm(gap)]));
        partEnd = written + audio.length;
        written += audio.length + gap.length;
        done++;
        o.onProgress({ done, total, part: i + 1, parts: plan.length });
      }
      parts.push({
        n,
        title: o.script.parts.find((p) => p.n === n)?.title ?? `Part ${n}`,
        start: start / sampleRate,
        end: partEnd / sampleRate,
      });
    }

    // Chapter markers are not embedded: the parts live in the audio's notes file, which the library reads.
    // (ffmpeg's chapters make the app's metadata parser fail on a faststart file.)
    const tmpOut = `${o.outPath}.tmp.m4a`;
    try {
      await run(
        o.ffmpeg,
        [
          '-y',
          '-loglevel',
          'error',
          '-f',
          's16le',
          '-ar',
          String(sampleRate),
          '-ac',
          '1',
          '-i',
          raw,
          '-metadata',
          `title=${o.script.title.replace(/[\n\r]/g, ' ')}`,
          '-c:a',
          'aac',
          '-b:a',
          '64k',
          '-movflags',
          '+faststart',
          tmpOut,
        ],
        o.signal,
      );
      renameSync(tmpOut, o.outPath);
    } finally {
      rmSync(tmpOut, { force: true });
    }
    return { duration: written / sampleRate, parts, trimmedBursts };
  } finally {
    rmSync(raw, { force: true });
  }
}

function run(cmd: string, args: string[], signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], signal });
    let err = '';
    child.stderr.on('data', (d) => {
      err += String(d);
    });
    child.on('error', (e) => reject(signal.aborted ? new Error('Cancelled') : e));
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${err.trim().slice(-300)}`)),
    );
  });
}
