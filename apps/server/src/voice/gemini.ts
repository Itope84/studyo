import { type RenderRequest, sleep, type VoiceEngine } from './engine.ts';
import type { Segment, Tone } from './script.ts';

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
/** Longest we will wait on one request's quota before giving up on the job. */
const MAX_WAIT_MS = 8 * 3600_000;

/** Delivery cues Gemini's multi-speaker mode reads from a tag in front of a turn. */
const TAGS: Partial<Record<Tone, string>> = {
  curious: '[curious] ',
  serious: '[serious] ',
  playful: '[playful] ',
  surprised: '[surprised] ',
  reflective: '[thoughtful] ',
  emphatic: '[emphatic] ',
  warm: '[warm] ',
};

const SPEAKER = { narrator: 'Narrator', host: 'Host', cohost: 'Cohost' } as const;

export interface GeminiOptions {
  apiKey: () => string | undefined;
  model: string;
  voices: { narrator: string; host: string; cohost: string };
}

interface GoogleError {
  error?: {
    code?: number;
    message?: string;
    details?: {
      '@type'?: string;
      retryDelay?: string;
      violations?: { quotaId?: string }[];
    }[];
  };
}

/** Gemini text-to-speech. One request per group of turns; the engine waits out rate limits itself. */
export function geminiEngine(o: GeminiOptions): VoiceEngine {
  const speechConfig = (voices: 1 | 2) =>
    voices === 2
      ? {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: [
              {
                speaker: 'Host',
                voiceConfig: { prebuiltVoiceConfig: { voiceName: o.voices.host } },
              },
              {
                speaker: 'Cohost',
                voiceConfig: { prebuiltVoiceConfig: { voiceName: o.voices.cohost } },
              },
            ],
          },
        }
      : { voiceConfig: { prebuiltVoiceConfig: { voiceName: o.voices.narrator } } };

  const parts = (segments: Segment[], voices: 1 | 2) =>
    voices === 2
      ? segments.map((s) => ({
          text: `${TAGS[s.tone] ?? ''}${s.text}`,
          speechMetadata: { speaker: SPEAKER[s.speaker] },
        }))
      : [{ text: segments.map((s) => `${TAGS[s.tone] ?? ''}${s.text}`).join(' ') }];

  return {
    id: 'gemini',
    label: 'Gemini',
    model: o.model,
    unavailable: () => (o.apiKey() ? null : 'Add GEMINI_API_KEY to the server settings (.env).'),

    async render({ segments, voices, signal, onWait }: RenderRequest) {
      const key = o.apiKey();
      if (!key) throw new Error('Add GEMINI_API_KEY to the server settings (.env).');
      const body = JSON.stringify({
        contents: [{ parts: parts(segments, voices) }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: speechConfig(voices) },
      });
      let waited = 0;
      let hiccups = 0;
      for (;;) {
        let res: Response;
        try {
          res = await fetch(`${API}/${o.model}:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
            body,
            signal,
          });
        } catch (e) {
          if (signal.aborted) throw new Error('Cancelled');
          if (++hiccups > 4) throw new Error(`Could not reach Gemini: ${(e as Error).message}`);
          const ms = 5000 * 3 ** (hiccups - 1);
          onWait({ kind: 'error', until: new Date(Date.now() + ms) });
          await sleep(ms, signal);
          continue;
        }
        if (res.ok) {
          const json = (await res.json()) as {
            candidates?: {
              content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] };
            }[];
          };
          const inline = json.candidates?.[0]?.content?.parts?.[0]?.inlineData;
          if (inline?.data) {
            const rate = Number(/rate=(\d+)/.exec(inline.mimeType ?? '')?.[1] ?? 24000);
            return { pcm: Buffer.from(inline.data, 'base64'), sampleRate: rate };
          }
          if (++hiccups > 3) throw new Error('Gemini returned no audio.');
          onWait({ kind: 'error', until: new Date(Date.now() + 5000) });
          await sleep(5000, signal);
          continue;
        }
        const err = (await res.json().catch(() => ({}))) as GoogleError;
        const message = err.error?.message ?? res.statusText;
        if (res.status === 429) {
          const daily = JSON.stringify(err).includes('PerDay');
          const hinted = err.error?.details
            ?.map((d) => /^(\d+(?:\.\d+)?)s$/.exec(d.retryDelay ?? '')?.[1])
            .find(Boolean);
          const ms = Math.ceil(Number(hinted ?? (daily ? 3600 : 30)) * 1000) + 15_000;
          waited += ms;
          if (waited > MAX_WAIT_MS)
            throw new Error('Gave up waiting for Gemini to allow more requests.');
          onWait({ kind: daily ? 'daily' : 'busy', until: new Date(Date.now() + ms) });
          await sleep(ms, signal);
          continue;
        }
        if (res.status >= 500) {
          if (++hiccups > 4) throw new Error(`Gemini is having problems (${res.status}).`);
          const ms = 5000 * 3 ** (hiccups - 1);
          onWait({ kind: 'error', until: new Date(Date.now() + ms) });
          await sleep(ms, signal);
          continue;
        }
        if (res.status === 400 && /api key/i.test(message))
          throw new Error('Gemini rejected the API key. Check GEMINI_API_KEY.');
        if (res.status === 403) throw new Error(`Gemini refused the request: ${message}`);
        throw new Error(`Gemini: ${message}`);
      }
    },
  };
}

/** A stand-in for tests and demos: a quiet tone per segment, no network, no key. */
export function fakeEngine(): VoiceEngine {
  const rate = 24000;
  return {
    id: 'fake',
    label: 'Test voice',
    model: 'fake-1',
    unavailable: () => null,
    async render({ segments }: RenderRequest) {
      const seconds = segments.reduce(
        (s, x) => s + Math.max(0.3, x.text.split(/\s+/).length / 20),
        0,
      );
      const n = Math.round(seconds * rate);
      const pcm = Buffer.alloc(n * 2);
      for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 20) * 2000), i * 2);
      return { pcm, sampleRate: rate };
    },
  };
}
