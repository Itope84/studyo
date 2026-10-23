type Lane = 'work' | 'chat';
type Wake = () => void;

/**
 * Server-wide cap on concurrent CLI runs per lane. Runners (one per user) that find no free slot queue up
 * and are handed a slot in the order they started waiting. A released slot goes straight to the next waiter,
 * so it never becomes free for someone else to jump the queue.
 */
export class Slots {
  private used: Record<Lane, number> = { work: 0, chat: 0 };
  private waiting: Record<Lane, Wake[]> = { work: [], chat: [] };
  /** Slots handed to a woken runner that hasn't picked them up yet (they still count as used). */
  private granted: Record<Lane, Set<Wake>> = { work: new Set(), chat: new Set() };

  constructor(private max: Record<Lane, number>) {}

  /** A slot for `who`: the one it was granted, or a free one if nobody is queued ahead. Null when it must wait. */
  take(lane: Lane, who: Wake): (() => void) | null {
    if (this.granted[lane].delete(who)) return this.releaser(lane);
    if (this.waiting[lane].length || this.used[lane] >= this.max[lane]) return null;
    this.used[lane]++;
    return this.releaser(lane);
  }

  /** Queue `who` (once) to be woken when a slot is handed to it. */
  wait(lane: Lane, who: Wake) {
    if (!this.waiting[lane].includes(who) && !this.granted[lane].has(who))
      this.waiting[lane].push(who);
  }

  /** A woken runner that no longer has work gives its slot back. Does nothing if it was granted none. */
  decline(lane: Lane, who: Wake) {
    const at = this.waiting[lane].indexOf(who);
    if (at >= 0) this.waiting[lane].splice(at, 1);
    if (this.granted[lane].delete(who)) this.free(lane);
  }

  stats(): Record<Lane, { used: number; max: number; waiting: number }> {
    return {
      work: { used: this.used.work, max: this.max.work, waiting: this.waiting.work.length },
      chat: { used: this.used.chat, max: this.max.chat, waiting: this.waiting.chat.length },
    };
  }

  private releaser(lane: Lane) {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.free(lane);
    };
  }

  private free(lane: Lane) {
    const next = this.waiting[lane].shift();
    if (next) {
      this.granted[lane].add(next);
      queueMicrotask(next);
    } else this.used[lane]--;
  }
}
