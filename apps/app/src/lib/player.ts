import type { Resource } from '@studyo/api';
import { type AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { create } from 'zustand';
import { api, fileUrl } from './api';
import { usePrefs } from './prefs';
import { keys, queryClient } from './query';

export interface Track {
  topicId: string;
  topicTitle: string;
  resource: Resource;
  url: string;
}

interface PlayerState {
  track: Track | null;
  queue: Track[];
  playing: boolean;
  buffering: boolean;
  position: number;
  duration: number;
  error: string | null;
}

export const usePlayer = create<PlayerState>(() => ({
  track: null,
  queue: [],
  playing: false,
  buffering: false,
  position: 0,
  duration: 0,
  error: null,
}));

let player: AudioPlayer | null = null;
let lastSaved = 0;
let modeSet = false;

function ensurePlayer(): AudioPlayer {
  if (player) return player;
  player = createAudioPlayer(null, { updateInterval: 500 });
  player.addListener('playbackStatusUpdate', (s) => {
    usePlayer.setState({
      playing: s.playing,
      buffering: s.isBuffering,
      position: s.currentTime,
      duration: s.duration || usePlayer.getState().track?.resource.duration || 0,
      error: s.error ?? null,
    });
    if (s.playing && Date.now() - lastSaved > 10_000) void saveProgress(false);
    if (s.didJustFinish) void finished();
  });
  return player;
}

async function saveProgress(done: boolean) {
  const { track, position, duration } = usePlayer.getState();
  if (!track) return;
  lastSaved = Date.now();
  try {
    await api.saveProgress(track.topicId, {
      resource_id: track.resource.id,
      position,
      duration: duration || null,
      done: done || undefined,
      updated: new Date().toISOString(),
    });
    if (done) {
      void queryClient.invalidateQueries({ queryKey: keys.topic(track.topicId) });
      void queryClient.invalidateQueries({ queryKey: keys.topics });
    }
  } catch {
    // Offline: the next save carries the latest position anyway.
  }
}

async function finished() {
  await saveProgress(true);
  const { queue, track } = usePlayer.getState();
  const i = queue.findIndex((t) => t.resource.id === track?.resource.id);
  const next = i >= 0 ? queue[i + 1] : undefined;
  if (next) await play(next, queue, 0);
}

/** Build the playable list for a topic: its audio, in manifest order. */
export function topicQueue(
  topicId: string,
  topicTitle: string,
  resources: Resource[],
  fileToken: string,
): Track[] {
  return resources
    .filter((r) => r.type === 'audio')
    .map((r) => ({
      topicId,
      topicTitle,
      resource: r,
      url: fileUrl(fileToken, `topics/${topicId}/${r.path}`),
    }));
}

export async function play(track: Track, queue: Track[] = [track], startAt?: number) {
  const p = ensurePlayer();
  if (!modeSet) {
    modeSet = true;
    await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true }).catch(
      () => {},
    );
  }
  const current = usePlayer.getState().track;
  if (current?.resource.id !== track.resource.id || current.topicId !== track.topicId) {
    if (current) await saveProgress(false);
    p.replace({ uri: track.url });
    usePlayer.setState({
      track,
      queue,
      position: startAt ?? 0,
      duration: track.resource.duration ?? 0,
      error: null,
    });
    if (startAt) await p.seekTo(startAt).catch(() => {});
  }
  p.setPlaybackRate(usePrefs.getState().speed);
  p.play();
  try {
    p.setActiveForLockScreen(true, {
      title: track.resource.title,
      artist: track.topicTitle,
      albumTitle: 'Studyo',
    });
  } catch {
    // Not supported on this platform.
  }
}

export function toggle() {
  const p = ensurePlayer();
  if (usePlayer.getState().playing) {
    p.pause();
    void saveProgress(false);
  } else p.play();
}

export async function seek(seconds: number) {
  const p = ensurePlayer();
  const { duration } = usePlayer.getState();
  const to = Math.max(0, Math.min(duration || seconds, seconds));
  usePlayer.setState({ position: to });
  await p.seekTo(to).catch(() => {});
  void saveProgress(false);
}

export const skip = (delta: number) => seek(usePlayer.getState().position + delta);

export function setSpeed(rate: number) {
  usePrefs.getState().setSpeed(rate);
  player?.setPlaybackRate(rate);
}

export async function markDone() {
  await saveProgress(true);
}

export function stop() {
  void saveProgress(false);
  player?.pause();
  try {
    player?.setActiveForLockScreen(false);
  } catch {}
  usePlayer.setState({ track: null, queue: [], playing: false, position: 0 });
}
