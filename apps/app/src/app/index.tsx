import type { ContinueItem, Job, TopicSummary } from '@studyo/api';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { ConnectionMark, StatusMark, TopicBadge } from '@/components/status';
import {
  Button,
  Empty,
  formatTime,
  Loading,
  Notice,
  ProgressBar,
  Row,
  Screen,
  SectionTitle,
  T,
} from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useActiveJobs, useOnline, useServerInfo, useTopics } from '@/lib/hooks';
import { play, topicQueue, usePlayer } from '@/lib/player';
import { usePrefs } from '@/lib/prefs';
import { fonts, radius, space, useTheme } from '@/theme';

export default function Home() {
  const connection = usePrefs((s) => s.connection);
  const [archived, setArchived] = useState(false);
  const topics = useTopics();
  const jobs = useActiveJobs();
  const { online } = useOnline();

  if (!connection) return <Redirect href="/connect" />;

  const data = topics.data;
  const activeByTopic = new Map<string, Job>();
  for (const j of jobs.data?.jobs ?? []) if (j.lane === 'work') activeByTopic.set(j.topic_id, j);
  const waiting = (jobs.data?.jobs ?? []).filter((j) => j.status === 'needs_input');

  return (
    <Screen
      header={
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: space.md,
            paddingTop: space.sm,
            minHeight: 56,
          }}
        >
          <T
            variant="headline"
            style={{ fontFamily: fonts.contentMedium, flex: 1 }}
            accessibilityRole="header"
          >
            Studyo
          </T>
          <ConnectionMark />
        </View>
      }
      footer={
        <View style={{ paddingHorizontal: space.md, paddingVertical: space.sm }}>
          <Button
            label="Add topic"
            icon="add"
            onPress={() => router.push('/add')}
            disabled={!online}
            hint={online ? null : 'Adding a topic needs the server.'}
          />
        </View>
      }
    >
      {topics.error && !(topics.error instanceof ApiError && topics.error.offline) ? (
        <Notice
          tone="danger"
          icon="error-outline"
          title="Couldn't load your library"
          body={(topics.error as Error).message}
        />
      ) : null}
      {!online ? (
        <Notice
          tone="warning"
          icon="cloud-off"
          title="Server offline"
          body="Showing what was loaded last. Adding, enriching and chat come back when the server does."
        />
      ) : null}

      {waiting.map((j) => (
        <QuestionBanner
          key={j.id}
          job={j}
          title={data?.topics.find((t) => t.id === j.topic_id)?.title}
        />
      ))}

      {data?.continue ? <ContinueCard item={data.continue} /> : null}

      <SectionTitle>Topics</SectionTitle>
      {topics.isLoading ? <Loading label="Loading your library" /> : null}
      {data && data.topics.length === 0 ? (
        <Empty
          icon="auto-stories"
          title="Nothing here yet"
          body="Add a link, a PDF or just a topic name. The server builds a study pack from real sources."
        />
      ) : null}
      {data?.topics.map((t) => (
        <TopicRow key={t.id} topic={t} job={activeByTopic.get(t.id) ?? t.active_job ?? null} />
      ))}
      {data ? <ArchivedToggle show={archived} onToggle={() => setArchived((v) => !v)} /> : null}
      {archived ? <ArchivedList /> : null}
    </Screen>
  );
}

function TopicRow({ topic, job }: { topic: TopicSummary; job: Job | null }) {
  const parts: string[] = [];
  if (topic.counts.docs) parts.push(`${topic.counts.docs} doc${topic.counts.docs > 1 ? 's' : ''}`);
  if (topic.counts.media) parts.push(`${topic.counts.media} audio`);
  if (topic.counts.sources)
    parts.push(`${topic.counts.sources} source${topic.counts.sources > 1 ? 's' : ''}`);
  const activity = job?.status === 'running' ? job.activity : null;
  const fraction = topic.progress.fraction;
  return (
    <Row
      title={topic.title}
      leading={<StatusMark status={topic.status} job={job} />}
      onPress={() => router.push(`/topic/${topic.id}`)}
      accessibilityLabel={`${topic.title}, open topic`}
      subtitle={
        <View style={{ gap: 6 }}>
          <View
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}
          >
            <TopicBadge status={topic.status} job={job} />
            {parts.length ? (
              <T variant="meta" tone="lead">
                {parts.join(' · ')}
              </T>
            ) : null}
          </View>
          {topic.summary && !activity ? (
            <T variant="bodySmall" tone="lead" numberOfLines={2}>
              {topic.summary}
            </T>
          ) : null}
          {activity ? (
            <T variant="meta" tone="amber" numberOfLines={1}>
              {job?.step ? `Step ${job.step.n}/${job.step.of} · ` : ''}
              {activity}
            </T>
          ) : null}
          {topic.status === 'failed' && topic.failure_reason ? (
            <T variant="meta" tone="danger" numberOfLines={2}>
              {topic.failure_reason}
            </T>
          ) : null}
        </View>
      }
      meta={
        topic.progress.total ? (
          <View
            style={{ width: 56, gap: 4, alignItems: 'flex-end' }}
            accessibilityLabel={`${Math.round(fraction * 100)}% through, ${topic.progress.done} of ${topic.progress.total} done`}
          >
            <T variant="meta" tone="lead">
              {Math.round(fraction * 100)}%
            </T>
            <View style={{ width: 56 }}>
              <ProgressBar value={fraction} />
            </View>
          </View>
        ) : undefined
      }
    />
  );
}

