import type { ChapterView } from '@studyo/api';
import { courseScope } from '@studyo/api';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { ChapterBadge, ChapterMark, courseBadge } from '@/components/course';
import { Input } from '@/components/inputs';
import { JobPanel } from '@/components/JobPanel';
import { Sheet } from '@/components/Sheet';
import {
  Badge,
  Button,
  Field,
  Header,
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
import { useActiveJobs, useCourse, useOnline } from '@/lib/hooks';
import { keys, queryClient } from '@/lib/query';
import { space } from '@/theme';

/** A course: where you are on the path, what is built, and the one thing to do next. */
export default function CourseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useCourse(id);
  const active = useActiveJobs();
  const { online, reason } = useOnline();
  const [sheet, setSheet] = useState<null | 'edit'>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!q.data) {
    return (
      <Screen header={<Header />}>
        {q.error ? (
          <Notice
            tone="danger"
            icon="error-outline"
            title="Couldn't open this course"
            body={(q.error as Error).message}
          />
        ) : (
          <Loading />
        )}
      </Screen>
    );
  }

  const { course, chapters, estimate } = q.data;
  const scope = courseScope(id);
  const outlineJob =
    (active.data?.jobs ?? []).find((j) => j.topic_id === scope && j.lane === 'work') ??
    q.data.jobs.find(
      (j) => j.topic_id === scope && ['queued', 'running', 'needs_input'].includes(j.status),
    ) ??
    null;
  const lastFailed = !outlineJob
    ? q.data.jobs.find((j) => j.topic_id === scope && j.status === 'failed')
    : undefined;
  const ready = course.status === 'ready';
  const real = chapters.filter((c) => c.kind === 'chapter');
  const done = real.filter((c) => c.state === 'done').length;
  const building = chapters.filter((c) => c.state === 'building').length;
  const badge = courseBadge({ status: course.status, active_job: outlineJob });
  const next = chapters.find((c) => c.state !== 'done');

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: keys.course(id) });
      await queryClient.invalidateQueries({ queryKey: keys.activeJobs });
      await queryClient.invalidateQueries({ queryKey: keys.courses });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen
      header={
        <Header
          right={
            <>
              {ready ? (
                <IconButton
                  name="forum"
                  label="Ask about this course"
                  onPress={() => router.push(`/course/${id}/chat`)}
                />
              ) : null}
              <IconButton name="more-vert" label="More" onPress={() => setSheet('edit')} />
            </>
          }
        />
      }
    >
      <View style={{ paddingTop: space.lg, gap: space.sm }}>
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
          <Badge kind={badge.kind} label={badge.label} />
          <T variant="caps" tone="lead">
            Course
          </T>
        </View>
        <T variant="display" accessibilityRole="header">
          {course.title}
        </T>
        {course.summary ? (
          <T variant="body" tone="lead">
            {course.summary}
          </T>
        ) : null}
        {course.goal ? (
          <T variant="bodySmall" tone="lead">
            Your goal: {course.goal}
          </T>
        ) : null}
        {ready && real.length ? (
          <View style={{ gap: 6, marginTop: space.xs }}>
            <ProgressBar value={done / real.length} height={3} />
            <T variant="meta" tone="lead">
              {done} of {real.length} chapters done
              {building ? ` · ${building} building` : ''}
            </T>
          </View>
        ) : null}
      </View>

      {outlineJob ? <JobPanel job={outlineJob} online={online} /> : null}
      {course.status === 'failed' && !outlineJob ? (
        <Notice
          tone="danger"
          icon="error-outline"
          title="The outline didn't work"
          body={course.failure_reason ?? lastFailed?.error}
          action={
            <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
              {lastFailed ? (
                <Button
                  kind="secondary"
                  label="See the log"
                  onPress={() => router.push(`/job/${lastFailed.id}`)}
                />
              ) : null}
              {!/scanned/i.test(course.failure_reason ?? '') ? (
                <Button
                  label="Try again"
                  icon="refresh"
                  busy={busy === 'outline'}
                  disabled={!online}
                  onPress={() => void run('outline', () => api.redoOutline(id))}
                />
              ) : null}
            </View>
          }
        />
      ) : null}
      {error ? (
        <Notice tone="danger" icon="error-outline" title="That didn't work" body={error} />
      ) : null}

      {ready ? (
        <View style={{ gap: space.sm, marginTop: space.lg }}>
          {next ? (
            <Button
              label={
                next.state === 'planned'
                  ? `Start ${labelOf(next)}`
                  : next.state === 'building'
                    ? `${labelOf(next)} is building`
                    : `${next.state === 'in_progress' ? 'Continue' : 'Open'} ${labelOf(next)}`
              }
              icon={next.state === 'planned' ? 'auto-awesome' : 'menu-book'}
              onPress={() => router.push(`/topic/${next.id}`)}
            />
          ) : null}
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button
              kind="secondary"
              label="Ask about the course"
              icon="forum"
              onPress={() => router.push(`/course/${id}/chat`)}
              style={{ flex: 1 }}
            />
            <Button
              kind="secondary"
              label="Quiz me"
              icon="quiz"
              onPress={() => router.push(`/course/${id}/quizzes`)}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      ) : null}

      {ready && estimate.planned_chapters > 0 ? (
        <View
          style={{
            marginTop: space.lg,
            gap: space.sm,
          }}
        >
          <T variant="bodySmall" tone="lead">
            {estimate.planned_chapters} chapter{estimate.planned_chapters === 1 ? '' : 's'} not
            built yet. Each one is a separate run on your server, so build as many as you want
            ahead.
          </T>
          <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
            {[1, 3].map((n) => (
              <Button
                key={n}
                kind="secondary"
                label={n === 1 ? 'Build next' : `Build next ${n}`}
                icon="auto-awesome"
                busy={busy === `build${n}`}
                disabled={!online || estimate.planned_chapters < 1}
                onPress={() => void run(`build${n}`, () => api.buildChapters(id, { next: n }))}
              />
            ))}
          </View>
          {!online ? (
            <T variant="meta" tone="faint">
              {reason}
            </T>
          ) : null}
        </View>
      ) : null}

      {chapters.length ? (
        <>
          <SectionTitle>{`Chapters · ${chapters.length}`}</SectionTitle>
          {chapters.map((c) => (
            <ChapterRow key={c.id} chapter={c} all={chapters} />
          ))}
        </>
      ) : null}

      {course.sources.length ? (
        <>
          <SectionTitle>Central resources</SectionTitle>
          {course.sources.map((s) => (
            <Row key={s.path} title={s.title} subtitle={s.url ?? s.path} />
          ))}
        </>
      ) : null}

      <Sheet open={sheet === 'edit'} onClose={() => setSheet(null)} title="This course">
        <EditCourse
          id={id}
          title={course.title}
          goal={course.goal ?? ''}
          archived={course.status === 'archived'}
          onDone={() => setSheet(null)}
        />
      </Sheet>
    </Screen>
  );
}

