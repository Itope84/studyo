import type { Config } from '../config.ts';
import type { VoiceEngine } from './engine.ts';
import { fakeEngine, geminiEngine } from './gemini.ts';
import { findFfmpeg } from './render.ts';

export interface Voice {
  engine: VoiceEngine;
  ffmpeg: string | null;
  /** Null when audio can be made; otherwise one plain sentence on what is missing. */
  unavailable(): string | null;
}

/** The voice the server uses: Gemini, or a silent stand-in when replaying scripts (tests, demos). */
export function createVoice(config: Config, env: NodeJS.ProcessEnv = process.env): Voice {
  const engine = config.replayDir
    ? fakeEngine()
    : geminiEngine({
        apiKey: () => process.env.GEMINI_API_KEY?.trim() || undefined,
        model: env.STUDYO_VOICE_MODEL || 'gemini-3.8-flash-tts',
        voices: {
          narrator: env.STUDYO_VOICE_NARRATOR || 'Charon',
          host: env.STUDYO_VOICE_HOST || 'Charon',
          cohost: env.STUDYO_VOICE_COHOST || 'Aoede',
        },
      });
  const ffmpeg = findFfmpeg(env);
  return {
    engine,
    ffmpeg,
    unavailable: () =>
      engine.unavailable() ??
      (ffmpeg ? null : "ffmpeg isn't installed on the server (brew install ffmpeg)."),
  };
}

export { renderScript } from './render.ts';
export { parseScript, type Script } from './script.ts';
