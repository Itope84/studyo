import { courseIdOf, isCourseScope, type StudyoEvent } from '@studyo/api';
import { fetch as expoFetch } from 'expo/fetch';
import { AppState, Platform } from 'react-native';
import { create } from 'zustand';
import { authHeaders } from './api';
import { usePrefs } from './prefs';
import {
  appendChatDelta,
  appendJobLog,
  applyJob,
  keys,
  queryClient,
  upsertChatMessage,
} from './query';

type StreamStatus = 'idle' | 'connecting' | 'live' | 'down';

interface LiveState {
  status: StreamStatus;
  /** Whether the server answered recently (stream or request). `null` until we know. */
  reachable: boolean | null;
  lastError: string | null;
  /** Cloudflare Access wants the person to sign in again. */
  accessExpired: boolean;
  set: (
    patch: Partial<Pick<LiveState, 'status' | 'reachable' | 'lastError' | 'accessExpired'>>,
  ) => void;
}

export const useLive = create<LiveState>((set) => ({
  status: 'idle',
  reachable: null,
  lastError: null,
  accessExpired: false,
  set: (patch) => set(patch),
}));

const streamFetch: typeof globalThis.fetch =
  Platform.OS === 'web'
    ? (...a) => globalThis.fetch(...a)
    : (expoFetch as unknown as typeof globalThis.fetch);

/**
 * One SSE connection per app. The stream only announces changes; on every start and resume the app also
 * refetches snapshots, so nothing depends on the stream having stayed open (see packages/api/events.md).
 */
class EventStream {
  private controller: AbortController | null = null;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  start() {
    if (this.running) return;
    this.running = true;
    void this.connect();
  }

  stop() {
    this.running = false;
    this.controller?.abort();
    if (this.timer) clearTimeout(this.timer);
    useLive.getState().set({ status: 'idle' });
  }

  /** The resume procedure: snapshot active jobs, refetch what's on screen, reconnect if needed. */
  resume() {
    void queryClient.invalidateQueries({ queryKey: keys.activeJobs });
    void queryClient.invalidateQueries({ type: 'active' });
    if (useLive.getState().status !== 'live') this.reconnectNow();
  }

  reconnectNow() {
    this.controller?.abort();
    if (this.timer) clearTimeout(this.timer);
    this.retry = 0;
    if (this.running) void this.connect();
  }

  private schedule() {
    if (!this.running) return;
    const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
    this.timer = setTimeout(() => void this.connect(), delay);
  }

  private async connect() {
    const conn = usePrefs.getState().connection;
    if (!conn || !this.running) return;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const live = useLive.getState();
    live.set({ status: 'connecting' });
    const last = usePrefs.getState().lastEventId;
    const headers: Record<string, string> = { ...authHeaders(conn), Accept: 'text/event-stream' };
    if (last != null) headers['Last-Event-ID'] = String(last);
    try {
      const res = await streamFetch(`${conn.url}/events${last != null ? `?after=${last}` : ''}`, {
        headers,
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`Event stream answered ${res.status}`);
      live.set({ status: 'live', reachable: true, lastError: null });
      this.retry = 0;
      // A fresh connection may have missed changes while it was down.
      void queryClient.invalidateQueries({ queryKey: keys.activeJobs });
      await this.read(res.body);
      if (!controller.signal.aborted) throw new Error('Event stream closed');
    } catch (e) {
      if (controller.signal.aborted && !this.running) return;
      if (controller.signal.aborted && this.controller !== controller) return;
      live.set({ status: 'down', lastError: (e as Error).message });
      this.schedule();
    }
  }

  private async read(body: ReadableStream<Uint8Array>) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let data = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        if (line === '') {
          if (data) this.dispatch(data);
          data = '';
        } else if (line.startsWith('data:')) {
          data += (data ? '\n' : '') + line.slice(5).trimStart();
        }
        nl = buffer.indexOf('\n');
      }
    }
  }

  private dispatch(raw: string) {
    let e: StudyoEvent;
    try {
      e = JSON.parse(raw) as StudyoEvent;
    } catch {
      return;
    }
    usePrefs.getState().setLastEventId(e.id);
    switch (e.type) {
      case 'job.updated': {
        const job = e.data.job;
        applyJob(job);
        if (job.status !== 'running' || job.lane === 'work') invalidateScope(job.topic_id, false);
        if (job.status !== 'running') void queryClient.invalidateQueries({ queryKey: keys.topics });
        break;
      }
      case 'job.log':
        appendJobLog(e.data.job_id, e.data.line);
        break;
      case 'chat.delta':
        appendChatDelta(e.data.topic_id, e.data.message_id, e.data.text);
        break;
      case 'chat.message':
        upsertChatMessage(e.data.topic_id, e.data.message);
        break;
      case 'topic.updated':
        invalidateScope(e.data.topic_id);
        break;
      case 'topic.removed':
        void queryClient.invalidateQueries({ queryKey: keys.topics });
        break;
      case 'inbox.updated':
        void queryClient.invalidateQueries({ queryKey: keys.inbox });
        void queryClient.invalidateQueries({ queryKey: keys.topics });
        break;
      case 'resync':
        void queryClient.invalidateQueries();
        break;
    }
  }
}

export const events = new EventStream();

/** Wire the resume procedure to the platform's foreground signal. Returns an unsubscribe. */
export function watchForeground(): () => void {
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const onVisible = () => {
      if (document.visibilityState === 'visible') events.resume();
    };
    const onOnline = () => events.resume();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('pageshow', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('pageshow', onOnline);
    };
  }
  const sub = AppState.addEventListener('change', (s) => {
    if (s === 'active') events.resume();
  });
  return () => sub.remove();
}

/**
 * A topic, chapter or course changed: refresh what shows it. A course scope id (`course--x`) refreshes that
 * course; any other id may be a chapter, so the course lists refresh too.
 */
function invalidateScope(id: string, topics = true) {
  const course = isCourseScope(id);
  if (course) void queryClient.invalidateQueries({ queryKey: keys.course(courseIdOf(id)) });
  else void queryClient.invalidateQueries({ queryKey: keys.topic(id) });
  void queryClient.invalidateQueries({ queryKey: keys.courses });
  void queryClient.invalidateQueries({ queryKey: ['course'] });
  void queryClient.invalidateQueries({ queryKey: keys.quizzes(id) });
  void queryClient.invalidateQueries({ queryKey: ['quiz', id] });
  void queryClient.invalidateQueries({ queryKey: keys.assignments(id) });
  void queryClient.invalidateQueries({ queryKey: ['assignment', id] });
  if (topics) void queryClient.invalidateQueries({ queryKey: keys.topics });
}
