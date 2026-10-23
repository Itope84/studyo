import { describe, expect, it } from 'vitest';
import { Slots } from '../src/jobs/slots.ts';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('Slots', () => {
  it('hands out up to the cap and refuses the rest', () => {
    const slots = new Slots({ work: 2, chat: 1 });
    const a = () => {};
    const b = () => {};
    const c = () => {};
    expect(slots.take('work', a)).toBeTypeOf('function');
    expect(slots.take('work', b)).toBeTypeOf('function');
    expect(slots.take('work', c)).toBeNull();
    expect(slots.stats().work.used).toBe(2);
  });

  it('hands a released slot to the longest waiter, and nobody can jump the queue', async () => {
    const slots = new Slots({ work: 1, chat: 1 });
    const woken: string[] = [];
    const a = () => woken.push('a');
    const b = () => woken.push('b');
    const c = () => woken.push('c');
    const releaseA = slots.take('work', a)!;
    expect(slots.take('work', b)).toBeNull();
    slots.wait('work', b);
    slots.wait('work', b); // queued once
    expect(slots.take('work', c)).toBeNull();
    slots.wait('work', c);
    releaseA();
    await tick();
    expect(woken).toEqual(['b']);
    // c can't take it, and a fresh runner can't either
    expect(slots.take('work', c)).toBeNull();
    expect(slots.take('work', () => {})).toBeNull();
    const releaseB = slots.take('work', b)!;
    releaseB();
    await tick();
    expect(woken).toEqual(['b', 'c']);
    expect(slots.take('work', c)).toBeTypeOf('function');
  });

  it('release is idempotent', () => {
    const slots = new Slots({ work: 1, chat: 1 });
    const release = slots.take('work', () => {})!;
    release();
    release();
    expect(slots.stats().work.used).toBe(0);
  });

  it('passes the slot on when a woken runner has nothing to do', async () => {
    const slots = new Slots({ work: 1, chat: 1 });
    const woken: string[] = [];
    const b = () => woken.push('b');
    const c = () => woken.push('c');
    const release = slots.take('work', () => {})!;
    slots.wait('work', b);
    slots.wait('work', c);
    release();
    await tick();
    slots.decline('work', b);
    await tick();
    expect(woken).toEqual(['b', 'c']);
    expect(slots.take('work', c)).toBeTypeOf('function');
  });

  it('keeps lanes apart', () => {
    const slots = new Slots({ work: 1, chat: 1 });
    expect(slots.take('work', () => {})).toBeTypeOf('function');
    expect(slots.take('chat', () => {})).toBeTypeOf('function');
  });
});
