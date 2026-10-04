import { describe, expect, it } from 'vitest';
import { parseAnswer } from '../src/jobs/prompts.ts';

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
