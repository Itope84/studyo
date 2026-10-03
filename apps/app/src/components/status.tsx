import type { Job, TopicStatus } from '@studyo/api';
import { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { useLive } from '@/lib/live';
import { space, useTheme } from '@/theme';
import { Badge, type BadgeKind, Icon, T } from './ui';

export function topicBadge(
  status: TopicStatus,
  job: Job | null,
): { kind: BadgeKind; label: string } {
  if (job?.status === 'needs_input') return { kind: 'waiting', label: 'Needs your answer' };
  if (job?.status === 'queued') return { kind: 'enriching', label: 'Queued' };
  if (job?.status === 'running') {
    return { kind: 'enriching', label: job.kind === 'condense' ? 'Condensing' : 'Enriching' };
  }
  switch (status) {
    case 'ready':
      return { kind: 'ready', label: 'Ready' };
    case 'enriching':
      return { kind: 'enriching', label: 'Enriching' };
    case 'failed':
      return { kind: 'failed', label: 'Failed' };
    case 'archived':
      return { kind: 'neutral', label: 'Archived' };
    default:
      return { kind: 'captured', label: 'Not enriched' };
  }
}

/** A pulsing amber dot for work in progress; respects the static look when nothing runs. */
export function Pulse({ color }: { color?: string }) {
  const { c } = useTheme();
  const v = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <Animated.View
      style={{
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: color ?? c.amber,
        opacity: v,
      }}
    />
  );
}

export function StatusMark({ status, job }: { status: TopicStatus; job: Job | null }) {
  const { c } = useTheme();
  if (job?.status === 'needs_input') return <Icon name="help" size={20} tone="primary" />;
  if (job && (job.status === 'running' || job.status === 'queued')) return <Pulse />;
  if (status === 'failed') return <Icon name="error" size={20} tone="danger" />;
  if (status === 'ready') return <Icon name="check-circle" size={20} tone="sage" />;
  if (status === 'archived') return <Icon name="inventory-2" size={18} tone="faint" />;
  return (
    <View
      style={{ width: 8, height: 8, borderRadius: 4, borderWidth: 1.5, borderColor: c.faint }}
    />
  );
}

export function TopicBadge({ status, job }: { status: TopicStatus; job: Job | null }) {
  const b = topicBadge(status, job);
  return <Badge kind={b.kind} label={b.label} />;
}

/** Online, connecting or offline: always visible on Home. */
export function ConnectionMark() {
  const { c } = useTheme();
  const status = useLive((s) => s.status);
  const reachable = useLive((s) => s.reachable);
  const offline = reachable === false || status === 'down';
  const label = offline ? 'Offline' : status === 'live' ? 'Live' : 'Connecting';
  const color = offline ? c.danger : status === 'live' ? c.sage : c.amber;
  return (
    <View
      accessibilityLabel={`Server ${label}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.sm }}
    >
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />
      <T variant="meta" tone="lead">
        {label}
      </T>
    </View>
  );
}
