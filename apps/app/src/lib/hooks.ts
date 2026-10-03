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
    if (e instanceof ApiError && e.code === 'access_expired')
      useLive.getState().set({ accessExpired: true });
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

export function useCourses() {
  return useQuery({
    queryKey: keys.courses,
    queryFn: () => track(api.courses()),
    enabled: useConnected(),
  });
}

export function useCourse(id: string) {
  return useQuery({
    queryKey: keys.course(id),
    queryFn: () => track(api.course(id)),
    enabled: useConnected() && !!id,
  });
}

export function useQuizzes(scope: string) {
  return useQuery({
    queryKey: keys.quizzes(scope),
    queryFn: () => track(api.quizzes(scope)),
    enabled: useConnected() && !!scope,
    // A quiz being written or graded shows up without waiting for the stream.
    refetchInterval: (q) =>
      q.state.data?.quizzes.some(
        (z) => z.status === 'generating' || z.attempts.some((a) => a.status === 'grading'),
      )
        ? 5_000
        : false,
  });
}

export function useQuiz(scope: string, id: string) {
  return useQuery({
    queryKey: keys.quiz(scope, id),
    queryFn: () => track(api.quiz(scope, id)),
    enabled: useConnected() && !!id && !!scope,
    refetchInterval: (q) =>
      q.state.data?.status === 'generating' ||
      q.state.data?.attempts.some((a) => a.status === 'grading')
        ? 4_000
        : false,
  });
}

export function useAssignments(topic: string) {
  return useQuery({
    queryKey: keys.assignments(topic),
    queryFn: () => track(api.assignments(topic)),
    enabled: useConnected() && !!topic,
    refetchInterval: (q) =>
      q.state.data?.assignments.some(
        (a) => a.status === 'briefing' || a.submissions.some((s) => s.status === 'reviewing'),
      )
        ? 5_000
        : false,
  });
}

export function useAssignment(topic: string, id: string) {
  return useQuery({
    queryKey: keys.assignment(topic, id),
    queryFn: () => track(api.assignment(topic, id)),
    enabled: useConnected() && !!id && !!topic,
    refetchInterval: (q) =>
      q.state.data?.status === 'briefing' ||
      q.state.data?.submissions.some((s) => s.status === 'reviewing')
        ? 4_000
        : false,
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

export function useAllJobs() {
  return useQuery({
    queryKey: keys.allJobs,
    queryFn: () => track(api.jobs({ limit: 100 })),
    enabled: useConnected(),
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
