import type { Bookmark } from '@studyo/api';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { type LayoutChangeEvent, Pressable, View } from 'react-native';
import { Input } from '@/components/inputs';
import { Sheet } from '@/components/Sheet';
import {
  Button,
  Empty,
  formatTime,
  Header,
  Icon,
  IconButton,
  type IconName,
  Notice,
  Row,
  Screen,
  SectionTitle,
  T,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useTopic } from '@/lib/hooks';
import { markDone, play, seek, setSpeed, skip, stop, toggle, usePlayer } from '@/lib/player';
import { usePrefs } from '@/lib/prefs';
import { keys, queryClient } from '@/lib/query';
import { fonts, hit, radius, space, useTheme } from '@/theme';

const SPEEDS = [0.8, 1, 1.2, 1.5, 2];

/** Full player: cover, big transport for glancing in the car, chapters and bookmarks. */
export default function Player() {
  const { c } = useTheme();
  const { track, queue, playing, position, duration, buffering, error } = usePlayer();
  const speed = usePrefs((s) => s.speed);
  const topic = useTopic(track?.topicId ?? '');
  const [width, setWidth] = useState(1);
  const [marked, setMarked] = useState(false);
  const [sheet, setSheet] = useState<null | 'chapters' | 'bookmark'>(null);

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
  const chapters = track.resource.chapters ?? [];
  const chapterIndex = chapters.reduce((at, ch, i) => (position >= ch.start ? i : at), -1);
  const chapter = chapterIndex >= 0 ? chapters[chapterIndex] : null;
  const bookmarks = (topic.data?.progress.bookmarks ?? [])
    .filter((b) => b.resource_id === track.resource.id)
    .sort((a, b) => a.position - b.position);

  const removeBookmark = async (b: Bookmark) => {
    const progress = await api.deleteBookmark(track.topicId, b.id);
    queryClient.setQueryData(keys.topic(track.topicId), (old: object | undefined) =>
      old ? { ...old, progress } : old,
    );
  };

  return (
    <Screen
      header={
        <Header
          title="Now playing"
          right={
            <>
              <IconButton
                name="bookmark-add"
                label="Bookmark this moment"
                onPress={() => setSheet('bookmark')}
              />
              <IconButton
                name="close"
                label="Stop and close"
                onPress={() => {
                  stop();
                  router.back();
                }}
              />
            </>
          }
        />
      }
    >
      {/* Cover: the pack's first figure, with the topic over it. */}
      <View
        style={{
          marginTop: space.md,
          borderRadius: radius.lg,
          overflow: 'hidden',
          backgroundColor: c.surface,
          aspectRatio: 4 / 3,
        }}
      >
        {track.cover ? (
          <Image
            source={{ uri: track.cover }}
            style={{ width: '100%', height: '100%', backgroundColor: '#fff' }}
            contentFit="contain"
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="graphic-eq" size={64} tone="primary" />
          </View>
        )}
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            padding: space.md,
            backgroundColor: 'rgba(22,22,20,0.62)',
          }}
        >
          <T
            variant="caps"
            style={{ color: '#F3F0ED' }}
            numberOfLines={2}
            onPress={() => router.push(`/topic/${track.topicId}`)}
          >
            {track.topicTitle}
          </T>
        </View>
      </View>

      <View style={{ marginTop: space.lg, gap: space.sm, alignItems: 'center' }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            backgroundColor: c.surface,
            borderRadius: 999,
            paddingHorizontal: 10,
            paddingVertical: 4,
          }}
        >
          <Icon name="graphic-eq" size={14} tone="primary" />
          <T variant="caps" tone="lead">
            {track.resource.made_with
              ? `${track.resource.made_with} audio`
              : track.resource.type === 'video'
                ? 'Video'
                : 'Audio'}
          </T>
        </View>
        <T variant="headline" style={{ textAlign: 'center' }}>
          {track.resource.title}
        </T>
        {chapter ? (
          <T
            variant="meta"
            tone="lead"
            style={{ textAlign: 'center' }}
            onPress={() => setSheet('chapters')}
          >
            Chapter {chapterIndex + 1} · {chapter.title}
          </T>
        ) : null}
        {buffering ? (
          <T variant="meta" tone="lead">
            Loading…
          </T>
        ) : null}
        {error ? (
          <T variant="meta" tone="danger">
            {error}
          </T>
        ) : null}
      </View>

      {/* Scrubber card: tap anywhere along the bar to jump. */}
      <View
        style={{
          marginTop: space.lg,
          backgroundColor: c.surface,
          borderRadius: radius.lg,
          padding: space.md,
          gap: space.sm,
        }}
      >
        <Pressable
          accessibilityRole="adjustable"
          accessibilityLabel="Playback position"
          accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(position) }}
          onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
          onPress={(e) => void seek((e.nativeEvent.locationX / width) * duration)}
          style={{ height: 32, justifyContent: 'center' }}
        >
          <View style={{ height: 6, borderRadius: 3, backgroundColor: c.rule }}>
            <View
              style={{
                width: `${fraction * 100}%`,
                height: 6,
                borderRadius: 3,
                backgroundColor: c.primary,
              }}
            />
            {chapters.slice(1).map((ch) =>
              duration ? (
                <View
                  key={ch.start}
                  style={{
                    position: 'absolute',
                    left: `${(ch.start / duration) * 100}%`,
                    top: 0,
                    width: 2,
                    height: 6,
                    backgroundColor: c.surface,
                  }}
                />
              ) : null,
            )}
          </View>
          <View
            style={{
              position: 'absolute',
              left: `${fraction * 100}%`,
              marginLeft: -9,
              width: 18,
              height: 18,
              borderRadius: 9,
              backgroundColor: c.primary,
              borderWidth: 3,
              borderColor: c.surfaceRaised,
            }}
          />
        </Pressable>
        <View
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <T variant="label" style={{ fontFamily: fonts.uiSemibold }}>
            {formatTime(position)}{' '}
            <T variant="meta" tone="lead">
              elapsed
            </T>
          </T>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              backgroundColor: c.canvas,
              borderRadius: radius.base,
              paddingHorizontal: 8,
              paddingVertical: 3,
            }}
          >
            <Icon name="history" size={13} tone="lead" />
            <T variant="meta" tone="lead">
              {Math.round(fraction * 100)}% finished
            </T>
          </View>
          <T variant="label" tone="primary" style={{ fontFamily: fonts.uiSemibold }}>
            -{formatTime(Math.max(0, duration - position))}{' '}
            <T variant="meta" tone="lead">
              / {formatTime(duration)}
            </T>
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
        <TransportButton
          icon="replay-10"
          label="10s"
          a11y="Back 10 seconds"
          onPress={() => void skip(-10)}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Pause' : 'Play'}
          onPress={toggle}
          style={({ pressed }) => ({
            width: 88,
            height: 88,
            borderRadius: radius.lg * 2,
            backgroundColor: c.primary,
            alignItems: 'center',
            justifyContent: 'center',
            transform: [{ scale: pressed ? 0.96 : 1 }],
          })}
        >
          <Icon name={playing ? 'pause' : 'play-arrow'} size={48} tone="onPrimary" />
        </Pressable>
        <TransportButton
          icon="forward-30"
          label="30s"
          a11y="Forward 30 seconds"
          onPress={() => void skip(30)}
        />
      </View>

      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.lg }}>
        <Tile
          icon="speed"
          label="Speed"
          value={`${speed}×`}
          onPress={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1)}
        />
        <Tile
          icon={marked ? 'check-circle' : 'task-alt'}
          label={marked ? 'Done' : 'Mark done'}
          onPress={async () => {
            await markDone();
            setMarked(true);
          }}
        />
        <Tile
          icon="format-list-bulleted"
          label="Chapters"
          disabled={!chapters.length}
          onPress={() => setSheet('chapters')}
        />
        <Tile icon="bookmark-border" label="Bookmark" onPress={() => setSheet('bookmark')} />
      </View>

      {bookmarks.length ? (
        <>
          <SectionTitle>{`Bookmarks · ${bookmarks.length}`}</SectionTitle>
          {bookmarks.map((b) => (
            <Row
              key={b.id}
              title={b.note || `Bookmark at ${formatTime(b.position)}`}
              subtitle={formatTime(b.position)}
              leading={<Icon name="bookmark" size={20} tone="primary" />}
              onPress={() => void seek(b.position)}
              trailing={
                <IconButton
                  name="delete-outline"
                  label="Remove bookmark"
                  tone="lead"
                  onPress={() => void removeBookmark(b)}
                />
              }
            />
          ))}
        </>
      ) : null}

      <SectionTitle>Up next</SectionTitle>
      {upNext.length ? (
        upNext.map((t) => (
          <Row
            key={t.resource.id}
            title={t.resource.title}
            subtitle={t.resource.duration ? formatTime(t.resource.duration) : undefined}
            leading={<Icon name="queue-music" size={20} tone="sage" />}
            onPress={() => void play(t, queue, 0)}
          />
        ))
      ) : (
        <T variant="meta" tone="lead" style={{ paddingVertical: space.sm }}>
          Nothing after this. The player stops at the end of the topic.
        </T>
      )}

      <Sheet open={sheet === 'chapters'} onClose={() => setSheet(null)} title="Chapters">
        {chapters.map((ch, i) => (
          <Row
            key={`${ch.start}-${i}`}
            title={`${i + 1}. ${ch.title}`}
            subtitle={formatTime(ch.start)}
            active={i === chapterIndex}
            onPress={() => {
              void seek(ch.start);
              setSheet(null);
            }}
          />
        ))}
      </Sheet>
      <BookmarkSheet
        open={sheet === 'bookmark'}
        onClose={() => setSheet(null)}
        topicId={track.topicId}
        resourceId={track.resource.id}
        at={position}
      />
    </Screen>
  );
}

