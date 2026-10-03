import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type {
  Assignment,
  QuestionResult,
  Quiz,
  QuizAttempt,
  QuizQuestion,
  Submission,
  SubmitAttempt,
} from '@studyo/api';
import type { Library } from './library.ts';
import { badRequest, newId, notFound, nowIso, readJson, writeJsonAtomic } from './util.ts';

/** A question as the skill wrote it, with the answer side that the app does not see until graded. */
type StoredQuestion = QuizQuestion & {
  answer?: string;
  explanation?: string;
  rubric?: string;
};
type StoredQuiz = Omit<Quiz, 'questions'> & { questions: StoredQuestion[] };

const SAFE = /^[A-Za-z0-9_-]+$/;
const safeId = (id: string, what: string) => {
  if (!SAFE.test(id)) throw notFound(what);
  return id;
};

/** Quizzes and take-home assignments: plain JSON files in the topic (or course) folder, written by the skills. */
export class Study {
  constructor(private library: Library) {}

  // ---- Quizzes ----------------------------------------------------------------

  private quizPath(scope: string, id: string) {
    return join(this.library.topicDir(scope), 'quizzes', `${safeId(id, 'Quiz')}.json`);
  }

  private async readStored(scope: string, id: string): Promise<StoredQuiz> {
    const quiz = await readJson<StoredQuiz>(this.quizPath(scope, id));
    if (!quiz) throw notFound('Quiz');
    return {
      ...quiz,
      id,
      scope,
      questions: Array.isArray(quiz.questions) ? quiz.questions : [],
      attempts: Array.isArray(quiz.attempts) ? quiz.attempts : [],
      status: quiz.status ?? 'generating',
    };
  }

  /** The quiz without the answers, unless the learner has a graded attempt (then the review needs them). */
  private publicQuiz(q: StoredQuiz): Quiz {
    return {
      ...q,
      questions: q.questions.map(({ answer: _a, explanation: _e, rubric: _r, ...rest }) => rest),
    };
  }

  startQuiz(scope: string, input: { focus: string | null }): Quiz {
    const id = newId('qz');
    const dir = join(this.library.topicDir(scope), 'quizzes');
    mkdirSync(dir, { recursive: true });
    const quiz: StoredQuiz = {
      id,
      title: 'Quiz',
      status: 'generating',
      scope,
      focus: input.focus,
      failure_reason: null,
      questions: [],
      attempts: [],
      created: nowIso(),
    };
    writeJsonAtomic(this.quizPath(scope, id), quiz);
    return this.publicQuiz(quiz);
  }

  async listQuizzes(scope: string): Promise<Quiz[]> {
    const dir = join(this.library.topicDir(scope), 'quizzes');
    const names = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
    const quizzes: Quiz[] = [];
    for (const name of names) {
      try {
        quizzes.push(this.publicQuiz(await this.readStored(scope, basename(name, '.json'))));
      } catch {
        // A half-written file from a running skill.
      }
    }
    return quizzes.sort((a, b) => b.created.localeCompare(a.created));
  }

  async getQuiz(scope: string, id: string): Promise<Quiz> {
    return this.publicQuiz(await this.readStored(scope, id));
  }

  /** Per-question review material for graded attempts, so the app can show the right answer and why. */
  async reviewMaterial(scope: string, id: string) {
    const q = await this.readStored(scope, id);
    return Object.fromEntries(
      q.questions.map((x) => [
        x.id,
        { correct_option: x.answer ?? null, explanation: x.explanation ?? null },
      ]),
    );
  }

  deleteQuiz(scope: string, id: string) {
    const path = this.quizPath(scope, id);
    if (!existsSync(path)) throw notFound('Quiz');
    rmSync(path);
  }

  /** Called when the `quiz` job ends. A file the skill left unfinished becomes a failed quiz. */
  async finishQuiz(scope: string, id: string, ok: boolean, reason: string | null) {
    const path = this.quizPath(scope, id);
    const quiz = await readJson<StoredQuiz>(path);
    if (!quiz) return;
    if (ok && quiz.status === 'ready' && Array.isArray(quiz.questions) && quiz.questions.length) {
      return;
    }
    quiz.status = 'failed';
    quiz.failure_reason = reason ?? 'The quiz could not be written.';
    writeJsonAtomic(path, quiz);
  }

