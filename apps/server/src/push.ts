import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PushSubscription, Topic } from '@studyo/api';
import { courseIdOf, isCourseScope } from '@studyo/api';
import webpush from 'web-push';
import type { Db } from './db.ts';
import type { JobRecord } from './jobs/store.ts';
import { nowIso } from './util.ts';

interface Vapid {
  publicKey: string;
  privateKey: string;
}

/** Web Push to installed web apps (iPhone Home Screen, desktop browsers). Keys are made once and kept. */
export class Push {
  readonly publicKey: string;

  constructor(
    private db: Db,
    stateDir: string,
  ) {
    const file = join(stateDir, 'vapid.json');
    let keys: Vapid;
    if (existsSync(file)) keys = JSON.parse(readFileSync(file, 'utf8'));
    else {
      keys = webpush.generateVAPIDKeys();
      writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
    }
    this.publicKey = keys.publicKey;
    webpush.setVapidDetails(
      process.env.STUDYO_PUSH_CONTACT ?? 'mailto:studyo@localhost',
      keys.publicKey,
      keys.privateKey,
    );
  }

  add(sub: PushSubscription) {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO push_subscriptions (endpoint, p256dh, auth, created) VALUES (?, ?, ?, ?)',
      )
      .run(sub.endpoint, sub.keys.p256dh, sub.keys.auth, nowIso());
  }

  remove(endpoint: string) {
    this.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  }

  async notifyJob(job: JobRecord, topic: Topic | null) {
    if (job.kind === 'answer' || job.kind === 'quiz-grade') return;
    const name = topic?.title ?? (isCourseScope(job.topic_id) ? 'your course' : 'your topic');
    let title: string;
    let body: string;
    if (job.status === 'needs_input') {
      title = 'Studyo has a question';
      body = `Before building "${name}": ${job.questions?.title ?? 'a quick question about what you know.'}`;
    } else if (job.status === 'succeeded') {
      title =
        {
          condense: 'Condensed doc ready',
          audio: 'Audio ready',
          'course-outline': 'Course outline ready',
          quiz: 'Quiz ready',
          assignment: 'Take-home ready',
          'assignment-review': 'Review ready',
        }[job.kind as string] ?? 'Study pack ready';
      body = name;
    } else if (job.status === 'failed') {
      title = 'A job failed';
      body = `${name}: ${job.error ?? 'see the job log.'}`;
    } else return;
    await this.send({
      title,
      body,
      url: `${isCourseScope(job.topic_id) ? `/course/${courseIdOf(job.topic_id)}` : `/topic/${job.topic_id}`}${job.status === 'needs_input' ? `?job=${job.id}` : ''}`,
      tag: job.id,
    });
  }

  private async send(payload: { title: string; body: string; url: string; tag: string }) {
    const subs = this.db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions').all() as {
      endpoint: string;
      p256dh: string;
      auth: string;
    }[];
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify(payload),
            { TTL: 60 * 60 * 24 },
          );
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) this.remove(s.endpoint);
        }
      }),
    );
  }
}
