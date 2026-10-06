import { describe, expect, it } from 'vitest';
import { parseAnswer, skillFor, startPrompt } from '../src/jobs/prompts.ts';

describe('parseAnswer', () => {
  it('reads the quiz and enrich offers out of a reply', () => {
    const out = parseAnswer(
      'Because of the maths.\n\n[studyo:suggest-quiz] hash trees\n[studyo:suggest-enrich] ECC basics',
    );
    expect(out).toEqual({
      text: 'Because of the maths.',
      suggest: 'ECC basics',
      quiz: 'hash trees',
    });
  });

  it('leaves a plain answer alone', () => {
    expect(parseAnswer('Plain answer.')).toEqual({
      text: 'Plain answer.',
      suggest: null,
      quiz: null,
    });
  });
});

describe('audio prompt', () => {
  it('runs the narrate skill with the doc, scope, voices and where to write the script', () => {
    expect(skillFor('audio', null)).toBe('narrate');
    const text = startPrompt({
      kind: 'audio',
      topic: null,
      scope: 'demo',
      path: '/lib/topics/demo',
      coursePath: null,
      params: {
        source_path: 'outputs/condensed-all-2026-10-04.md',
        scope: ['One', 'Two'],
        voices: 2,
        output_path: 'outputs/audio/audio-x.script.json',
      },
    });
    expect(text).toContain('Run the Studyo skill `narrate`.');
    expect(text).toContain('- topic_path: /lib/topics/demo');
    expect(text).toContain('- source_path: outputs/condensed-all-2026-10-04.md');
    expect(text).toContain('- scope: One; Two');
    expect(text).toContain('- voices: 2');
    expect(text).toContain('- output_path: outputs/audio/audio-x.script.json');
    expect(text).toContain('- interactive: false');
  });
});
