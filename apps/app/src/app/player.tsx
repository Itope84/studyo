import { router } from 'expo-router';
import { useState } from 'react';
import { type LayoutChangeEvent, Pressable, View } from 'react-native';
import { Segmented } from '@/components/inputs';
import {
  Button,
  Empty,
  formatTime,
  Header,
  Icon,
  IconButton,
  Row,
  Screen,
  SectionTitle,
  T,
} from '@/components/ui';
import { markDone, play, seek, setSpeed, skip, stop, toggle, usePlayer } from '@/lib/player';
import { usePrefs } from '@/lib/prefs';
import { hit, radius, space, useTheme } from '@/theme';

const SPEEDS = ['0.8', '1', '1.2', '1.5', '2'] as const;

/** Full player: big transport for glancing in the car, scrubber, speed, and what plays next. */
export default function Player() {
  const { c } = useTheme();
  const { track, queue, playing, position, duration, buffering, error } = usePlayer();
  const speed = usePrefs((s) => s.speed);
  const [width, setWidth] = useState(1);
  const [marked, setMarked] = useState(false);

  if (!track) {
    return (
      <Screen header={<Header title="Player" />}>
        <Empty
          icon="graphic-eq"
          title="Nothing playing"
          body="Open a topic and play one of its audio files."
        />
      </Screen>
    );
  }

  const fraction = duration > 0 ? Math.min(1, position / duration) : 0;
  const index = queue.findIndex((t) => t.resource.id === track.resource.id);
  const upNext = index >= 0 ? queue.slice(index + 1) : [];

  return (
    <Screen
      header={
        <Header
          title="Now playing"
          right={
            <IconButton
              name="close"
              label="Stop and close"
              onPress={() => {
                stop();
                router.back();
              }}
            />
          }
        />
      }
    >
      <View style={{ paddingTop: space.xl, gap: space.sm }}>
        <T variant="caps" tone="primary" onPress={() => router.push(`/topic/${track.topicId}`)}>
          {track.topicTitle}
        </T>
        <T variant="display">{track.resource.title}</T>
        <T variant="meta" tone="lead">
          {track.resource.made_with ?? 'Audio'}
          {buffering ? ' · loading…' : ''}
        </T>
        {error ? (
          <T variant="meta" tone="danger">
            {error}
          </T>
        ) : null}
      </View>

      {/* Scrubber: tap anywhere along it to jump. */}
      <View style={{ marginTop: space.xl }}>
        <Pressable
          accessibilityRole="adjustable"
          accessibilityLabel="Playback position"
          accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(position) }}
          onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
          onPress={(e) => void seek((e.nativeEvent.locationX / width) * duration)}
          style={{ height: hit.min, justifyContent: 'center' }}
        >
          <View style={{ height: 4, borderRadius: 2, backgroundColor: c.rule }}>
            <View
              style={{
                width: `${fraction * 100}%`,
                height: 4,
                borderRadius: 2,
                backgroundColor: c.primary,
              }}
            />
          </View>
          <View
            style={{
              position: 'absolute',
              left: `${fraction * 100}%`,
              marginLeft: -8,
              width: 16,
              height: 16,
              borderRadius: 8,
              backgroundColor: c.primary,
            }}
          />
        </Pressable>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <T variant="mono" tone="lead">
            {formatTime(position)}
          </T>
          <T variant="mono" tone="lead">
            -{formatTime(Math.max(0, duration - position))}
          </T>
        </View>
      </View>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.lg,
          marginTop: space.lg,
        }}
      >
        <IconButton
          name="replay-10"
          label="Back 10 seconds"
          size={hit.big}
          onPress={() => void skip(-10)}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Pause' : 'Play'}
          onPress={toggle}
          style={({ pressed }) => ({
            width: 84,
            height: 84,
            borderRadius: 42,
            backgroundColor: c.primary,
            alignItems: 'center',
            justifyContent: 'center',
            transform: [{ scale: pressed ? 0.96 : 1 }],
          })}
        >
          <Icon name={playing ? 'pause' : 'play-arrow'} size={44} tone="onPrimary" />
        </Pressable>
        <IconButton
          name="forward-30"
          label="Forward 30 seconds"
          size={hit.big}
          onPress={() => void skip(30)}
        />
      </View>

      <View style={{ marginTop: space.xl, gap: space.sm }}>
        <T variant="caps" tone="lead">
          Speed
        </T>
        <Segmented
          value={String(speed) as (typeof SPEEDS)[number]}
          onChange={(v) => setSpeed(Number(v))}
          options={SPEEDS.map((s) => ({ value: s, label: `${s}×` }))}
        />
      </View>

      <Button
        kind="secondary"
        icon={marked ? 'check' : 'task-alt'}
        label={marked ? 'Marked as done' : 'Mark as done'}
        onPress={async () => {
          await markDone();
          setMarked(true);
        }}
        style={{ marginTop: space.lg }}
      />

      <SectionTitle>Up next</SectionTitle>
      {upNext.length ? (
        upNext.map((t) => (
          <Row
            key={t.resource.id}
            title={t.resource.title}
            subtitle={t.resource.duration ? formatTime(t.resource.duration) : undefined}
            onPress={() => void play(t, queue, 0)}
          />
        ))
      ) : (
        <View style={{ padding: space.md, borderRadius: radius.base }}>
          <T variant="meta" tone="lead">
            Nothing after this. The player stops at the end of the topic.
          </T>
        </View>
      )}
    </Screen>
  );
}
