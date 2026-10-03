import type { ContinueItem, CourseSummary, Job, TopicSummary } from '@studyo/api';
import { courseScope } from '@studyo/api';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { ServerMark, Wordmark } from '@/components/brand';
import { courseBadge } from '@/components/course';
import { TopicBadge } from '@/components/status';
import {
  Badge,
  Button,
  Empty,
  formatTime,
  IconButton,
  Loading,
  Notice,
  ProgressBar,
  Row,
  Screen,
  SectionTitle,
  T,
} from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useActiveJobs, useCourses, useOnline, useServerInfo, useTopics } from '@/lib/hooks';
import { play, topicQueue, usePlayer } from '@/lib/player';
import { usePrefs } from '@/lib/prefs';
import { fonts, radius, space, useTheme } from '@/theme';

export default function Home() {
  const connection = usePrefs((s) => s.connection);
  const [archived, setArchived] = useState(false);
  const topics = useTopics();
  const courses = useCourses();
  const jobs = useActiveJobs();
  const { online } = useOnline();
  const dismissed = usePrefs((s) => s.dismissedContinue);
  const dismiss = usePrefs((s) => s.dismissContinue);
  const sort = usePrefs((s) => s.homeSort);
  const setSort = usePrefs((s) => s.setHomeSort);

  if (!connection) return <Redirect href="/connect" />;

  const data = topics.data;
  const standalone = (data?.topics ?? []).filter((t) => !t.course_id);
  const courseList = courses.data?.courses ?? [];
  const titles = new Map<string, string>([
    ...(data?.topics ?? []).map((t) => [t.id, t.title] as const),
    ...courseList.map((c) => [courseScope(c.id), c.title] as const),
  ]);
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
          <Wordmark />
          <ServerMark />
        </View>
      }
      footer={
        <View style={{ paddingHorizontal: space.md, paddingVertical: space.sm, gap: space.xs }}>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button
              label="Add topic"
              icon="add"
              onPress={() => router.push('/add')}
              disabled={!online}
              style={{ flex: 1 }}
            />
            <Button
              kind="secondary"
              label="Add course"
              icon="school"
              onPress={() => router.push('/add?kind=course')}
              disabled={!online}
              style={{ flex: 1 }}
            />
          </View>
          {online ? null : (
            <T variant="meta" tone="faint">
              Adding needs the server.
            </T>
          )}
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
        <QuestionBanner key={j.id} job={j} title={titles.get(j.topic_id)} />
      ))}

      {data?.continue && dismissed !== continueKey(data.continue) ? (
        <ContinueCard
          item={data.continue}
          onDismiss={() => dismiss(continueKey(data.continue as ContinueItem))}
        />
      ) : null}

      {courseList.length ? (
        <>
          <SectionTitle>Courses</SectionTitle>
          {courseList.map((c) => (
            <CourseRow key={c.id} course={c} />
          ))}
        </>
      ) : null}

      <SectionTitle
        right={standalone.length > 1 ? <SortMenu value={sort} onChange={setSort} /> : undefined}
      >
        Topics
      </SectionTitle>
      {topics.isLoading ? <Loading label="Loading your library" /> : null}
      {data && standalone.length === 0 && courseList.length === 0 ? (
        <Empty
          icon="auto-stories"
          title="Nothing here yet"
          body="Add a link, a PDF or just a topic name. The server builds a study pack from real sources."
        />
      ) : null}
      {sortTopics(standalone, sort).map((t) => (
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

function CourseRow({ course }: { course: CourseSummary }) {
  const badge = courseBadge(course);
  const { counts, next_chapter: next } = course;
  const job = course.active_job;
  return (
    <Row
      title={course.title}
      onPress={() => router.push(`/course/${course.id}`)}
      accessibilityLabel={`${course.title}, open course`}
      subtitle={
        <View style={{ gap: 6 }}>
          <View
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}
          >
            <Badge kind={badge.kind} label={badge.label} />
            {counts.chapters ? (
              <T variant="meta" tone="lead">
                {counts.done} of {counts.chapters} chapters done · {counts.built} built
              </T>
            ) : null}
          </View>
          {job?.status === 'running' && job.activity ? (
            <T variant="meta" tone="amber" numberOfLines={1}>
              {job.activity}
            </T>
          ) : next && course.status === 'ready' ? (
            <T variant="bodySmall" tone="lead" numberOfLines={1}>
              Next: {next.title}
            </T>
          ) : course.summary ? (
            <T variant="bodySmall" tone="lead" numberOfLines={2}>
              {course.summary}
            </T>
          ) : null}
          {course.status === 'failed' && course.failure_reason ? (
            <T variant="meta" tone="danger" numberOfLines={2}>
              {course.failure_reason}
            </T>
          ) : null}
        </View>
      }
      meta={
        counts.chapters ? (
          <View style={{ width: 56, gap: 4, alignItems: 'flex-end' }}>
            <T variant="meta" tone="lead">
              {Math.round(course.progress.fraction * 100)}%
            </T>
            <View style={{ width: 56 }}>
              <ProgressBar value={course.progress.fraction} />
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

function ContinueCard({ item, onDismiss }: { item: ContinueItem; onDismiss: () => void }) {
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
      router.push(
        r.type === 'video'
          ? `/topic/${item.topic_id}/watch/${r.id}`
          : `/topic/${item.topic_id}/read/${r.id}`,
      );
      return;
    }
    const fileToken = server.data?.file_token;
    if (!fileToken) return;
    const detail = await api.topic(item.topic_id);
    const queue = topicQueue(
      item.topic_id,
      item.topic_title,
      detail.topic.resources,
      fileToken,
      detail.topic.cover_path ?? null,
    );
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
        paddingVertical: space.sm,
        paddingLeft: space.md,
        paddingRight: space.xs,
        gap: space.sm,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Pressable
          style={{ flex: 1, gap: 2 }}
          onPress={() => void resume()}
          accessibilityRole="button"
          accessibilityLabel={`Continue ${r.title}`}
        >
          <T variant="caps" tone="lead">
            Continue {isMedia ? 'listening' : 'reading'}
          </T>
          <T variant="rowTitle" numberOfLines={1}>
            {r.title}
          </T>
          <T variant="meta" tone="lead" numberOfLines={1}>
            {left} · {item.topic_title}
          </T>
        </Pressable>
        <IconButton
          name={isMedia ? 'play-arrow' : 'menu-book'}
          label={isMedia ? 'Resume' : 'Keep reading'}
          filled
          onPress={() => void resume()}
        />
        <IconButton name="close" label="Hide this" tone="lead" onPress={onDismiss} />
      </View>
      <View style={{ paddingRight: space.sm }}>
        <ProgressBar value={fraction} />
      </View>
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

const continueKey = (c: ContinueItem) => `${c.topic_id}:${c.resource.id}`;

type Sort = 'recent' | 'title' | 'progress';

function sortTopics(list: TopicSummary[], sort: Sort): TopicSummary[] {
  const copy = [...list];
  if (sort === 'title') copy.sort((a, b) => a.title.localeCompare(b.title));
  else if (sort === 'progress') copy.sort((a, b) => a.progress.fraction - b.progress.fraction);
  else copy.sort((a, b) => b.updated.localeCompare(a.updated));
  return copy;
}

const SORT_LABEL: Record<Sort, string> = {
  recent: 'Recent first',
  title: 'A to Z',
  progress: 'Least done first',
};

function SortMenu({ value, onChange }: { value: Sort; onChange: (s: Sort) => void }) {
  const order: Sort[] = ['recent', 'title', 'progress'];
  const next = order[(order.indexOf(value) + 1) % order.length] as Sort;
  return (
    <Button kind="ghost" icon="sort" label={SORT_LABEL[value]} onPress={() => onChange(next)} />
  );
}
