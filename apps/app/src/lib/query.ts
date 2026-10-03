import type { ChatHistory, ChatMessage, Job, JobDetail, JobList } from '@studyo/api';
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (count, err) =>
        !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

export const keys = {
  server: ['server'] as const,
  topics: ['topics'] as const,
  topic: (id: string) => ['topic', id] as const,
  courses: ['courses'] as const,
  course: (id: string) => ['course', id] as const,
  quizzes: (scope: string) => ['quizzes', scope] as const,
  quiz: (scope: string, id: string) => ['quiz', scope, id] as const,
  assignments: (topic: string) => ['assignments', topic] as const,
  assignment: (topic: string, id: string) => ['assignment', topic, id] as const,
  activeJobs: ['jobs', 'active'] as const,
  allJobs: ['jobs', 'all'] as const,
  job: (id: string) => ['job', id] as const,
  chat: (id: string) => ['chat', id] as const,
  inbox: ['inbox'] as const,
  profile: ['profile'] as const,
  rendered: (topicId: string, rid: string) => ['rendered', topicId, rid] as const,
};

const ACTIVE = new Set(['queued', 'running', 'needs_input']);

/** Fold a job update from the stream into every cache that shows jobs. */
export function applyJob(job: Job) {
  queryClient.setQueryData<JobList>(keys.activeJobs, (old) => {
    if (!old) return old;
    const rest = old.jobs.filter((j) => j.id !== job.id);
    return { jobs: ACTIVE.has(job.status) ? [job, ...rest] : rest };
  });
  queryClient.setQueryData<JobDetail>(keys.job(job.id), (old) => (old ? { ...old, ...job } : old));
  queryClient.setQueryData<JobList>(keys.allJobs, (old) => {
    if (!old) return old;
    const rest = old.jobs.filter((j) => j.id !== job.id);
    return { jobs: [job, ...rest].sort((a, b) => b.created.localeCompare(a.created)) };
  });
}

export function appendJobLog(jobId: string, line: JobDetail['log'][number]) {
  queryClient.setQueryData<JobDetail>(keys.job(jobId), (old) =>
    old && !old.log.some((l) => l.seq === line.seq)
      ? { ...old, log: [...old.log, line].slice(-500) }
      : old,
  );
}

export function upsertChatMessage(topicId: string, message: ChatMessage) {
  queryClient.setQueryData<ChatHistory>(keys.chat(topicId), (old) => {
    if (!old) return old;
    const i = old.messages.findIndex((m) => m.id === message.id);
    const messages = [...old.messages];
    if (i >= 0) messages[i] = { ...messages[i], ...message };
    else messages.push(message);
    return { ...old, messages };
  });
}

export function appendChatDelta(topicId: string, messageId: string, text: string) {
  queryClient.setQueryData<ChatHistory>(keys.chat(topicId), (old) => {
    if (!old) return old;
    return {
      ...old,
      messages: old.messages.map((m) =>
        m.id === messageId ? { ...m, text: m.text + text, status: 'streaming' as const } : m,
      ),
    };
  });
}