  /** Grade the choice questions at once and record the attempt. Free-text answers wait for a grading job. */
  async addAttempt(scope: string, id: string, input: SubmitAttempt) {
    const quiz = await this.readStored(scope, id);
    if (quiz.status !== 'ready') throw badRequest('This quiz is not ready yet.');
    const answers: QuizAttempt['answers'] = {};
    const results: Record<string, QuestionResult> = {};
    let needsGrading = false;
    for (const q of quiz.questions) {
      const a = input.answers?.[q.id];
      answers[q.id] = { selected: a?.selected ?? null, text: a?.text?.trim() || null };
      if (q.type === 'choice') {
        const correct = !!a?.selected && a.selected === q.answer;
        results[q.id] = {
          score: correct ? 1 : 0,
          correct,
          feedback: null,
          correct_option: q.answer ?? null,
          explanation: q.explanation ?? null,
        };
      } else if (answers[q.id]?.text) {
        needsGrading = true;
      } else {
        results[q.id] = {
          score: 0,
          correct: false,
          feedback: 'No answer.',
          explanation: q.explanation ?? null,
        };
      }
    }
    const attempt: QuizAttempt = {
      id: newId('at'),
      status: needsGrading ? 'grading' : 'graded',
      created: nowIso(),
      answers,
      results,
      score: null,
      weak_concepts: [],
      job_id: null,
    };
    if (!needsGrading) finishScores(quiz, attempt);
    quiz.attempts.push(attempt);
    writeJsonAtomic(this.quizPath(scope, id), quiz);
    return { attempt, needsGrading, quizPath: this.quizPath(scope, id) };
  }

  async setAttemptJob(scope: string, id: string, attemptId: string, jobId: string) {
    const quiz = await this.readStored(scope, id);
    const attempt = quiz.attempts.find((a) => a.id === attemptId);
    if (!attempt) return;
    attempt.job_id = jobId;
    writeJsonAtomic(this.quizPath(scope, id), quiz);
  }

  /** Merge a grading reply into the attempt. `reply` is the model's JSON; null means the job failed. */
  async applyGrades(scope: string, id: string, attemptId: string, reply: string | null) {
    const quiz = await this.readStored(scope, id);
    const attempt = quiz.attempts.find((a) => a.id === attemptId);
    if (!attempt) return null;
    const parsed = reply ? parseJsonObject(reply) : null;
    const graded = (parsed?.results ?? null) as Record<
      string,
      { score?: number; feedback?: string }
    > | null;
    if (!graded) {
      attempt.status = 'failed';
      for (const q of quiz.questions) {
        const r = attempt.results?.[q.id];
        if (!r && q.type !== 'choice') {
          (attempt.results ??= {})[q.id] = {
            score: 0,
            correct: null,
            feedback: 'Could not be graded.',
            explanation: q.explanation ?? null,
          };
        }
      }
    } else {
      attempt.results ??= {};
      for (const q of quiz.questions) {
        if (q.type === 'choice' || attempt.results[q.id]) continue;
        const g = graded[q.id];
        const score = typeof g?.score === 'number' ? Math.min(1, Math.max(0, g.score)) : 0;
        attempt.results[q.id] = {
          score,
          correct: score >= 0.99 ? true : score <= 0.01 ? false : null,
          feedback: g?.feedback ?? null,
          explanation: q.explanation ?? null,
        };
      }
      finishScores(quiz, attempt);
    }
    writeJsonAtomic(this.quizPath(scope, id), quiz);
    return attempt;
  }

  // ---- Assignments ---------------------------------------------------------------

  private assignDir(topicId: string, id: string) {
    return join(this.library.topicDir(topicId), 'assignments', safeId(id, 'Assignment'));
  }

  private async readAssignment(topicId: string, id: string): Promise<Assignment> {
    const a = await readJson<Assignment>(join(this.assignDir(topicId, id), 'assignment.json'));
    if (!a) throw notFound('Assignment');
    const a2 = { ...a, id, submissions: Array.isArray(a.submissions) ? a.submissions : [] };
    // Reviews are separate files written by the skill; fold them in.
    for (const s of a2.submissions) {
      const review = await readJson<Submission['review']>(
        join(this.assignDir(topicId, id), 'reviews', `${safeId(s.id, 'Submission')}.json`),
      );
      if (review && s.status !== 'failed') {
        s.review = review;
        s.status = 'reviewed';
      }
    }
    return a2;
  }

  async createAssignment(
    topicId: string,
    input: {
      text: string | null;
      link: string | null;
      file: { name: string; data: Buffer } | null;
    },
  ): Promise<Assignment> {
    const id = newId('as');
    const dir = this.assignDir(topicId, id);
    mkdirSync(join(dir, 'context'), { recursive: true });
    let filePath: string | null = null;
    if (input.file) {
      const name = input.file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'context';
      writeFileSync(join(dir, 'context', name), input.file.data);
      filePath = `assignments/${id}/context/${name}`;
    }
    const hasContext = !!(input.text || input.link || filePath);
    const assignment: Assignment = {
      id,
      title: 'Take-home',
      status: 'briefing',
      failure_reason: null,
      context: hasContext ? { text: input.text, link: input.link, file: filePath } : null,
      brief: null,
      submissions: [],
      job_id: null,
      created: nowIso(),
    };
    writeJsonAtomic(join(dir, 'assignment.json'), assignment);
    return assignment;
  }