const labelOf = (c: ChapterView) => (c.kind === 'prelim' ? 'the Prelim' : `chapter ${c.order}`);

function ChapterRow({ chapter: c, all }: { chapter: ChapterView; all: ChapterView[] }) {
  const unmet = c.unmet_prereqs
    .map((p) => all.find((x) => x.id === p))
    .filter((x): x is ChapterView => !!x);
  return (
    <Row
      title={c.title}
      leading={<ChapterMark chapter={c} />}
      onPress={() => router.push(`/topic/${c.id}`)}
      accessibilityLabel={`${c.title}, ${c.state}`}
      subtitle={
        <View style={{ gap: 4 }}>
          {c.summary ? (
            <T variant="bodySmall" tone="lead" numberOfLines={2}>
              {c.summary}
            </T>
          ) : null}
          {c.source_range ? (
            <T variant="meta" tone="faint">
              {c.source_range.label}
            </T>
          ) : null}
          {unmet.length && c.state !== 'done' ? (
            <T variant="meta" tone="amber">
              Builds on{' '}
              {unmet.map((u) => (u.kind === 'prelim' ? 'Prelim' : `ch ${u.order}`)).join(', ')}, not
              done yet
            </T>
          ) : null}
          {c.topic.status === 'failed' && c.topic.failure_reason ? (
            <T variant="meta" tone="danger" numberOfLines={2}>
              {c.topic.failure_reason}
            </T>
          ) : null}
          {c.state === 'building' && c.topic.active_job?.activity ? (
            <T variant="meta" tone="amber" numberOfLines={1}>
              {c.topic.active_job.activity}
            </T>
          ) : null}
        </View>
      }
      meta={<ChapterBadge state={c.state} />}
    />
  );
}

function EditCourse({
  id,
  title: t0,
  goal: g0,
  archived,
  onDone,
}: {
  id: string;
  title: string;
  goal: string;
  archived: boolean;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(t0);
  const [goal, setGoal] = useState(g0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (patch: Parameters<typeof api.updateCourse>[1], leave = false) => {
    setBusy(true);
    setError(null);
    try {
      await api.updateCourse(id, patch);
      await queryClient.invalidateQueries({ queryKey: keys.course(id) });
      await queryClient.invalidateQueries({ queryKey: keys.courses });
      if (leave) router.replace('/');
      else onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: space.md }}>
      <Field label="Title">
        <Input value={title} onChangeText={setTitle} accessibilityLabel="Title" />
      </Field>
      <Field label="Your goal" hint="What you want to be able to do when you finish. Optional.">
        <Input value={goal} onChangeText={setGoal} multiline area accessibilityLabel="Goal" />
      </Field>
      {error ? <Notice tone="danger" title={error} /> : null}
      <Button
        label="Save"
        busy={busy}
        disabled={!title.trim()}
        onPress={() => void save({ title, goal })}
      />
      <Button
        kind="secondary"
        label={archived ? 'Unarchive' : 'Archive course'}
        onPress={() => void save({ archived: !archived }, !archived)}
        disabled={busy}
      />
    </View>
  );
}
