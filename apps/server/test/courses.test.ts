import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { normaliseChapters } from '../src/courses.ts';
import { expectSchema, makeServer, waitFor } from './helpers.ts';

type Server = Awaited<ReturnType<typeof makeServer>>;
let s: Server;
afterEach(() => s?.close());

const job = async (id: string) => (await s.call('GET', `/jobs/${id}`)).json;
const finished = (id: string, status = 'succeeded') =>
  waitFor(async () => {
    const j = await job(id);
    return j.status === status ? j : null;
  });

/** Create the replay course and approve its outline. */
async function approvedCourse() {
  const created = await s.call('POST', '/courses', {
    origin: { type: 'topic', name: 'Replay course' },
    goal: 'Understand replication',
  });
  expect(created.status).toBe(201);
  expectSchema('CourseWithJob', created.json);
  const id = created.json.course.id as string;
  const waiting = await waitFor(async () => {
    const j = await job(created.json.job.id);
    return j.status === 'needs_input' ? j : null;
  });
  expect(waiting.questions.intro).toContain('3 chapters');
  // While the outline waits the course is planning and chat is held.
  expect((await s.call('GET', `/courses/${id}`)).json.course.status).toBe('planning');
  expect((await s.call('POST', `/topics/course--${id}/chat`, { text: 'hi' })).status).toBe(409);
  await s.call('POST', `/jobs/${created.json.job.id}/answers`, {
    question_set_id: waiting.questions.id,
    answers: { decision: { selected: ['approve'] } },
  });
  await finished(created.json.job.id);
  return { id, scope: `course--${id}` };
}

/** Build one chapter through the replayed enrich run, answering its level question. */
async function buildChapter(courseId: string, chapterId: string) {
  const res = await s.call('POST', `/courses/${courseId}/build`, { chapter_ids: [chapterId] });
  expect(res.status).toBe(202);
  const jobId = res.json.jobs[0].id;
  const waiting = await waitFor(async () => {
    const j = await job(jobId);
    return j.status === 'needs_input' ? j : null;
  });
  await s.call('POST', `/jobs/${jobId}/answers`, {
    question_set_id: waiting.questions.id,
    answers: { known: { selected: ['tls'] } },
  });
  await finished(jobId);
}