  async listAssignments(topicId: string): Promise<Assignment[]> {
    const dir = join(this.library.topicDir(topicId), 'assignments');
    const ids = existsSync(dir) ? readdirSync(dir).filter((f) => SAFE.test(f)) : [];
    const list: Assignment[] = [];
    for (const id of ids) {
      try {
        list.push(await this.readAssignment(topicId, id));
      } catch {
        // Not an assignment folder, or half written.
      }
    }
    return list.sort((a, b) => b.created.localeCompare(a.created));
  }

  getAssignment(topicId: string, id: string) {
    return this.readAssignment(topicId, id);
  }

  async patchAssignment(topicId: string, id: string, fn: (a: Assignment) => void) {
    const path = join(this.assignDir(topicId, id), 'assignment.json');
    const a = await readJson<Assignment>(path);
    if (!a) throw notFound('Assignment');
    a.submissions = Array.isArray(a.submissions) ? a.submissions : [];
    fn(a);
    writeJsonAtomic(path, a);
    return a;
  }

  deleteAssignment(topicId: string, id: string) {
    const dir = this.assignDir(topicId, id);
    if (!existsSync(dir)) throw notFound('Assignment');
    rmSync(dir, { recursive: true, force: true });
  }

  async addSubmission(
    topicId: string,
    id: string,
    input: {
      text: string | null;
      link: string | null;
      file: { name: string; data: Buffer } | null;
    },
  ): Promise<{ assignment: Assignment; submission: Submission }> {
    const dir = this.assignDir(topicId, id);
    const sid = newId('sb');
    let file: string | null = null;
    if (input.file) {
      mkdirSync(join(dir, 'submissions'), { recursive: true });
      const name = `${sid}-${input.file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80)}`;
      writeFileSync(join(dir, 'submissions', name), input.file.data);
      file = `assignments/${id}/submissions/${name}`;
    }
    const submission: Submission = {
      id: sid,
      kind: file ? 'file' : input.link ? 'link' : 'text',
      text: input.text,
      link: input.link,
      file,
      status: 'submitted',
      review: null,
      job_id: null,
      created: nowIso(),
    };
    const assignment = await this.patchAssignment(topicId, id, (a) => {
      if (a.status !== 'open') throw badRequest('This assignment has no brief yet.');
      a.submissions.push(submission);
    });
    return { assignment, submission };
  }

  /** The `assignment` job ended: a brief that was not written means failure. */
  async finishBrief(topicId: string, id: string, ok: boolean, reason: string | null) {
    await this.patchAssignment(topicId, id, (a) => {
      if (ok && a.status === 'open' && a.brief) return;
      a.status = 'failed';
      a.failure_reason = reason ?? 'The brief could not be written.';
    }).catch(() => {});
  }

  async setSubmissionJob(topicId: string, id: string, sid: string, jobId: string) {
    await this.patchAssignment(topicId, id, (a) => {
      const s = a.submissions.find((x) => x.id === sid);
      if (s) {
        s.job_id = jobId;
        s.status = 'reviewing';
      }
    });
  }

  /** The `assignment-review` job ended: the review file is the result. */
  async finishReview(topicId: string, id: string, sid: string, ok: boolean, reason: string | null) {
    const review = await readJson<Submission['review']>(
      join(this.assignDir(topicId, id), 'reviews', `${safeId(sid, 'Submission')}.json`),
    );
    await this.patchAssignment(topicId, id, (a) => {
      const s = a.submissions.find((x) => x.id === sid);
      if (!s) return;
      if (ok && review) {
        s.review = review;
        s.status = 'reviewed';
      } else {
        s.status = 'failed';
        s.review = null;
        (s as Submission & { failure_reason?: string }).failure_reason =
          reason ?? 'The review could not be written.';
      }
    }).catch(() => {});
  }
}

function finishScores(quiz: StoredQuiz, attempt: QuizAttempt) {
  const results = attempt.results ?? {};
  const total = quiz.questions.length || 1;
  attempt.score = quiz.questions.reduce((sum, q) => sum + (results[q.id]?.score ?? 0), 0) / total;
  const weak = new Set<string>();
  for (const q of quiz.questions) {
    if ((results[q.id]?.score ?? 0) < 0.6 && q.concept) weak.add(q.concept);
  }
  attempt.weak_concepts = [...weak];
  attempt.status = 'graded';
}

/** The first JSON object in a reply, tolerating a Markdown fence or a line of chatter around it. */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1));
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
