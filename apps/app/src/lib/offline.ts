import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Resource, TopicDetail } from '@studyo/api';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { api, fileUrl } from './api';

/**
 * Offline on web (docs/offline-brief.md). The service worker (public/sw.js) keeps the app and every server
 * answer it sees; this module saves a whole topic ahead of time: its data, every doc with its images, maths and
 * diagrams, and its audio. Files go into the same cache the worker reads, keyed without the file token.
 */

/** Must match FILES_CACHE in public/sw.js. */
const FILES_CACHE = 'files-v1';

export const offlineSupported = () =>
  Platform.OS === 'web' && typeof window !== 'undefined' && 'caches' in window;

export function registerServiceWorker() {
  if (__DEV__ || Platform.OS !== 'web' || typeof navigator === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

/** `https://host/f/<token>/a/b` → `https://host/f/_/a/b`, as the worker keys it. */
export function fileKey(url: string): string {
  const u = new URL(url);
  const m = u.pathname.match(/^(.*?\/f\/)[^/]+\/(.+)$/);
  return m ? `${u.origin}${m[1]}_/${m[2]}` : `${u.origin}${u.pathname}`;
}

interface SavedTopic {
  at: string;
  bytes: number;
  /** Cache keys saved for this topic, so Remove can delete them. */
  keys: string[];
  /** What the topic looked like when saved; a different one means there is something new to save. */
  signature: string;
}

interface OfflineState {
  topics: Record<string, SavedTopic>;
  /** Topics being saved right now (not persisted). */
  saving: Record<string, { done: number; total: number; error?: string }>;
}

export const useOffline = create<OfflineState>()(
  persist((): OfflineState => ({ topics: {}, saving: {} }), {
    name: 'studyo-offline',
    storage: createJSONStorage(() => AsyncStorage),
    partialize: (s) => ({ topics: s.topics }) as OfflineState,
  }),
);

/** The resources a saved copy depends on; changes when docs or audio are added, replaced or removed. */
export function topicSignature(d: TopicDetail): string {
  return JSON.stringify(offlineResources(d.topic.resources).map((r) => [r.id, r.size ?? null]));
}

const offlineResources = (resources: Resource[]) =>
  resources.filter((r) => r.type === 'pack' || r.type === 'condensed' || r.type === 'audio');

/** Rough size of a topic's audio, to show before saving. */
export const audioBytes = (d: TopicDetail) =>
  d.topic.resources.filter((r) => r.type === 'audio').reduce((n, r) => n + (r.size ?? 0), 0);

function setSaving(id: string, v: OfflineState['saving'][string] | null) {
  useOffline.setState((s) => {
    const saving = { ...s.saving };
    if (v) saving[id] = v;
    else delete saving[id];
    return { saving };
  });
}

/** Save a topic for offline use. Safe to run again: it replaces what was saved. */
export async function saveTopic(id: string): Promise<void> {
  if (!offlineSupported() || useOffline.getState().saving[id]) return;
  setSaving(id, { done: 0, total: 1 });
  try {
    await navigator.storage?.persist?.().catch(() => false);
    const cache = await caches.open(FILES_CACHE);
    // The screens that lead here, so the app can open and find the topic offline.
    const server = await api.server();
    await Promise.allSettled([api.topics(), api.courses(), api.profile(), api.settings()]);
    const detail = await api.topic(id);
    const topic = detail.topic;
    if (topic.course) {
      await Promise.allSettled([api.course(topic.course.course_id)]);
    }
    const token = server.file_token;
    const url = (path: string) => fileUrl(token, path);
    const topicPath = (p: string) => `topics/${id}/${p}`;

    // Every file to save: docs first (small), then their assets, then audio.
    const files: string[] = [];
    const docs = topic.resources.filter((r) => r.type === 'pack' || r.type === 'condensed');
    for (const r of docs) {
      const rendered = await api.rendered(id, r.id).catch(() => null);
      if (rendered) files.push(url(rendered.html_path));
    }
    if (topic.cover_path) files.push(url(topicPath(topic.cover_path)));
    const audio = topic.resources
      .filter((r) => r.type === 'audio')
      .map((r) => url(topicPath(r.path)));

    const keys = new Set<string>();
    let bytes = 0;
    let done = 0;
    let total = files.length + audio.length;
    const progress = () => setSaving(id, { done, total });
    progress();

    /** `external`: not a library file (Google Fonts), kept under its own URL. */
    const save = async (u: string, external = false): Promise<Response> => {
      const res = await fetch(u, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) {
        const name = decodeURIComponent(u.split('/').pop() ?? u);
        throw new Error(`Couldn't download ${name} (${res.status}).`);
      }
      const key = external ? u : fileKey(u);
      bytes += Number(res.headers.get('content-length') ?? 0);
      await cache.put(key, res.clone());
      keys.add(key);
      return res;
    };

    // Docs, and what each one loads: images, KaTeX, mermaid, fonts.
    const assets = new Set<string>();
    for (const u of files) {
      const res = await save(u);
      if (u.endsWith('.html')) for (const a of docAssets(await res.text(), u)) assets.add(a);
      done++;
      progress();
    }
    total += assets.size;
    progress();
    for (const a of assets) {
      try {
        if (a.includes('fonts.googleapis.com')) {
          const css = await (await save(a, true)).text();
          for (const f of latinFonts(css)) await save(f, true).catch(() => {});
        } else {
          const res = await save(a);
          if (a.endsWith('.css')) {
            for (const f of cssFonts(await res.text(), a)) await save(f).catch(() => {});
          }
        }
      } catch {
        // A missing image or font leaves a gap in the page, not a failed download.
      }
      done++;
      progress();
    }
    for (const u of audio) {
      await save(u);
      done++;
      progress();
    }

    useOffline.setState((s) => ({
      topics: {
        ...s.topics,
        [id]: {
          at: new Date().toISOString(),
          bytes,
          keys: [...keys],
          signature: topicSignature(detail),
        },
      },
    }));
    setSaving(id, null);
  } catch (e) {
    setSaving(id, {
      done: 0,
      total: 0,
      error:
        e instanceof Error && e.message
          ? e.message
          : "Couldn't save this topic. Check the connection.",
    });
  }
}

/** Forget a topic's offline copy. Files another saved topic also uses (KaTeX, fonts) stay. */
export async function removeTopic(id: string): Promise<void> {
  const saved = useOffline.getState().topics[id];
  if (!saved) return;
  const shared = new Set(
    Object.entries(useOffline.getState().topics)
      .filter(([other]) => other !== id)
      .flatMap(([, t]) => t.keys),
  );
  if (offlineSupported()) {
    const cache = await caches.open(FILES_CACHE);
    await Promise.all(saved.keys.filter((k) => !shared.has(k)).map((k) => cache.delete(k)));
  }
  useOffline.setState((s) => {
    const { [id]: _, ...rest } = s.topics;
    return { topics: rest };
  });
}

/** Assets a rendered doc loads: images, stylesheets (KaTeX), the mermaid script, Google Fonts. */
export function docAssets(html: string, htmlUrl: string): string[] {
  const out = new Set<string>();
  const add = (ref: string) => {
    if (!ref || ref.startsWith('data:') || ref.startsWith('#')) return;
    try {
      out.add(new URL(ref.replace(/&amp;/g, '&'), htmlUrl).toString());
    } catch {}
  };
  for (const m of html.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)) add(m[1]);
  for (const m of html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)) add(m[1]);
  const mermaid = html.match(/"mermaid":"([^"]+)"/);
  if (mermaid) add(mermaid[1]);
  return [...out];
}

/** Font files a stylesheet points to (KaTeX), woff2 only. */
function cssFonts(css: string, cssUrl: string): string[] {
  return [...css.matchAll(/url\(([^)]+\.woff2)\)/g)].map((m) =>
    new URL(m[1].replace(/["']/g, ''), cssUrl).toString(),
  );
}

/** The Latin subsets in a Google Fonts stylesheet (the others are for scripts the docs don't use). */
function latinFonts(css: string): string[] {
  return [...css.matchAll(/\/\*\s*latin\s*\*\/[^}]*?url\(([^)]+)\)/g)].map((m) => m[1]);
}

/** Bytes as a short size. */
export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0)} MB`;
}
