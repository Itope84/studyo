import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnswerSet, CliId, JobKind, QuestionSet, Settings, Topic } from '@studyo/api';
import { courseIdOf, isCourseScope } from '@studyo/api';
import type { AdapterEvent, CliAdapter, RunRequest } from '../adapters/types.ts';
import type { ChatStore } from '../chat.ts';
import { type CondenseParams, finalizeCondense, guardManifest } from '../condense.ts';
import type { Courses } from '../courses.ts';
import type { EventBus } from '../events.ts';
import type { Library } from '../library.ts';
import { renderTopic } from '../render.ts';
import { parseJsonObject, type Study } from '../study.ts';
import { conflict, nowIso } from '../util.ts';
import { chatContext } from './chat-context.ts';
import {
  answersPrompt,
  parseAnswer,
  parseStep,
  progressLines,
  SYSTEM,
  startPrompt,
} from './prompts.ts';
import { type JobRecord, type JobStore, publicJob } from './store.ts';

const TIME_LIMIT_MIN: Record<JobKind, number> = {
  enrich: 45,
  'enrich-deep': 90,
  condense: 30,
  answer: 20,
  'course-outline': 40,
  quiz: 12,
  'quiz-grade': 6,
  assignment: 12,
  'assignment-review': 15,
};

export interface RunnerDeps {
  library: Library;
  store: JobStore;
  bus: EventBus;
  chat: ChatStore;
  courses: Courses;
  study: Study;
  adapters: Record<CliId, CliAdapter>;
  settings: () => Settings;
  notify?: (job: JobRecord, topic: Topic | null) => void;
}

type Lane = 'work' | 'chat';

/** Runs queued jobs, one per lane, through the CLI adapters. All state lives in the store and the library. */
export class Runner {
  private running = new Map<Lane, { jobId: string; controller: AbortController }>();
  /** The reply text so far for each running chat job, so a cancel keeps everything written. */
  private partial = new Map<string, string>();
  private ticking = new Set<Lane>();
  private stopped = false;

  constructor(private d: RunnerDeps) {}

  /** Recover from a restart, then start draining the queues. */
  start() {
    for (const job of this.d.store.list({ active: true, limit: 500 })) {
      if (job.status === 'running') {
        this.d.store.update(job.id, {
          status: 'failed',
          error: 'The server restarted while this job was running.',
          finished: nowIso(),
        });
        void this.settleTopicAfterStop(job, 'The server restarted while the job was running.');
      }
    }
    void this.settleOrphans();
    this.kick();
  }

  /** Topics left "enriching" with no job behind them (a hand run, a crash) get an honest status. */
  private async settleOrphans() {
    for (const id of await this.d.library.courseIds()) {
      try {
        const m = await this.d.courses.readManifest(id);
        if (m.status === 'planning' && !this.d.store.activeWork(`course--${id}`)) {
          await this.d.courses.setStatus(
            id,
            m.chapters.length ? 'ready' : 'failed',
            m.chapters.length ? null : 'The outline was interrupted. Start it again.',
          );
        }
      } catch {
        // Unreadable course; leave it for the person to fix.
      }
    }
    for (const id of await this.d.library.topicIds()) {
      try {
        const m = await this.d.library.readManifest(id);
        if (m.status !== 'enriching' || this.d.store.activeWork(id)) continue;
        const topic = await this.d.library.readTopic(id, { persist: false });
        await this.d.library.setStatus(
          id,
          topic.resources.some((r) => r.type === 'pack') ? 'ready' : 'captured',
        );
      } catch {
        // Unreadable manifest; leave it for the person to fix.
      }
    }
  }

  /** Stop taking jobs and kill running CLIs (shutdown, tests). Jobs left running are failed on next start. */
  stop() {
    this.stopped = true;
    for (const r of this.running.values()) r.controller.abort();
  }

  kick() {
    if (this.stopped) return;
    void this.tick('work');
    void this.tick('chat');
  }

