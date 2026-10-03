import type { ChapterState, ChapterView, CourseSummary } from '@studyo/api';
import { View } from 'react-native';
import { space, useTheme } from '@/theme';
import { Badge, type BadgeKind, T } from './ui';

export const CHAPTER_BADGE: Record<ChapterState, { kind: BadgeKind; label: string }> = {
  planned: { kind: 'captured', label: 'Not built' },
  building: { kind: 'enriching', label: 'Building' },
  ready: { kind: 'ready', label: 'Ready' },
  in_progress: { kind: 'waiting', label: 'In progress' },
  done: { kind: 'downloaded', label: 'Done' },
};

export function ChapterBadge({ state }: { state: ChapterState }) {
  const b = CHAPTER_BADGE[state];
  return <Badge kind={b.kind} label={b.label} />;
}

/** The chapter number in a ring; the Prelim is a "P". */
export function ChapterMark({
  chapter,
}: {
  chapter: Pick<ChapterView, 'kind' | 'order' | 'state'>;
}) {
  const { c } = useTheme();
  const done = chapter.state === 'done';
  return (
    <View
      style={{
        width: 32,
        height: 32,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: done ? c.sage : c.ruleStrong,
        backgroundColor: done ? c.sageSoft : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <T variant="meta" tone={done ? 'sage' : 'lead'}>
        {chapter.kind === 'prelim' ? 'P' : String(chapter.order)}
      </T>
    </View>
  );
}

export function courseBadge(course: Pick<CourseSummary, 'status' | 'active_job'>): {
  kind: BadgeKind;
  label: string;
} {
  const job = course.active_job;
  if (job?.status === 'needs_input') return { kind: 'waiting', label: 'Needs your answer' };
  if (job?.kind === 'course-outline') return { kind: 'enriching', label: 'Planning' };
  if (job) return { kind: 'enriching', label: 'Building' };
  switch (course.status) {
    case 'ready':
      return { kind: 'ready', label: 'Ready' };
    case 'planning':
      return { kind: 'enriching', label: 'Planning' };
    case 'failed':
      return { kind: 'failed', label: 'Failed' };
    case 'archived':
      return { kind: 'neutral', label: 'Archived' };
    default:
      return { kind: 'captured', label: 'No outline yet' };
  }
}

export function Gap({ children }: { children: React.ReactNode }) {
  return <View style={{ marginTop: space.md }}>{children}</View>;
}