describe('courses', () => {
  it('cleans a chapter list: ids, prerequisites and loops', () => {
    const chapters = normaliseChapters('book', [
      { title: 'One', prereqs: ['book-02-two', 'ghost', 'book-01-one'] },
      { title: 'Two', prereqs: ['book-01-one'] },
      { title: 'Two', prereqs: [] },
      { title: '', prereqs: [] },
      { title: 'Prelim: basics', kind: 'prelim' },
    ]);
    expect(chapters.map((c) => c.id)).toEqual([
      'book-prelim',
      'book-01-one',
      'book-02-two',
      'book-03-two',
    ]);
    // "One needs Two" stays; "Two needs One" would close a loop, so it is dropped. Unknown ids and self-links go too.
    expect(chapters[1]?.prereqs).toEqual(['book-02-two']);
    expect(chapters[2]?.prereqs).toEqual([]);
    expect(chapters.map((c) => c.order)).toEqual([0, 1, 2, 3]);
  });

  it('plans a course, waits for approval, then creates chapter topics', async () => {
    s = await makeServer();
    const { id } = await approvedCourse();

    const detail = await s.call('GET', `/courses/${id}`);
    expectSchema('CourseDetail', detail.json);
    expect(detail.json.course.status).toBe('ready');
    expect(detail.json.chapters.map((c: { kind: string }) => c.kind)).toEqual([
      'prelim',
      'chapter',
      'chapter',
      'chapter',
    ]);
    expect(detail.json.chapters.every((c: { state: string }) => c.state === 'planned')).toBe(true);
    expect(detail.json.estimate.planned_chapters).toBe(4);
    expect(detail.json.chat_available).toBe(true);
    const replication = detail.json.chapters[2];
    expect(replication.prereqs).toEqual([`${id}-01-reliable`]);
    expect(replication.unmet_prereqs).toEqual([`${id}-01-reliable`]);

    // The chapter is a real topic that carries its place in the course, and carries its course id.
    const topic = await s.call('GET', `/topics/${replication.id}`);
    expectSchema('TopicDetail', topic.json);
    expect(topic.json.topic.course.course_id).toBe(id);
    expect(topic.json.topic.origin).toEqual({ type: 'chapter', course_id: id });
    const home = await s.call('GET', '/topics');
    // Chapters are in the list (the app needs their titles) but carry their course, so Home can leave them out.
    expect(
      home.json.topics
        .filter((t: { course_id: string | null }) => !t.course_id)
        .map((t: { id: string }) => t.id),
    ).toEqual(['pc-ca-mcts']);
    expect(home.json.topics.find((t: { id: string }) => t.id === replication.id).course_id).toBe(
      id,
    );

    const list = await s.call('GET', '/courses');
    expectSchema('CourseList', list.json);
    expect(list.json.courses[0].counts).toEqual({ chapters: 3, built: 0, done: 0 });
    expect(list.json.courses[0].next_chapter.title).toMatch(/^Prelim/);
    expect(existsSync(join(s.library, 'courses', id, 'index.md'))).toBe(true);
  });

  it('builds chapters lazily, marks them done and feeds the profile', async () => {
    s = await makeServer();
    const { id } = await approvedCourse();
    expect((await s.call('POST', `/courses/${id}/build`, {})).status).toBe(400);

    const first = `${id}-01-reliable`;
    await buildChapter(id, first);
    const built = (await s.call('GET', `/courses/${id}`)).json;
    const view = built.chapters.find((c: { id: string }) => c.id === first);
    expect(view.state).toBe('ready');
    expect(built.estimate.planned_chapters).toBe(3);
    // Building the same chapter again has nothing to do.
    expect((await s.call('POST', `/courses/${id}/build`, { chapter_ids: [first] })).status).toBe(
      409,
    );

    const done = await s.call('POST', `/courses/${id}/chapters/${first}/complete`, { done: true });
    expectSchema('CourseDetail', done.json);
    expect(done.json.chapters.find((c: { id: string }) => c.id === first).state).toBe('done');
    // Chapter two now has no unmet prerequisite.
    expect(
      done.json.chapters.find((c: { id: string }) => c.id === `${id}-02-replication`).unmet_prereqs,
    ).toEqual([]);
    const profile = (await s.call('GET', '/profile')).json;
    expect(profile.knows.map((k: { term: string }) => k.term)).toContain('percentile latency');
    const summary = (await s.call('GET', '/courses')).json.courses[0];
    expect(summary.counts).toMatchObject({ built: 1, done: 1 });

    // "Build next" skips what is built.
    const next = await s.call('POST', `/courses/${id}/build`, { next: 1 });
    expect(next.status).toBe(202);
    expect(next.json.jobs[0].topic_id).toBe(`${id}-prelim`);
    await s.call('POST', `/jobs/${next.json.jobs[0].id}/cancel`);
    await finished(next.json.jobs[0].id, 'cancelled');
  });

  it('chats at the course level', async () => {
    s = await makeServer();
    const { id, scope } = await approvedCourse();
    const sent = await s.call('POST', `/topics/${scope}/chat`, {
      text: 'How do the chapters relate?',
    });
    expect(sent.status).toBe(202);
    await finished(sent.json.job.id);
    const history = (await s.call('GET', `/topics/${scope}/chat`)).json;
    expectSchema('ChatHistory', history);
    expect(history.messages.at(-1).status).toBe('complete');
    expect(existsSync(join(s.library, 'courses', id, 'chat', 'chat.json'))).toBe(true);
  });

  it('refuses a scanned PDF without spending a job', async () => {
    try {
      execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
    } catch {
      return; // no poppler on this machine; the check is skipped there too
    }
    s = await makeServer();
    const blank =
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n';
    const form = new FormData();
    form.set('file', new File([blank], 'scan.pdf', { type: 'application/pdf' }));
    const res = await s.call('POST', '/courses', form);
    expect(res.status).toBe(201);
    expect(res.json.job).toBeNull();
    expect(res.json.course.status).toBe('failed');
    expect(res.json.course.failure_reason).toMatch(/scanned/);
    expect((await s.call('POST', `/courses/${res.json.course.id}/outline`)).status).toBe(202);
  });
});

