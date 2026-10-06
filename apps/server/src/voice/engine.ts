import type { Segment } from './script.ts';

/** Why a render is waiting, so the app can say it in plain words. */
export interface WaitInfo {
  /** `daily`: the day's free allowance is used up. `busy`: a short rate limit. `error`: a hiccup being retried. */
  kind: 'daily' | 'busy' | 'error';
  until: Date;
}

export interface RenderRequest {
  segments: Segment[];
  voices: 1 | 2;
  signal: AbortSignal;
  onWait: (w: WaitInfo) => void;
}

export interface VoiceEngine {
  id: string;
  label: string;
  /** The model, so a cached render is not reused after the model changes. */
  model: string;
  /** Null when ready; otherwise one plain sentence on what is missing. */
  unavailable(): string | null;
  /** Speak one group of segments (a slice of a part). 16-bit mono PCM. */
  render(req: RenderRequest): Promise<{ pcm: Buffer; sampleRate: number }>;
}

/** Sleep that ends early, and throws, when the signal aborts. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('Cancelled'));
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error('Cancelled'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