function TransportButton({
  icon,
  label,
  a11y,
  onPress,
}: {
  icon: IconName;
  label: string;
  a11y: string;
  onPress: () => void;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={onPress}
      style={({ pressed }) => ({
        width: hit.big + 8,
        height: hit.big + 8,
        borderRadius: radius.lg * 1.5,
        backgroundColor: pressed ? c.rule : c.surface,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
      })}
    >
      <Icon name={icon} size={28} />
      <T variant="meta" style={{ fontFamily: fonts.uiSemibold }}>
        {label}
      </T>
    </Pressable>
  );
}

function Tile({
  icon,
  label,
  value,
  onPress,
  disabled,
}: {
  icon: IconName;
  label: string;
  value?: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 64,
        borderRadius: radius.lg,
        backgroundColor: pressed ? c.rule : c.surface,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        opacity: disabled ? 0.4 : 1,
      })}
    >
      {value ? (
        <T variant="label" tone="primary" style={{ fontFamily: fonts.uiSemibold }}>
          {value}
        </T>
      ) : (
        <Icon name={icon} size={22} />
      )}
      <T variant="meta">{label}</T>
    </Pressable>
  );
}

function BookmarkSheet({
  open,
  onClose,
  topicId,
  resourceId,
  at,
}: {
  open: boolean;
  onClose: () => void;
  topicId: string;
  resourceId: string;
  at: number;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Capture the moment the sheet opened, not where playback has moved on to.
  const [moment, setMoment] = useState(at);
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setWasOpen(true);
    setMoment(at);
  } else if (!open && wasOpen) setWasOpen(false);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Bookmark ${formatTime(moment)}`}
      footer={
        <Button
          label="Save bookmark"
          icon="bookmark-add"
          busy={busy}
          onPress={async () => {
            setBusy(true);
            setError(null);
            try {
              const progress = await api.addBookmark(topicId, {
                resource_id: resourceId,
                position: moment,
                note: note.trim() || undefined,
              });
              queryClient.setQueryData(keys.topic(topicId), (old: object | undefined) =>
                old ? { ...old, progress } : old,
              );
              setNote('');
              onClose();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      }
    >
      <Input
        value={note}
        onChangeText={setNote}
        placeholder="A note (optional)"
        accessibilityLabel="Bookmark note"
      />
      {error ? <Notice tone="danger" title={error} /> : null}
    </Sheet>
  );
}