  async cancel(jobId: string) {
    const job = this.d.store.get(jobId);
    if (!job) return null;
    if (!['queued', 'running', 'needs_input'].includes(job.status))
      throw conflict('This job has already finished.');
    const live = [...this.running.values()].find((r) => r.jobId === jobId);
    this.d.store.update(jobId, { status: 'cancelled', finished: nowIso(), activity: 'Cancelled' });
    if (live) live.controller.abort();
    this.clearQuestions(job.topic_id);
    if (job.kind === 'answer') this.stopChatMessage(job);
    await this.settleTopicAfterStop(job, null);
    return this.d.store.get(jobId);
  }

  answer(jobId: string, answers: AnswerSet) {
    const job = this.d.store.get(jobId);
    if (!job) return null;
    if (job.status !== 'needs_input' || !job.questions)
      throw conflict('This job is not waiting for answers.');
    if (job.questions.id !== answers.question_set_id)
      throw conflict('These answers are for an older question.');
    const dir = join(this.d.library.topicDir(job.topic_id), '_job');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'answers.json'), JSON.stringify(answers, null, 2));
    const updated = this.d.store.update(jobId, {
      status: 'queued',
      questions: null,
      pending_input: JSON.stringify(answers),
      activity: 'Answers received, continuing',
    });
    this.kick();
    return updated;
  }

  private async tick(lane: Lane) {
    if (this.ticking.has(lane) || this.running.has(lane)) return;
    this.ticking.add(lane);
    try {
      while (!this.stopped) {
        const job = this.d.store.nextQueued(lane);
        if (!job) return;
        const controller = new AbortController();
        this.running.set(lane, { jobId: job.id, controller });
        const guard = guardManifest(this.d.library, job.topic_id);
        try {
          await this.run(job, controller);
          if (guard())
            this.d.store.log(
              job.id,
              'system',
              'The run broke topic.json; restored the copy from before it.',
            );
        } catch (e) {
          if (guard())
            this.d.store.log(
              job.id,
              'system',
              'The run broke topic.json; restored the copy from before it.',
            );
          if (this.stopped) return; // shutting down: the database may already be closed
          this.d.store.log(job.id, 'system', `Runner error: ${(e as Error).stack ?? e}`);
          this.d.store.update(job.id, {
            status: 'failed',
            error: (e as Error).message,
            finished: nowIso(),
          });
          await this.settleTopicAfterStop(job, `The job failed: ${(e as Error).message}`);
        } finally {
          this.running.delete(lane);
        }
      }
    } finally {
      this.ticking.delete(lane);
    }
  }

  private async run(job: JobRecord, controller: AbortController) {
    const { library, store, adapters } = this.d;
    const adapter = adapters[job.cli];
    const phase: 'start' | 'resume' = job.pending_input ? 'resume' : 'start';
    const topicPath = library.topicDir(job.topic_id);
    const scoped = isCourseScope(job.topic_id);
    const courseId = scoped ? courseIdOf(job.topic_id) : null;
    const topic = scoped ? null : await library.readTopic(job.topic_id, { persist: true });
    const courseManifest = courseId ? await this.d.courses.readManifest(courseId) : null;
    const coursePath = topic?.course ? library.courseDir(topic.course.course_id) : null;
    const settings = this.d.settings();

    let resume: string | null = null;
    let fork = false;
    const chatMessageId =
      job.kind === 'answer' ? String(job.params?.message_id ?? '') || null : null;
    if (phase === 'resume') resume = job.session_id;
    else if (job.kind === 'answer') {
      const chat = this.d.chat.read(job.topic_id);
      if (chat.session_id && chat.session_cli === job.cli) resume = chat.session_id;
      else if (topic?.session_id && topic.session_cli === job.cli) {
        resume = topic.session_id;
        fork = true;
      }
    }

    // Answers are in hand (or this is a fresh start), so any old question file is stale.
    this.clearQuestions(job.topic_id);
    if (!scoped && (job.kind === 'enrich' || job.kind === 'enrich-deep')) {
      await library.setStatus(job.topic_id, 'enriching');
      this.d.bus.emit('topic.updated', { topic_id: job.topic_id });
    }
    if (courseId && job.kind === 'course-outline' && phase === 'start') {
      await this.d.courses.setStatus(courseId, 'planning');
      this.d.bus.emit('topic.updated', { topic_id: job.topic_id });
    }
    store.update(job.id, {
      status: 'running',
      started: job.started ?? nowIso(),
      pending_input: null,
      activity: phase === 'resume' ? 'Continuing with your answers' : 'Starting',
    });
    store.log(
      job.id,
      'system',
      `${adapter.label} · ${phase === 'start' ? 'new run' : 'resuming session'}${resume ? ` ${resume}` : ''}${fork ? ' (fork)' : ''}`,
    );

    const prompt =
      phase === 'resume'
        ? answersPrompt(JSON.parse(job.pending_input as string) as AnswerSet)
        : startPrompt({
            kind: job.kind,
            topic,
            scope: job.topic_id,
            path: topicPath,
            coursePath,
            courseOrigin: courseManifest?.origin.type,
            courseGoal: courseManifest?.goal ?? null,
            courseOriginLine: courseManifest ? originLine(courseManifest.origin) : null,
            context:
              job.kind === 'answer'
                ? await chatContext(library, this.d.courses, job.topic_id, topic)
                : null,
            params: job.params ?? {},
          });

    // Chat reply state: text after the last tool call is the answer; earlier text was the model thinking aloud.
    let reply = '';
    let finalText: string | null = null;
    let resultError: string | null = null;
    let resultOk = false;
    const stderrTail: string[] = [];
    let sessionId: string | null = resume && !fork ? resume : null;

    if (chatMessageId) {
      const msg = this.d.chat.updateMessage(job.topic_id, chatMessageId, {
        status: 'streaming',
        job_id: job.id,
      });
      if (msg) this.d.bus.emit('chat.message', { topic_id: job.topic_id, message: msg });
    }

    const onEvent = (e: AdapterEvent) => {
      switch (e.type) {
        case 'session':
          sessionId = e.sessionId;
          store.update(job.id, { session_id: e.sessionId });
          if (topic && job.kind === 'enrich' && phase === 'start') {
            void this.saveTopicSession(job.topic_id, e.sessionId, job.cli);
          }
          if (job.kind === 'answer') this.d.chat.setSession(job.topic_id, e.sessionId, job.cli);
          break;
        case 'tool':
          store.log(job.id, 'tool', e.summary);
          store.update(job.id, { activity: e.summary });
          if (chatMessageId && reply) {
            reply = '';
            this.partial.set(job.id, '');
            const msg = this.d.chat.updateMessage(job.topic_id, chatMessageId, { text: '' });
            if (msg) this.d.bus.emit('chat.message', { topic_id: job.topic_id, message: msg });
          }
          break;
        case 'text': {
          store.log(job.id, 'text', e.text);
          for (const line of progressLines(e.text)) {
            const { step, text } = parseStep(line);
            store.log(job.id, 'progress', line);
            store.update(job.id, step ? { activity: text, step } : { activity: text });
          }
          break;
        }
        case 'text-delta':
          if (chatMessageId) {
            reply += e.text;
            this.partial.set(job.id, reply);
            this.d.bus.emit('chat.delta', {
              topic_id: job.topic_id,
              message_id: chatMessageId,
              text: e.text,
            });
            this.d.chat.updateMessage(job.topic_id, chatMessageId, { text: reply }, true);
          }
          break;
        case 'stderr':
          store.log(job.id, 'stderr', e.text);
          stderrTail.push(e.text);
          if (stderrTail.length > 8) stderrTail.shift();
          break;
        case 'result':
          resultOk = e.ok;
          finalText = e.text;
          resultError = e.error;
          if (e.costUsd != null) store.log(job.id, 'system', `Cost: $${e.costUsd.toFixed(4)}`);
          break;
      }
    };

    const limitMin = TIME_LIMIT_MIN[job.kind];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, limitMin * 60_000);

    // Chat may save what it finds, and only there.
    const chatSources = join(topicPath, 'sources');
    if (job.kind === 'answer') mkdirSync(chatSources, { recursive: true });

    const req: RunRequest = {
      cwd: library.root,
      prompt,
      system: SYSTEM,
      resume,
      fork,
      model: settings.models?.[job.cli] ?? null,
      policy: job.kind === 'answer' ? 'chat' : job.kind === 'quiz-grade' ? 'read-only' : 'work',
      writeScope: job.kind === 'answer' ? chatSources : undefined,
      streamText: job.kind === 'answer',
      signal: controller.signal,
      meta: { kind: job.kind, phase, topicPath, params: { ...job.params, scope: job.topic_id } },
    };
    const outcome = await adapter.run(req, onEvent).finally(() => clearTimeout(timer));
    if (outcome.sessionId) sessionId = outcome.sessionId;
    if (sessionId) store.update(job.id, { session_id: sessionId });

    if (this.stopped) return;
    const current = store.get(job.id) as JobRecord;
    if (current.status === 'cancelled') return; // cancel() already settled everything
    if (timedOut) {
      return this.fail(
        job,
        `Stopped after ${limitMin} minutes, the time limit for this kind of job.`,
      );
    }

    // Chat: the reply is the final text.
    if (job.kind === 'answer' && chatMessageId) {
      if (!resultOk && !(finalText ?? reply)) {
        this.failChatMessage(job, resultError ?? 'The reply failed.');
        return this.fail(job, resultError ?? 'The reply failed.', false);
      }
      this.partial.delete(job.id);
      const { text, suggest, quiz } = parseAnswer(finalText ?? reply);
      const msg = this.d.chat.updateMessage(job.topic_id, chatMessageId, {
        text,
        status: 'complete',
        suggest_enrich: suggest,
        suggest_quiz: quiz,
      });
      if (msg) this.d.bus.emit('chat.message', { topic_id: job.topic_id, message: msg });
      store.update(job.id, {
        status: 'succeeded',
        finished: nowIso(),
        suggest_enrich: suggest,
        activity: 'Answered',
      });
      return;
    }

    // Grading replies with JSON, which the server merges into the attempt.
    if (job.kind === 'quiz-grade') {
      const attempt = await this.d.study.applyGrades(
        job.topic_id,
        String(job.params?.quiz_id),
        String(job.params?.attempt_id),
        resultOk ? (finalText ?? reply) : null,
      );
      this.d.bus.emit('topic.updated', { topic_id: job.topic_id });
      if (!attempt || attempt.status === 'failed')
        return this.fail(job, resultError ?? 'The answers could not be graded.', false);
      store.update(job.id, { status: 'succeeded', finished: nowIso(), activity: 'Graded' });
      return;
    }

    // A skill that wrote questions is waiting for the learner.
    const questions = this.readQuestions(job.topic_id);
    if (questions) {
      const updated = store.update(job.id, {
        status: 'needs_input',
        questions,
        activity: questions.title ?? 'Waiting for your answers',
      });
      store.log(job.id, 'progress', 'Waiting for your answers');
      this.d.bus.emit('topic.updated', { topic_id: job.topic_id });
      this.d.notify?.(updated, topic);
      return;
    }

    if (!resultOk || outcome.exitCode !== 0) {
      const why = resultError ?? stderrTail.at(-1) ?? `exited with code ${outcome.exitCode}`;
      return this.fail(job, `${adapter.label} stopped: ${why}`);
    }

    // Course outline: the skill wrote course.json; the server makes the chapter folders.
    if (courseId && job.kind === 'course-outline') {
      const m = await this.d.courses.readManifest(courseId);
      if (m.status === 'failed')
        return this.fail(job, m.failure_reason ?? 'The outline could not be made.', false);
      if (!m.chapters.length) return this.fail(job, 'The run finished without any chapters.');
      if (m.status !== 'ready') await this.d.courses.setStatus(courseId, 'ready');
      for (const id of await this.d.courses.materialise(courseId))
        this.d.bus.emit('topic.updated', { topic_id: id });
      store.log(job.id, 'progress', 'Done');
      const done = store.update(job.id, {
        status: 'succeeded',
        finished: nowIso(),
        activity: 'Done',
      });
      this.d.bus.emit('topic.updated', { topic_id: job.topic_id });
      this.d.notify?.(done, null);
      return;
    }

    // Quizzes and take-home work leave a file; a missing or unfinished file is a failure.
    if (job.kind === 'quiz' || job.kind === 'assignment' || job.kind === 'assignment-review') {
      const bad = await this.checkStudyOutput(job);
      if (bad) return this.fail(job, bad);
      store.log(job.id, 'progress', 'Done');
      const done = store.update(job.id, {
        status: 'succeeded',
        finished: nowIso(),
        activity: 'Done',
      });
      this.d.bus.emit('topic.updated', { topic_id: job.topic_id });
      this.d.notify?.(done, topic);
      return;
    }

    // Success: check what the skill left behind, render documents, settle the topic status.
    const after = await library.readTopic(job.topic_id, { persist: true });
    if (after.status === 'failed') {
      return this.fail(job, after.failure_reason ?? 'The skill reported a failure.', false);
    }
    if ((job.kind === 'enrich' || job.kind === 'enrich-deep') && after.status !== 'ready') {
      const hasPack = after.resources.some((r) => r.type === 'pack');
      if (hasPack) await library.setStatus(job.topic_id, 'ready');
      else return this.fail(job, 'The run finished without producing a pack.');
    }
    let resources = after.resources;
    if (job.kind === 'condense' && job.params?.output_path) {
      await finalizeCondense(library, job.topic_id, job.params as unknown as CondenseParams);
      resources = (await library.readTopic(job.topic_id, { persist: false })).resources;
    }
    const problems = renderTopic(library, job.topic_id, resources);
    for (const p of problems) store.log(job.id, 'system', `Render problem: ${p}`);
    store.log(job.id, 'progress', 'Done');
    const done = store.update(job.id, {
      status: 'succeeded',
      finished: nowIso(),
      activity: 'Done',
    });
    this.d.bus.emit('topic.updated', { topic_id: job.topic_id });
    this.d.notify?.(done, after);
  }

  private async fail(job: JobRecord, message: string, settleTopic = true) {
    this.d.store.log(job.id, 'system', message);
    const failed = this.d.store.update(job.id, {
      status: 'failed',
      error: message,
      finished: nowIso(),
      activity: 'Failed',
    });
    if (settleTopic) await this.settleTopicAfterStop(job, message);
    this.d.bus.emit('topic.updated', { topic_id: job.topic_id });
    if (job.kind !== 'answer' && job.kind !== 'quiz-grade') this.d.notify?.(failed, null);
  }

  /** After a job stops early, leave the topic (or course, quiz, assignment) in an honest state. */
  private async settleTopicAfterStop(job: JobRecord, failure: string | null) {
    const { courses, study, library, bus } = this.d;
    try {
      switch (job.kind) {
        case 'answer':
          return;
        case 'course-outline': {
          const id = courseIdOf(job.topic_id);
          const m = await courses.readManifest(id);
          if (m.status === 'planning') {
            // An approved outline survives a later failure; without one the course is failed.
            if (m.chapters.length) await courses.setStatus(id, 'ready');
            else await courses.setStatus(id, 'failed', failure ?? 'The outline was cancelled.');
          }
          bus.emit('topic.updated', { topic_id: job.topic_id });
          return;
        }
        case 'quiz':
          await study.finishQuiz(
            job.topic_id,
            String(job.params?.quiz_id),
            false,
            failure ?? 'Cancelled.',
          );
          bus.emit('topic.updated', { topic_id: job.topic_id });
          return;
        case 'quiz-grade':
          await study.applyGrades(
            job.topic_id,
            String(job.params?.quiz_id),
            String(job.params?.attempt_id),
            null,
          );
          bus.emit('topic.updated', { topic_id: job.topic_id });
          return;
        case 'assignment':
          await study.finishBrief(
            job.topic_id,
            String(job.params?.assignment_id),
            false,
            failure ?? 'Cancelled.',
          );
          bus.emit('topic.updated', { topic_id: job.topic_id });
          return;
        case 'assignment-review':
          await study.finishReview(
            job.topic_id,
            String(job.params?.assignment_id),
            String(job.params?.submission_id),
            false,
            failure ?? 'Cancelled.',
          );
          bus.emit('topic.updated', { topic_id: job.topic_id });
          return;
      }
      const topic = await library.readTopic(job.topic_id, { persist: false });
      if (topic.status !== 'enriching') return;
      const hasPack = topic.resources.some((r) => r.type === 'pack');
      if (failure && !hasPack) await library.setStatus(job.topic_id, 'failed', failure);
      else await library.setStatus(job.topic_id, hasPack ? 'ready' : 'captured');
      bus.emit('topic.updated', { topic_id: job.topic_id });
    } catch {
      // Folder gone; nothing to settle.
    }
  }

  /** Returns a reason when the file a quiz or take-home job should have written is missing or unfinished. */
  private async checkStudyOutput(job: JobRecord): Promise<string | null> {
    const { study } = this.d;
    if (job.kind === 'quiz') {
      const id = String(job.params?.quiz_id);
      await study.finishQuiz(job.topic_id, id, true, null);
      const quiz = await study.getQuiz(job.topic_id, id);
      return quiz.status === 'ready'
        ? null
        : (quiz.failure_reason ?? 'The quiz could not be written.');
    }
    if (job.kind === 'assignment') {
      const id = String(job.params?.assignment_id);
      await study.finishBrief(job.topic_id, id, true, null);
      const a = await study.getAssignment(job.topic_id, id);
      return a.status === 'open' ? null : (a.failure_reason ?? 'The brief could not be written.');
    }
    const aid = String(job.params?.assignment_id);
    const sid = String(job.params?.submission_id);
    await study.finishReview(job.topic_id, aid, sid, true, null);
    const a = await study.getAssignment(job.topic_id, aid);
    const s = a.submissions.find((x) => x.id === sid);
    return s?.status === 'reviewed' ? null : 'The review could not be written.';
  }

  /** The learner stopped a reply: keep what was written, marked as stopped. */
  private stopChatMessage(job: JobRecord) {
    const id = String(job.params?.message_id ?? '');
    if (!id) return;
    const text = this.partial.get(job.id);
    const msg = this.d.chat.updateMessage(job.topic_id, id, {
      status: 'stopped',
      ...(text != null ? { text } : {}),
    });
    this.partial.delete(job.id);
    if (msg) this.d.bus.emit('chat.message', { topic_id: job.topic_id, message: msg });
  }

  private failChatMessage(job: JobRecord, error: string) {
    const id = String(job.params?.message_id ?? '');
    if (!id) return;
    const msg = this.d.chat.updateMessage(job.topic_id, id, { status: 'failed', error });
    if (msg) this.d.bus.emit('chat.message', { topic_id: job.topic_id, message: msg });
  }

  private async saveTopicSession(topicId: string, sessionId: string, cli: CliId) {
    const m = await this.d.library.readManifest(topicId);
    if (m.session_id === sessionId && m.session_cli === cli) return;
    m.session_id = sessionId;
    m.session_cli = cli;
    this.d.library.writeManifest(topicId, m);
  }

  private readQuestions(topicId: string): QuestionSet | null {
    const file = join(this.d.library.topicDir(topicId), '_job', 'questions.json');
    if (!existsSync(file)) return null;
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<QuestionSet>;
      if (!Array.isArray(raw.questions) || !raw.questions.length) return null;
      return {
        id: raw.id || `q-${Date.now().toString(36)}`,
        title: raw.title,
        intro: raw.intro,
        questions: raw.questions,
        asked: nowIso(),
      } as QuestionSet;
    } catch {
      return null;
    }
  }

  private clearQuestions(topicId: string) {
    rmSync(join(this.d.library.topicDir(topicId), '_job', 'questions.json'), { force: true });
  }

  isRunning(jobId: string) {
    return [...this.running.values()].some((r) => r.jobId === jobId);
  }

  publicJob = publicJob;
}

function originLine(origin: { type: string; link?: string; file?: string; name?: string }): string {
  if (origin.type === 'link') return `link ${origin.link}`;
  if (origin.type === 'pdf') return `pdf ${origin.file}`;
  return `topic ${origin.name ?? ''}`;
}

export { parseJsonObject };
