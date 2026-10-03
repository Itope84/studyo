import type { Job } from '@studyo/api';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Segmented } from '@/components/inputs';
import { jobLabel } from '@/components/JobPanel';
import { Pulse } from '@/components/status';
import {
  Badge,
  type BadgeKind,
  Empty,
  Header,
  Icon,
  Loading,
  Notice,
  ProgressBar,
  Row,
  Screen,
  SectionTitle,
  T,
  timeAgo,
} from '@/components/ui';
import { useAllJobs, useTopics } from '@/lib/hooks';
import { space } from '@/theme';

const STATUS: Record<Job['status'], { kind: BadgeKind; label: string }> = {
  queued: { kind: 'enriching', label: 'Queued' },
  running: { kind: 'enriching', label: 'Running' },
  needs_input: { kind: 'waiting', label: 'Needs your answer' },
  succeeded: { kind: 'ready', label: 'Done' },
  failed: { kind: 'failed', label: 'Failed' },
  cancelled: { kind: 'neutral', label: 'Cancelled' },
};

/** Everything the AI is doing or has done: waiting questions first, then running work, then history. */
export default function Activity() {
  const jobs = useAllJobs();
  const topics = useTopics();
  const [show, setShow] = useState<'builds' | 'all'>('builds');
  const titles = new Map((topics.data?.topics ?? []).map((t) => [t.id, t.title]));

  const list = (jobs.data?.jobs ?? []).filter((j) => show === 'all' || j.lane === 'work');
  const waiting = list.filter((j) => j.status === 'needs_input');
  const running = list.filter((j) => j.status === 'running' || j.status === 'queued');
  const recent = list.filter((j) => !waiting.includes(j) && !running.includes(j));

  return (
    <Screen header={<Header title="Activity" back={false} />}>
      <View style={{ paddingTop: space.md }}>
        <Segmented
          value={show}
          onChange={setShow}
          options={[
            { value: 'builds', label: 'Packs and docs' },
            { value: 'all', label: 'Including chat' },
          ]}
        />
      </View>
      {jobs.error ? (
        <Notice tone="danger" title="Couldn't load activity" body={(jobs.error as Error).message} />
      ) : null}
      {jobs.isLoading ? <Loading /> : null}
      {jobs.data && list.length === 0 ? (
        <Empty
          icon="timeline"
          title="Nothing yet"
          body="Building packs, condensed docs and chat replies show up here as they run."
        />
      ) : null}
      {waiting.length ? <SectionTitle>Needs you</SectionTitle> : null}
      {waiting.map((j) => (
        <JobRow key={j.id} job={j} title={titles.get(j.topic_id)} />
      ))}
      {running.length ? <SectionTitle>Running</SectionTitle> : null}
      {running.map((j) => (
        <JobRow key={j.id} job={j} title={titles.get(j.topic_id)} />
      ))}
      {recent.length ? <SectionTitle>Recent</SectionTitle> : null}
      {recent.map((j) => (
        <JobRow key={j.id} job={j} title={titles.get(j.topic_id)} />
      ))}
    </Screen>
  );
}

function JobRow({ job, title }: { job: Job; title?: string }) {
  const s = STATUS[job.status];
  const detail =
    job.status === 'failed'
      ? job.error
      : job.status === 'needs_input'
        ? (job.questions?.title ?? 'A quick question')
        : job.activity;
  const leading =
    job.status === 'running' || job.status === 'queued' ? (
      <Pulse />
    ) : job.status === 'needs_input' ? (
      <Icon name="help" size={20} tone="primary" />
    ) : job.status === 'failed' ? (
      <Icon name="error" size={20} tone="danger" />
    ) : job.status === 'succeeded' ? (
      <Icon name="check-circle" size={20} tone="sage" />
    ) : (
      <Icon name="cancel" size={20} tone="faint" />
    );
  return (
    <Row
      title={title ?? job.topic_id}
      leading={leading}
      onPress={() => router.push(`/job/${job.id}`)}
      accessibilityLabel={`${jobLabel(job)} for ${title ?? job.topic_id}, ${s.label}`}
      subtitle={
        <View style={{ gap: 6 }}>
          <View
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}
          >
            <Badge kind={s.kind} label={s.label} />
            <T variant="meta" tone="lead">
              {jobLabel(job)} · {job.cli === 'claude' ? 'Claude Code' : 'OpenCode'} ·{' '}
              {timeAgo(job.finished ?? job.started ?? job.created)}
            </T>
          </View>
          {detail ? (
            <T variant="meta" tone={job.status === 'failed' ? 'danger' : 'lead'} numberOfLines={2}>
              {job.status === 'running' && job.step ? `Step ${job.step.n}/${job.step.of} · ` : ''}
              {detail}
            </T>
          ) : null}
          {job.status === 'running' && job.step ? (
            <ProgressBar value={job.step.n / job.step.of} />
          ) : null}
        </View>
      }
    />
  );
}
