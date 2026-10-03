import type { Topic } from '@studyo/api';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { ApiError, api } from '@/lib/api';
import { useCourse } from '@/lib/hooks';
import { keys, queryClient } from '@/lib/query';
import { radius, space, useTheme } from '@/theme';
import { ChapterBadge } from './course';
import { Button, Icon, Notice, T } from './ui';

/** Where this chapter sits in its course, what it builds on, and the done mark. */
export function ChapterBanner({ topic, online }: { topic: Topic; online: boolean }) {
  const { c } = useTheme();
  const ref = topic.course;
  const course = useCourse(ref?.course_id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!ref) return null;
  const chapters = course.data?.chapters ?? [];
  const view = chapters.find((x) => x.id === topic.id);
  const total = chapters.filter((x) => x.kind === 'chapter').length;
  const unmet = (view?.unmet_prereqs ?? [])
    .map((id) => chapters.find((x) => x.id === id))
    .filter((x): x is NonNullable<typeof x> => !!x);
  const idx = chapters.findIndex((x) => x.id === topic.id);
  const next = idx >= 0 ? chapters.slice(idx + 1).find((x) => x.state !== 'done') : undefined;
  const canMark =
    view && (view.state === 'ready' || view.state === 'in_progress' || view.state === 'done');

  const mark = async (done: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await api.completeChapter(ref.course_id, topic.id, done);
      await queryClient.invalidateQueries({ queryKey: keys.course(ref.course_id) });
      await queryClient.invalidateQueries({ queryKey: keys.topic(topic.id) });
      await queryClient.invalidateQueries({ queryKey: keys.courses });
      await queryClient.invalidateQueries({ queryKey: keys.profile });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: space.sm, marginTop: space.md }}>
      <Pressable
        onPress={() => router.push(`/course/${ref.course_id}`)}
        accessibilityRole="button"
        accessibilityLabel="Open the course"
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          borderRadius: radius.base,
          backgroundColor: pressed ? c.surface : c.tint,
          borderWidth: 1,
          borderColor: c.rule,
          padding: space.md,
        })}
      >
        <Icon name="school" size={20} tone="primary" />
        <View style={{ flex: 1, gap: 2 }}>
          <T variant="caps" tone="primary">
            {ref.kind === 'prelim'
              ? 'Prelim'
              : `Chapter ${ref.order}${total ? ` of ${total}` : ''}`}
          </T>
          <T variant="label" numberOfLines={1}>
            {course.data?.course.title ?? 'Course'}
          </T>
        </View>
        {view ? <ChapterBadge state={view.state} /> : null}
      </Pressable>
      {unmet.length && view?.state !== 'done' ? (
        <Notice
          tone="warning"
          icon="route"
          title="This builds on chapters you haven't finished"
          body="Nothing is locked. Read on if you like, or start with these."
          action={
            <View style={{ gap: space.xs }}>
              {unmet.map((u) => (
                <Button
                  key={u.id}
                  kind="secondary"
                  label={u.kind === 'prelim' ? `Prelim: ${u.title}` : `${u.order}. ${u.title}`}
                  onPress={() => router.push(`/topic/${u.id}`)}
                />
              ))}
            </View>
          }
        />
      ) : null}
      {error ? <Notice tone="danger" title={error} /> : null}
      {canMark ? (
        <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
          <Button
            kind={view?.state === 'done' ? 'secondary' : 'primary'}
            icon={view?.state === 'done' ? 'undo' : 'check'}
            label={view?.state === 'done' ? 'Mark not done' : 'Mark chapter done'}
            busy={busy}
            disabled={!online}
            onPress={() => void mark(view?.state !== 'done')}
          />
          {view?.state === 'done' && next ? (
            <Button
              kind="secondary"
              icon="arrow-forward"
              label={`Next: ${next.title}`}
              onPress={() => router.push(`/topic/${next.id}`)}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
