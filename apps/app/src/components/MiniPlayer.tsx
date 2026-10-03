import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useChrome } from '@/lib/chrome';
import { skip, toggle, usePlayer } from '@/lib/player';
import { DOCK_HEIGHT, MAX_WIDTH, space, TAB_HEIGHT, useTheme } from '@/theme';
import { formatTime, IconButton, T } from './ui';

/** Persistent dock while something plays. Hidden on the full player itself. */
export function MiniPlayer() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const path = usePathname();
  const { tabs } = useChrome();
  const { track, playing, position, duration, buffering } = usePlayer();
  if (!track || path === '/player') return null;
  const fraction = duration > 0 ? position / duration : 0;
  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { paddingBottom: insets.bottom + (tabs ? TAB_HEIGHT : 0) }]}
    >
      <View
        style={[
          styles.dock,
          { backgroundColor: c.surfaceRaised, borderColor: c.rule, shadowColor: '#1E1E1C' },
        ]}
      >
        <View style={[styles.scrub, { backgroundColor: c.rule }]}>
          <View style={{ width: `${fraction * 100}%`, height: 2, backgroundColor: c.primary }} />
        </View>
        <Pressable
          style={styles.info}
          onPress={() => router.push('/player')}
          accessibilityRole="button"
          accessibilityLabel={`Open player: ${track.resource.title}`}
        >
          <T variant="label" numberOfLines={1}>
            {track.resource.title}
          </T>
          <T variant="meta" tone="lead" numberOfLines={1}>
            {buffering ? 'Loading…' : `${formatTime(position)} / ${formatTime(duration)}`} ·{' '}
            {track.topicTitle}
          </T>
        </Pressable>
        <IconButton name="replay-30" label="Back 30 seconds" onPress={() => void skip(-30)} />
        <IconButton
          name={playing ? 'pause' : 'play-arrow'}
          label={playing ? 'Pause' : 'Play'}
          onPress={toggle}
          filled
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  dock: {
    width: '100%',
    maxWidth: MAX_WIDTH,
    height: DOCK_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingLeft: space.md,
    paddingRight: space.sm,
    borderTopWidth: 1,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 6,
  },
  scrub: { position: 'absolute', top: -1, left: 0, right: 0, height: 2 },
  info: { flex: 1, justifyContent: 'center', gap: 2, minHeight: 48 },
});
