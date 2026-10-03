import type { Job } from '@studyo/api';
import { useQuery } from '@tanstack/react-query';
import { ApiError, api } from './api';
import { useLive } from './live';
import { usePrefs } from './prefs';
import { keys } from './query';

/** Wrap a request so the app knows whether the server is reachable. */
async function track<T>(p: Promise<T>): Promise<T> {
  try {
    const v = await p;
    if (useLive.getState().reachable !== true) useLive.getState().set({ reachable: true });
    return v;
  } catch (e) {
    if (e instanceof ApiError && e.offline) useLive.getState().set({ reachable: false });
    throw e;
  }
}

const useConnected = () => usePrefs((s) => !!s.connection);

export function useServerInfo() {
  return useQuery({
    queryKey: keys.server,
    queryFn: () => track(api.server()),
    enabled: useConnected(),
    staleTime: 60_000,
  });
}

export function useTopics() {
  return useQuery({
    queryKey: keys.topics,
    queryFn: () => track(api.topics()),
    enabled: useConnected(),
  });
}

export function useTopic(id: string) {
  return useQuery({
    queryKey: keys.topic(id),
    queryFn: () => track(api.topic(id)),
    enabled: useConnected() && !!id,
  });
}

/** Active jobs. Polls every 10s while a job is active and the live stream is down. */
export function useActiveJobs() {
  const streamLive = useLive((s) => s.status === 'live');
  return useQuery({
    queryKey: keys.activeJobs,
    queryFn: () => track(api.jobs({ active: true })),
    enabled: useConnected(),
    refetchInterval: (q) => (!streamLive && (q.state.data?.jobs.length ?? 0) > 0 ? 10_000 : false),
  });
}

export function useJob(id: string | null) {
  return useQuery({
    queryKey: keys.job(id ?? ''),
    queryFn: () => track(api.job(id as string)),
    enabled: useConnected() && !!id,
  });
}

export function useChat(topicId: string) {
  return useQuery({
    queryKey: keys.chat(topicId),
    queryFn: () => track(api.chat(topicId)),
    enabled: useConnected(),
  });
}

export function useInbox() {
  return useQuery({
    queryKey: keys.inbox,
    queryFn: () => track(api.inbox()),
    enabled: useConnected(),
  });
}

export function useProfile() {
  return useQuery({
    queryKey: keys.profile,
    queryFn: () => track(api.profile()),
    enabled: useConnected(),
  });
}

/** The work job on a topic that needs attention (running, queued or waiting), from the live job list. */
export function useTopicJob(topicId: string): Job | null {
  const { data } = useActiveJobs();
  return data?.jobs.find((j) => j.topic_id === topicId && j.lane === 'work') ?? null;
}

/** Whether server-only actions should be enabled, and why not. */
export function useOnline(): { online: boolean; reason: string | null } {
  const reachable = useLive((s) => s.reachable);
  if (reachable === false) return { online: false, reason: 'The server is offline.' };
  return { online: true, reason: null };
}