describe('quizzes', () => {
  it('makes a quiz on request, grades choices at once and free text by job', async () => {
    s = await makeServer();
    const made = await s.call('POST', '/topics/pc-ca-mcts/quizzes', { count: 3 });
    expect(made.status).toBe(202);
    expectSchema('QuizWithJob', made.json);
    expect(made.json.quiz.status).toBe('generating');
    await finished(made.json.job.id);

    const quiz = (await s.call('GET', `/topics/pc-ca-mcts/quizzes/${made.json.quiz.id}`)).json;
    expectSchema('Quiz', quiz);
    expect(quiz.status).toBe('ready');
    expect(quiz.questions).toHaveLength(3);
    // The answer side is not sent until it is graded.
    expect(JSON.stringify(quiz)).not.toContain('"answer"');
    expect(JSON.stringify(quiz)).not.toContain('rubric');

    const attempt = await s.call('POST', `/topics/pc-ca-mcts/quizzes/${quiz.id}/attempts`, {
      answers: {
        q1: { selected: 'b' },
        q2: { text: 'Each level adds one hash.' },
        q3: { text: 'Hashes of hashes.' },
      },
    });
    expect(attempt.status).toBe(201);
    expectSchema('QuizAttempt', attempt.json);
    expect(attempt.json.status).toBe('grading');
    expect(attempt.json.results.q1).toMatchObject({ correct: true, correct_option: 'b' });
    await finished(attempt.json.job_id);

    const graded = (await s.call('GET', `/topics/pc-ca-mcts/quizzes/${quiz.id}`)).json.attempts[0];
    expectSchema('QuizAttempt', graded);
    expect(graded.status).toBe('graded');
    expect(graded.score).toBeCloseTo((1 + 1 + 0.5) / 3);
    expect(graded.weak_concepts).toEqual(['merkle tree']);
    expect(graded.results.q3.feedback).toMatch(/root/);

    const list = await s.call('GET', '/topics/pc-ca-mcts/quizzes');
    expectSchema('QuizList', list.json);
    expect((await s.call('DELETE', `/topics/pc-ca-mcts/quizzes/${quiz.id}`)).status).toBe(204);
  });

  it('grades an all-choice attempt without a job and refuses a quiz with nothing to ask about', async () => {
    s = await makeServer();
    const made = await s.call('POST', '/topics/pc-ca-mcts/quizzes', {});
    await finished(made.json.job.id);
    const attempt = await s.call(
      'POST',
      `/topics/pc-ca-mcts/quizzes/${made.json.quiz.id}/attempts`,
      {
        answers: { q1: { selected: 'a' } },
      },
    );
    // q2 and q3 have no text, so they score zero and nothing needs grading.
    expect(attempt.json.status).toBe('graded');
    expect(attempt.json.score).toBe(0);
    expect(attempt.json.weak_concepts).toHaveLength(3);

    const empty = await s.call('POST', '/topics', {
      origin: { type: 'topic', name: 'Nothing yet' },
      enrich: false,
    });
    expect((await s.call('POST', `/topics/${empty.json.topic.id}/quizzes`, {})).status).toBe(409);
  });

  it('makes a cumulative course quiz', async () => {
    s = await makeServer();
    const { id, scope } = await approvedCourse();
    expect((await s.call('POST', `/topics/${scope}/quizzes`, {})).status).toBe(409);
    await buildChapter(id, `${id}-01-reliable`);
    const made = await s.call('POST', `/topics/${scope}/quizzes`, { count: 3 });
    expect(made.status).toBe(202);
    await finished(made.json.job.id);
    const quiz = (await s.call('GET', `/topics/${scope}/quizzes/${made.json.quiz.id}`)).json;
    expect(quiz.scope).toBe(scope);
    expect(existsSync(join(s.library, 'courses', id, 'quizzes', `${quiz.id}.json`))).toBe(true);
  });
});

describe('take-home', () => {
  it('writes a brief from context, takes a submission and reviews it', async () => {
    s = await makeServer();
    const made = await s.call('POST', '/topics/pc-ca-mcts/assignments', {
      context_text: 'I run a small certificate service at work.',
    });
    expect(made.status).toBe(202);
    expectSchema('AssignmentWithJob', made.json);
    expect(made.json.assignment.context.text).toMatch(/certificate service/);
    await finished(made.json.job.id);

    const brief = (await s.call('GET', `/topics/pc-ca-mcts/assignments/${made.json.assignment.id}`))
      .json;
    expectSchema('Assignment', brief);
    expect(brief.status).toBe('open');
    expect(brief.brief.acceptance).toHaveLength(2);

    expect(
      (await s.call('POST', `/topics/pc-ca-mcts/assignments/${brief.id}/submissions`, {})).status,
    ).toBe(400);
    const sub = await s.call('POST', `/topics/pc-ca-mcts/assignments/${brief.id}/submissions`, {
      text: 'I did it, here is what I built.',
    });
    expect(sub.status).toBe(202);
    expectSchema('Assignment', sub.json);
    expect(sub.json.submissions[0]).toMatchObject({ kind: 'text', status: 'reviewing' });
    await finished(sub.json.submissions[0].job_id);

    const reviewed = (await s.call('GET', `/topics/pc-ca-mcts/assignments/${brief.id}`)).json;
    expectSchema('Assignment', reviewed);
    expect(reviewed.submissions[0].status).toBe('reviewed');
    expect(reviewed.submissions[0].review.criteria.map((c: { met: string }) => c.met)).toEqual([
      'yes',
      'no',
    ]);
    const list = await s.call('GET', '/topics/pc-ca-mcts/assignments');
    expectSchema('AssignmentList', list.json);
  });

  it('writes a generic task when no context is given, and keeps an uploaded context file', async () => {
    s = await makeServer();
    const form = new FormData();
    form.set('context_file', new File(['my notes'], 'notes.txt', { type: 'text/plain' }));
    const withFile = await s.call('POST', '/topics/pc-ca-mcts/assignments', form);
    expect(withFile.status).toBe(202);
    expect(withFile.json.assignment.context.file).toMatch(
      /^assignments\/as_.+\/context\/notes\.txt$/,
    );
    const dir = join(s.library, 'topics', 'pc-ca-mcts', withFile.json.assignment.context.file);
    expect(readFileSync(dir, 'utf8')).toBe('my notes');
    await finished(withFile.json.job.id);
    const generic = await s.call('POST', '/topics/pc-ca-mcts/assignments', {});
    expect(generic.json.assignment.context).toBeNull();
    await finished(generic.json.job.id);
  });

  it('refuses take-home work on a course scope', async () => {
    s = await makeServer();
    const { scope } = await approvedCourse();
    expect((await s.call('POST', `/topics/${scope}/assignments`, {})).status).toBe(400);
  });
});
