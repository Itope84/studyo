import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useLive } from '@/lib/live';
import { fonts, radius, space, useTheme } from '@/theme';
import { Icon, T } from './ui';

const LOGO = require('@/assets/images/icon.png');

/** The Studyo mark and wordmark, with the rust full stop from the design. */
export function Wordmark() {
  const { c } = useTheme();
  return (
    <View
      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm }}
      accessibilityRole="header"
    >
      <Image
        source={LOGO}
        style={{ width: 32, height: 32, borderRadius: radius.lg }}
        accessibilityLabel="Studyo"
      />
      <T
        variant="title"
        style={{ fontFamily: fonts.uiSemibold, fontSize: 19, letterSpacing: -0.3 }}
      >
        studyo
        <T variant="title" style={{ color: c.primary, fontFamily: fonts.uiSemibold, fontSize: 19 }}>
          .
        </T>
      </T>
    </View>
  );
}

/** Server status as an icon with a dot: green when live, amber while connecting, red when offline. */
export function ServerMark() {
  const { c } = useTheme();
  const status = useLive((s) => s.status);
  const reachable = useLive((s) => s.reachable);
  const offline = reachable === false || status === 'down';
  const label = offline
    ? 'Server offline'
    : status === 'live'
      ? 'Server connected'
      : 'Connecting to the server';
  const dot = offline ? c.danger : status === 'live' ? c.sage : c.amber;
  return (
    <Pressable
      onPress={() => router.replace('/settings')}
      accessibilityRole="button"
      accessibilityLabel={`${label}. Open settings`}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: radius.lg,
        backgroundColor: pressed ? c.surface : c.tint,
        alignItems: 'center',
        justifyContent: 'center',
      })}
    >
      <Icon name="dns" size={22} tone="ink" />
      <View
        style={{
          position: 'absolute',
          top: 7,
          right: 7,
          width: 10,
          height: 10,
          borderRadius: 5,
          backgroundColor: dot,
          borderWidth: 2,
          borderColor: c.tint,
        }}
      />
    </Pressable>
  );
}
