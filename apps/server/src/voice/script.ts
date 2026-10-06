/** The spoken script the `narrate` skill writes (skills/narrate/SKILL.md), checked and tidied by the server. */

export type Speaker = 'narrator' | 'host' | 'cohost';
export type Tone =
  | 'warm'
  | 'curious'
  | 'serious'
  | 'playful'
  | 'surprised'
  | 'reflective'
  | 'emphatic'
  | 'neutral';
export type Pace = 'slow' | 'normal' | 'fast';
export type Pause = 'none' | 'short' | 'medium' | 'long';

export interface Segment {
  id: string;
  part: number;
  speaker: Speaker;
  text: string;
  tone: Tone;
  pace: Pace;
  pause_after: Pause;
  emphasis: string[];
}

export interface Script {
  version: 1;
  title: string;
  voices: 1 | 2;
  /** Worked out here, from the text: the model's own figures are not trusted. */
  words: number;
  minutes: number;
  source_path: string | null;
  parts: { n: number; title: string }[];
  skipped: { item: string; reason: string }[];
  segments: Segment[];
}

const TONES: Tone[] = [
  'warm',
  'curious',
  'serious',
  'playful',
  'surprised',
  'reflective',
  'emphatic',
  'neutral',
];
const PACES: Pace[] = ['slow', 'normal', 'fast'];
const PAUSES: Pause[] = ['none', 'short', 'medium', 'long'];

/** Spoken words a minute, used only for the estimate shown before the real length is known. */
export const SPOKEN_WPM = 140;
/** A request this long is not a thought, it is a paragraph. */
const MAX_CHARS = 700;

/** Characters a speech engine would read aloud or choke on. Removed, not rejected, so one stray mark never costs a run. */
function tidy(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_#`[\]{}<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function countWords(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Parse and check a script. Structural problems are errors; style slips are corrected quietly. */
export function parseScript(
  raw: string,
  voices: 1 | 2,
): { script: Script; fixes: string[] } | { error: string } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { error: 'The script is not valid JSON.' };
  }
  const d = data as Record<string, unknown>;
  if (!d || typeof d !== 'object' || !Array.isArray(d.segments) || d.segments.length === 0)
    return { error: 'The script has no segments.' };

  const fixes: string[] = [];
  const segments: Segment[] = [];
  let lastPart = 1;
  for (const [i, s] of (d.segments as Record<string, unknown>[]).entries()) {
    const text = typeof s?.text === 'string' ? tidy(s.text) : '';
    if (!text) return { error: `Segment ${i + 1} has no text.` };
    if (text.length > MAX_CHARS)
      return {
        error: `Segment ${i + 1} is ${text.length} characters, too long to speak as one thought.`,
      };
    if (text !== s.text)
      fixes.push(`s${i + 1}: removed characters that would be spoken or confuse the voice`);
    const rawSpeaker = String(s.speaker ?? '');
    const speaker: Speaker =
      voices === 1 ? 'narrator' : rawSpeaker === 'cohost' ? 'cohost' : 'host';
    const part =
      Number.isInteger(s.part) && (s.part as number) >= lastPart ? (s.part as number) : lastPart;
    lastPart = part;
    segments.push({
      id: typeof s.id === 'string' && s.id ? s.id : `s${i + 1}`,
      part,
      speaker,
      text,
      tone: TONES.includes(s.tone as Tone) ? (s.tone as Tone) : 'neutral',
      pace: PACES.includes(s.pace as Pace) ? (s.pace as Pace) : 'normal',
      pause_after: PAUSES.includes(s.pause_after as Pause) ? (s.pause_after as Pause) : 'short',
      emphasis: Array.isArray(s.emphasis)
        ? s.emphasis.filter((w): w is string => typeof w === 'string').slice(0, 2)
        : [],
    });
  }

  const titled = new Map<number, string>();
  if (Array.isArray(d.parts))
    for (const p of d.parts as Record<string, unknown>[])
      if (Number.isInteger(p?.n) && typeof p?.title === 'string')
        titled.set(p.n as number, p.title);
  const partNumbers = [...new Set(segments.map((s) => s.part))];
  const parts = partNumbers.map((n) => ({ n, title: titled.get(n) ?? `Part ${n}` }));

  const words = segments.reduce((sum, s) => sum + countWords(s.text), 0);
  return {
    script: {
      version: 1,
      title: typeof d.title === 'string' && d.title.trim() ? d.title.trim() : 'Audio',
      voices,
      words,
      minutes: Math.round((words / SPOKEN_WPM) * 10) / 10,
      source_path: typeof d.source_path === 'string' ? d.source_path : null,
      parts,
      skipped: Array.isArray(d.skipped)
        ? (d.skipped as Record<string, unknown>[])
            .filter((x) => typeof x?.item === 'string')
            .map((x) => ({ item: String(x.item), reason: String(x.reason ?? '') }))
        : [],
      segments,
    },
    fixes,
  };
}
