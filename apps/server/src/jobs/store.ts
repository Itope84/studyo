import type { CliId, Job, JobKind, JobStatus, LogLine, QuestionSet } from '@studyo/api';
import { ACTIVE_JOB_STATUSES } from '@studyo/api';
import type { Db } from '../db.ts';
import type { EventBus } from '../events.ts';
import { newId, nowIso } from '../util.ts';

interface JobRow {
  id: string;
  topic_id: string;
  kind: JobKind;
  lane: 'work' | 'chat';
  status: JobStatus;
  cli: CliId;
  params: string;
  activity: string | null;
  questions: string | null;
  pending_input: string | null;
  error: string | null;
  suggest_enrich: string | null;
  step: string | null;
  session_id: string | null;
  created: string;
  started: string | null;
  finished: string | null;
}

/** A job as the runner sees it: the public shape plus the CLI session and any answers waiting to be sent. */
export interface JobRecord extends Job {
  session_id: string | null;
  pending_input: string | null;
}

const toRecord = (r: JobRow): JobRecord => ({
  id: r.id,
  topic_id: r.topic_id,
  kind: r.kind,
  lane: r.lane,
  status: r.status,
  cli: r.cli,
  params: JSON.parse(r.params),
  activity: r.activity,
  questions: r.questions ? (JSON.parse(r.questions) as QuestionSet) : null,
  error: r.error,
  suggest_enrich: r.suggest_enrich,
  step: r.step ? JSON.parse(r.step) : null,
  created: r.created,
  started: r.started,
  finished: r.finished,
  session_id: r.session_id,
  pending_input: r.pending_input,
});

export const publicJob = (j: JobRecord): Job => {
  const { session_id: _s, pending_input: _p, ...job } = j;
  return job;
};

export class JobStore {
  private seq = new Map<string, number>();

  constructor(
    private db: Db,
    private bus: EventBus,
  ) {}

  create(input: {
    topic_id: string;
    kind: JobKind;
    cli: CliId;
    params?: Record<string, unknown>;
  }): JobRecord {
    const id = newId('job');
    const lane = input.kind === 'answer' ? 'chat' : 'work';
    this.db
      .prepare(
        'INSERT INTO jobs (id, topic_id, kind, lane, status, cli, params, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        input.topic_id,
        input.kind,
        lane,
        'queued',
        input.cli,
        JSON.stringify(input.params ?? {}),
        nowIso(),
      );
    const job = this.get(id) as JobRecord;
    this.bus.emit('job.updated', { job: publicJob(job) });
    return job;
  }

  get(id: string): JobRecord | null {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
    return row ? toRecord(row) : null;
  }

  list(
    filter: { active?: boolean; topic_id?: string; lane?: 'work' | 'chat'; limit?: number } = {},
  ): JobRecord[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (filter.active)
      where.push(`status IN (${ACTIVE_JOB_STATUSES.map(() => '?').join(',')})`),
        args.push(...ACTIVE_JOB_STATUSES);
    if (filter.topic_id) where.push('topic_id = ?'), args.push(filter.topic_id);
    if (filter.lane) where.push('lane = ?'), args.push(filter.lane);
    const sql = `SELECT * FROM jobs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created DESC LIMIT ?`;
    args.push(filter.limit ?? 50);
    return (this.db.prepare(sql).all(...args) as unknown as JobRow[]).map(toRecord);
  }

  /** The oldest queued job in a lane. */
  nextQueued(lane: 'work' | 'chat'): JobRecord | null {
    const row = this.db
      .prepare("SELECT * FROM jobs WHERE lane = ? AND status = 'queued' ORDER BY created LIMIT 1")
      .get(lane) as JobRow | undefined;
    return row ? toRecord(row) : null;
  }

  /** The work job holding a topic's session, if any (queued, running or waiting for answers). */
  activeWork(topicId: string): JobRecord | null {
    return this.list({ active: true, topic_id: topicId, lane: 'work', limit: 1 })[0] ?? null;
  }

  update(id: string, patch: Partial<Omit<JobRecord, 'id' | 'params'>>): JobRecord {
    const cols = Object.keys(patch);
    if (cols.length) {
      const values = cols.map((c) => {
        const v = (patch as Record<string, unknown>)[c];
        return c === 'questions' || c === 'step'
          ? v
            ? JSON.stringify(v)
            : null
          : (v as string | null);
      });
      this.db
        .prepare(`UPDATE jobs SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
        .run(...values, id);
    }
    const job = this.get(id) as JobRecord;
    this.bus.emit('job.updated', { job: publicJob(job) });
    return job;
  }

  log(jobId: string, kind: LogLine['kind'], text: string): LogLine {
    let seq = this.seq.get(jobId);
    if (seq === undefined) {
      const row = this.db
        .prepare('SELECT MAX(seq) AS s FROM job_log WHERE job_id = ?')
        .get(jobId) as { s: number | null };
      seq = Number(row.s ?? 0);
    }
    seq++;
    this.seq.set(jobId, seq);
    const line: LogLine = {
      seq,
      at: nowIso(),
      kind,
      text: text.length > 4000 ? `${text.slice(0, 4000)}…` : text,
    };
    this.db
      .prepare('INSERT INTO job_log (job_id, seq, at, kind, text) VALUES (?, ?, ?, ?, ?)')
      .run(jobId, seq, line.at, kind, line.text);
    this.bus.emit('job.log', { job_id: jobId, line });
    return line;
  }

  logLines(jobId: string, limit: number): LogLine[] {
    const rows = this.db
      .prepare('SELECT seq, at, kind, text FROM job_log WHERE job_id = ? ORDER BY seq DESC LIMIT ?')
      .all(jobId, limit) as unknown as LogLine[];
    return rows.map((r) => ({ ...r, seq: Number(r.seq) })).reverse();
  }
}