function QuestionBanner({ job, title }: { job: Job; title?: string }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={() => router.push(`/job/${job.id}`)}
      accessibilityRole="button"
      style={({ pressed }) => ({
        marginTop: space.md,
        borderRadius: radius.base,
        borderWidth: 1,
        borderColor: c.primary,
        backgroundColor: pressed ? c.primarySoft : c.tint,
        padding: space.md,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
      })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="caps" tone="primary">
          Studyo has a question
        </T>
        <T variant="rowTitle">{job.questions?.title ?? 'Before it continues'}</T>
        <T variant="meta" tone="lead">
          {title ?? job.topic_id} · waiting since{' '}
          {new Date(job.questions?.asked ?? job.created).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </T>
      </View>
      <T variant="label" tone="primary" style={{ fontFamily: fonts.uiSemibold }}>
        Answer
      </T>
    </Pressable>
  );
}

function ContinueCard({ item }: { item: ContinueItem }) {
  const { c } = useTheme();
  const server = useServerInfo();
  const current = usePlayer((s) => s.track);
  const r = item.resource;
  const isMedia = r.type === 'audio' || r.type === 'video';
  const duration = item.item.duration ?? r.duration ?? 0;
  const fraction = isMedia ? (duration ? item.item.position / duration : 0) : item.item.position;
  const left =
    isMedia && duration
      ? `${formatTime(Math.max(0, duration - item.item.position))} left`
      : `${Math.round(fraction * 100)}% read`;

  const resume = async () => {
    if (!isMedia || r.type === 'video') {
      router.push(r.type === 'video' ? '/player' : `/topic/${item.topic_id}/read/${r.id}`);
      return;
    }
    const fileToken = server.data?.file_token;
    if (!fileToken) return;
    const detail = await api.topic(item.topic_id);
    const queue = topicQueue(item.topic_id, item.topic_title, detail.topic.resources, fileToken);
    const track = queue.find((t) => t.resource.id === r.id);
    if (track) await play(track, queue, item.item.position);
  };

  if (current?.resource.id === r.id) return null;
  return (
    <View
      style={{
        marginTop: space.md,
        borderRadius: radius.base,
        backgroundColor: c.surface,
        padding: space.md,
        gap: space.sm,
      }}
    >
      <T variant="caps" tone="lead">
        Continue
      </T>
      <T variant="title" numberOfLines={2}>
        {r.title}
      </T>
      <T variant="meta" tone="lead">
        {item.topic_title} · {left}
      </T>
      <ProgressBar value={fraction} />
      <Button
        label={isMedia ? 'Resume' : 'Keep reading'}
        icon={isMedia ? 'play-arrow' : 'menu-book'}
        onPress={() => void resume()}
        style={{ marginTop: space.xs }}
      />
    </View>
  );
}

function ArchivedToggle({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  return (
    <Button
      kind="ghost"
      label={show ? 'Hide archived' : 'Show archived'}
      onPress={onToggle}
      style={{ alignSelf: 'center', marginTop: space.md }}
    />
  );
}

function ArchivedList() {
  const [items, setItems] = useState<TopicSummary[] | null>(null);
  if (items === null) {
    void api.topics(true).then((d) => setItems(d.topics.filter((t) => t.status === 'archived')));
    return <Loading />;
  }
  if (!items.length)
    return (
      <T variant="meta" tone="lead" style={{ textAlign: 'center' }}>
        No archived topics.
      </T>
    );
  return (
    <>
      {items.map((t) => (
        <TopicRow key={t.id} topic={t} job={null} />
      ))}
    </>
  );
}
