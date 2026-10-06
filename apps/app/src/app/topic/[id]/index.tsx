import type { Progress, Resource, Topic } from '@studyo/api';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, Pressable, View } from 'react-native';
import { DeleteAudioSheet, ListenSheet } from '@/components/AudioSheets';
import { ChapterBanner } from '@/components/ChapterBanner';
import { CondenseSheet, DeleteDocSheet } from '@/components/DocSheets';
import { DownloadSheet } from '@/components/DownloadSheet';
import { Input } from '@/components/inputs';
import { JobPanel } from '@/components/JobPanel';
import { Sheet } from '@/components/Sheet';
import { SwipeRow } from '@/components/SwipeRow';
import { TopicBadge } from '@/components/status';
import { UploadCard } from '@/components/UploadCard';
import {
  Badge,
  Button,
  formatBytes,
  formatTime,
  Header,
  Icon,
  IconButton,
  Loading,
  Notice,
  ProgressBar,
  Row,
  Screen,
  SectionTitle,
  T,
  timeAgo,
} from '@/components/ui';
import { ApiError, api, fileUrl, type UploadProgress } from '@/lib/api';
import { audioFor, isGeneratedAudio, voicesLabel } from '@/lib/audio';
import { useActiveJobs, useOnline, useServerInfo, useTopic, useTopicJob } from '@/lib/hooks';
import { play, topicQueue, usePlayer } from '@/lib/player';
import { keys, queryClient } from '@/lib/query';
import { MEDIA_TYPES, pickFile } from '@/lib/upload';
import { radius, space, useTheme } from '@/theme';

export default function TopicScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useTopic(id);
  const liveJob = useTopicJob(id);
  const activeJobs = useActiveJobs();
  const { online, reason } = useOnline();
  const server = useServerInfo();
  const [regen, setRegen] = useState<Resource | null>(null);
  const [removing, setRemoving] = useState<Resource | null>(null);
  const [sheet, setSheet] = useState<null | 'condense' | 'rename' | 'deeper' | 'more' | 'reenrich'>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [download, setDownload] = useState<Resource | null>(null);
  const [listen, setListen] = useState<null | { replace: Resource | null }>(null);
  const [audioMenu, setAudioMenu] = useState<Resource | null>(null);
  const [removingAudio, setRemovingAudio] = useState<Resource | null>(null);
  const [uploading, setUploading] = useState<{
    name: string;
    size: number;
    progress: UploadProgress | null;
    controller: AbortController;
  } | null>(null);

  if (!q.data) {
    return (
      <Screen header={<Header />}>
        {q.error ? (
          <Notice
            tone="danger"
            icon="error-outline"
            title="Couldn't open this topic"
            body={(q.error as Error).message}
          />
        ) : (
          <Loading />
        )}
      </Screen>
    );
  }

  const { topic, progress, jobs } = q.data;
  // The live job list wins once loaded; the topic snapshot can lag a just-finished job.
  const activeJob = activeJobs.data
    ? liveJob
    : (jobs.find(
        (j) => ['queued', 'running', 'needs_input'].includes(j.status) && j.lane === 'work',
      ) ?? null);
  const lastFailed = !activeJob
    ? jobs.find((j) => j.lane === 'work' && j.status === 'failed')
    : undefined;
  const docs = topic.resources.filter((r) => r.type === 'pack' || r.type === 'condensed');
  const media = topic.resources.filter((r) => r.type === 'audio' || r.type === 'video');
  const sources = topic.resources.filter((r) => r.type === 'source');
  const pack = docs.find((r) => r.type === 'pack');
  const condensed = docs.filter((r) => r.type === 'condensed');
  const audios = topic.resources.filter(isGeneratedAudio);
  const busyTopic = !!activeJob;
  const offlineReason = online ? null : reason;

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: keys.topic(id) });
      await queryClient.invalidateQueries({ queryKey: keys.activeJobs });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const enrich = () => run('enrich', () => api.startJob(id, { kind: 'enrich' }));
  const addFile = async () => {
    setError(null);
    const picked = await pickFile(
      [...MEDIA_TYPES, ...(Platform.OS === 'web' ? ['.md', 'text/markdown'] : ['text/markdown'])],
      {},
    );
    if (!picked) return;
    const controller = new AbortController();
    setUploading({ name: picked.name, size: picked.size, progress: null, controller });
    try {
      await api.upload(
        id,
        picked,
        /notebooklm/i.test(picked.name) ? 'NotebookLM' : '',
        (p) => setUploading((u) => (u ? { ...u, progress: p } : u)),
        controller.signal,
      );
      await queryClient.invalidateQueries({ queryKey: keys.topic(id) });
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'aborted')) {
        setError(e instanceof ApiError ? e.message : (e as Error).message);
      }
    } finally {
      setUploading(null);
    }
  };

  const playMedia = async (r: Resource) => {
    if (r.type === 'video') {
      router.push(`/topic/${id}/watch/${r.id}`);
      return;
    }
    const token = server.data?.file_token;
    if (!token) return;
    const queue = topicQueue(id, topic.title, topic.resources, token, topic.cover_path ?? null);
    const track = queue.find((t) => t.resource.id === r.id);
    const item = progress.items[r.id];
    if (track) await play(track, queue, item && !item.done ? item.position : 0);
  };

  return (
    <Screen
      header={
        <Header
          right={
            <>
              {!pack ? (
                <IconButton
                  name="forum"
                  label="Ask about this topic"
                  onPress={() => router.push(`/topic/${id}/chat`)}
                  disabled={!docs.length && !sources.length}
                />
              ) : null}
              <IconButton name="more-vert" label="More" onPress={() => setSheet('more')} />
            </>
          }
        />
      }
    >
      <View style={{ paddingTop: space.lg, gap: space.sm }}>
        {topic.course ? null : <TopicBadge status={topic.status} job={activeJob} />}
        <T variant="display" accessibilityRole="header">
          {topic.title}
        </T>
        {topic.summary || topic.course?.summary ? (
          <T variant="body" tone="lead">
            {topic.summary ?? topic.course?.summary}
          </T>
        ) : null}
        {topic.course ? null : <OriginLine topic={topic} />}
      </View>
      {topic.course ? <ChapterBanner topic={topic} online={online} /> : null}

      {activeJob ? <JobPanel job={activeJob} online={online} /> : null}
      {lastFailed && topic.status !== 'ready' ? (
        <Notice
          tone="danger"
          icon="error-outline"
          title="The last run failed"
          body={lastFailed.error ?? topic.failure_reason}
          action={
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button
                label="Try again"
                icon="refresh"
                onPress={enrich}
                busy={busy === 'enrich'}
                disabled={!online}
              />
              <Button
                kind="secondary"
                label="See the log"
                onPress={() => router.push(`/job/${lastFailed.id}`)}
              />
            </View>
          }
        />
      ) : null}
      {lastFailed && topic.status === 'ready' ? (
        <Notice
          tone="warning"
          icon="warning-amber"
          title={`${lastFailed.kind === 'condense' ? 'Condensing' : 'Going deeper'} failed`}
          body={lastFailed.error}
          action={
            <Button
              kind="secondary"
              label="See the log"
              onPress={() => router.push(`/job/${lastFailed.id}`)}
            />
          }
        />
      ) : null}
      {uploading ? <UploadCard {...uploading} /> : null}
      {error ? (
        <Notice tone="danger" icon="error-outline" title="That didn't work" body={error} />
      ) : null}
      {!online ? (
        <Notice
          tone="warning"
          icon="cloud-off"
          title="Server offline"
          body="Reading and listening need the server until downloads arrive in the Android app."
        />
      ) : null}

      {/* No pack yet: building it is the one thing to do. Otherwise, the topic's actions. */}
      {!pack && !busyTopic ? (
        <View style={{ marginTop: space.lg }}>
          <Button
            label="Build the study pack"
            icon="auto-awesome"
            onPress={enrich}
            busy={busy === 'enrich'}
            disabled={!online}
            hint={offlineReason}
          />
        </View>
      ) : null}
      {pack ? (
        <View style={{ gap: space.sm, marginTop: space.lg }}>
          <Button
            label="Ask in chat"
            icon="forum"
            onPress={() => router.push(`/topic/${id}/chat`)}
          />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button
              kind="secondary"
              label="Quiz me"
              icon="quiz"
              onPress={() => router.push(`/topic/${id}/quizzes`)}
              style={{ flex: 1 }}
            />
            <Button
              kind="secondary"
              label="Take-home"
              icon="assignment"
              onPress={() => router.push(`/topic/${id}/assignments`)}
              style={{ flex: 1 }}
            />
          </View>
          <Button
            kind="secondary"
            label="Upload media"
            icon="upload-file"
            onPress={addFile}
            busy={!!uploading}
            disabled={!online}
          />
        </View>
      ) : null}

      {topic.learning?.goal || topic.learning?.gaps?.length ? (
        <LearningBlock topic={topic} />
      ) : null}

      <SectionTitle
        right={
          pack ? (
            <Button
              kind="ghost"
              label="Condensed doc"
              icon="add"
              onPress={() => {
                setRegen(null);
                setSheet('condense');
              }}
              disabled={!online || busyTopic}
            />
          ) : undefined
        }
      >
        Read
      </SectionTitle>
      {docs.length === 0 ? (
        <T variant="bodySmall" tone="lead" style={{ paddingVertical: space.sm }}>
          {busyTopic ? 'The pack appears here when the run finishes.' : 'No documents yet.'}
        </T>
      ) : (
        docs.map((r) => (
          <DocRow
            key={r.id}
            topicId={id}
            r={r}
            progress={progress}
            online={online}
            onDownload={() => setDownload(r)}
            onRecondense={() => setSheet('reenrich')}
            busyTopic={busyTopic}
            onRegenerate={() => {
              setRegen(r);
              setSheet('condense');
            }}
            onDelete={() => setRemoving(r)}
          />
        ))
      )}

      <SectionTitle
        right={
          pack ? (
            <Button
              kind="ghost"
              label="Make audio"
              icon="headphones"
              onPress={() => setListen({ replace: null })}
              disabled={!online || busyTopic}
            />
          ) : (
            <Button
              kind="ghost"
              label="Upload media"
              icon="upload-file"
              onPress={addFile}
              busy={!!uploading}
              disabled={!online}
            />
          )
        }
      >
        {media.length ? `Listen and watch · ${media.length}` : 'Listen and watch'}
      </SectionTitle>
      {media.length === 0 ? (
        <T variant="bodySmall" tone="lead" style={{ paddingVertical: space.sm }}>
          Listen to a condensed doc as audio, or upload audio and video you made elsewhere, for
          example in NotebookLM.
        </T>
      ) : (
        <View style={{ gap: space.sm }}>
          {media.map((r) => (
            <MediaCard
              key={r.id}
              r={r}
              progress={progress}
              onPlay={() => void playMedia(r)}
              online={online}
              source={
                r.source_id ? (condensed.find((d) => d.id === r.source_id) ?? null) : undefined
              }
              onMenu={isGeneratedAudio(r) ? () => setAudioMenu(r) : undefined}
            />
          ))}
        </View>
      )}

      <SectionTitle>{`Sources${sources.length ? ` (${sources.length})` : ''}`}</SectionTitle>
      {sources.length === 0 ? (
        <T variant="bodySmall" tone="lead" style={{ paddingVertical: space.sm }}>
          {topic.origin.type === 'topic'
            ? 'The AI will find primary sources and list them here.'
            : 'The original appears here once captured.'}
        </T>
      ) : (
        sources.map((r) => (
          <Row
            key={r.id}
            title={r.title}
            leading={
              <Icon
                name={r.path.endsWith('.pdf') ? 'picture-as-pdf' : 'article'}
                size={20}
                tone="sage"
              />
            }
            subtitle={`${r.id}${r.url ? ` · ${new URL(r.url).hostname.replace(/^www\./, '')}` : ''}${r.size ? ` · ${formatBytes(r.size)}` : ''}`}
            trailing={<Icon name="open-in-new" size={18} tone="faint" />}
            onPress={() => {
              const token = server.data?.file_token;
              const target = r.url ?? (token ? fileUrl(token, `topics/${id}/${r.path}`) : null);
              if (target) void Linking.openURL(target);
            }}
          />
        ))
      )}

      <TopicMenu
        open={sheet === 'more'}
        onClose={() => setSheet(null)}
        topic={topic}
        online={online}
        busyTopic={busyTopic}
        hasPack={!!pack}
        onRename={() => setSheet('rename')}
        onDeeper={() => setSheet('deeper')}
        onEnrich={enrich}
        onArchive={() =>
          run('archive', async () => {
            await api.updateTopic(id, { archived: topic.status !== 'archived' });
            await queryClient.invalidateQueries({ queryKey: keys.topics });
            setSheet(null);
            if (topic.status !== 'archived') router.replace('/');
          })
        }
        onMarkRead={() =>
          run('read', async () => {
            await api.markRead(id);
            setSheet(null);
          })
        }
      />
      <DownloadSheet
        open={!!download}
        onClose={() => setDownload(null)}
        topicId={id}
        resource={download}
      />
      <RenameSheet open={sheet === 'rename'} onClose={() => setSheet(null)} topic={topic} />
      <CondenseSheet
        open={sheet === 'condense'}
        onClose={() => setSheet(null)}
        topicId={id}
        packId={pack?.id ?? null}
        isCourse={!!topic.course}
        regenerate={regen}
        audios={audios}
      />
      <DeleteDocSheet
        doc={removing}
        onClose={() => setRemoving(null)}
        topicId={id}
        audios={audios}
      />
      <ListenSheet
        open={!!listen}
        onClose={() => setListen(null)}
        topicId={id}
        docs={condensed}
        replace={listen?.replace ?? null}
        hasPack={!!pack}
        isCourse={!!topic.course}
      />
      <AudioMenu
        audio={audioMenu}
        online={online}
        busyTopic={busyTopic}
        sourceGone={!!audioMenu && !condensed.some((d) => d.id === audioMenu.source_id)}
        onClose={() => setAudioMenu(null)}
        onRegenerate={(a) => {
          setAudioMenu(null);
          setListen({ replace: a });
        }}
        onDelete={(a) => {
          setAudioMenu(null);
          setRemovingAudio(a);
        }}
      />
      <DeleteAudioSheet audio={removingAudio} onClose={() => setRemovingAudio(null)} topicId={id} />
      <ReenrichSheet
        open={sheet === 'reenrich'}
        onClose={() => setSheet(null)}
        onRebuild={() => {
          setSheet(null);
          void enrich();
        }}
        onDeeper={() => setSheet('deeper')}
      />
      <DeeperSheet open={sheet === 'deeper'} onClose={() => setSheet(null)} topicId={id} />
    </Screen>
  );
}

function OriginLine({ topic }: { topic: Topic }) {
  const o = topic.origin;
  let text = '';
  if (o.type === 'link' && o.link) {
    try {
      text = `From a link · ${new URL(o.link).hostname.replace(/^www\./, '')}`;
    } catch {
      text = 'From a link';
    }
  } else if (o.type === 'pdf') text = 'From a PDF';
  else text = `From a topic name · “${o.name}”`;
  return (
    <T
      variant="meta"
      tone="lead"
      onPress={
        o.type === 'link' && o.link ? () => void Linking.openURL(o.link as string) : undefined
      }
    >
      {text} · updated {timeAgo(topic.updated)}
    </T>
  );
}

function LearningBlock({ topic }: { topic: Topic }) {
  const [open, setOpen] = useState(false);
  const gaps = topic.learning?.gaps ?? [];
  return (
    <View style={{ marginTop: space.lg }}>
      <SectionTitle
        right={
          gaps.length ? (
            <Button
              kind="ghost"
              label={open ? 'Hide' : `${gaps.length} concepts`}
              onPress={() => setOpen((v) => !v)}
            />
          ) : undefined
        }
      >
        Your goal
      </SectionTitle>
      {topic.learning?.goal ? <T variant="bodySmall">{topic.learning.goal}</T> : null}
      {open
        ? gaps.map((g) => (
            <T key={g} variant="meta" tone="lead" style={{ marginTop: 6 }}>
              • {g}
            </T>
          ))
        : null}
    </View>
  );
}

function DocRow({
  topicId,
  r,
  progress,
  online,
  onDownload,
  onRecondense,
  busyTopic,
  onRegenerate,
  onDelete,
}: {
  topicId: string;
  r: Resource;
  progress: Progress;
  online: boolean;
  onDownload: () => void;
  onRecondense: () => void;
  busyTopic: boolean;
  onRegenerate: () => void;
  onDelete: () => void;
}) {
  const item = progress.items[r.id];
  const fraction = item?.done ? 1 : (item?.position ?? 0);
  const row = (
    <Row
      title={r.title}
      leading={
        <Icon
          name={r.type === 'pack' ? 'library-books' : 'auto-stories'}
          size={20}
          tone={r.type === 'pack' ? 'primary' : 'sage'}
        />
      }
      subtitle={
        <View style={{ gap: 6 }}>
          {r.description ? (
            <T variant="bodySmall" tone="lead" numberOfLines={2}>
              {r.description}
            </T>
          ) : null}
          <T variant="meta" tone="lead">
            {r.type === 'pack'
              ? 'Study pack'
              : r.depth === 'longer'
                ? 'Deep dive'
                : 'Condensed doc'}
            {r.read_minutes ? ` · ${r.read_minutes} min read` : ''}
            {item?.done ? ' · Read' : item ? ` · ${Math.round(fraction * 100)}% read` : ''}
          </T>
          {item && !item.done ? <ProgressBar value={fraction} /> : null}
        </View>
      }
      meta={item?.done ? <Icon name="check-circle" size={18} tone="sage" /> : undefined}
      onPress={() => router.push(`/topic/${topicId}/read/${r.id}`)}
      disabled={!online}
      disabledReason="Needs the server"
    />
  );
  // Packs and condensed docs both keep their actions behind the swipe, so every document row works the same.
  if (r.type === 'pack')
    return (
      <SwipeRow
        name={r.title}
        actions={[
          {
            icon: 'file-download',
            label: `Download ${r.title}`,
            onPress: onDownload,
            disabled: !online,
          },
          {
            icon: 'autorenew',
            label: 'Recondense the pack',
            onPress: onRecondense,
            disabled: !online || busyTopic,
          },
        ]}
      >
        {row}
      </SwipeRow>
    );
  if (r.type !== 'condensed') return row;
  return (
    <SwipeRow
      name={r.title}
      actions={[
        {
          icon: 'file-download',
          label: `Download ${r.title}`,
          onPress: onDownload,
          disabled: !online,
        },
        {
          icon: 'autorenew',
          label: `Regenerate ${r.title}`,
          onPress: onRegenerate,
          disabled: !online,
        },
        {
          icon: 'delete-outline',
          label: `Delete ${r.title}`,
          onPress: onDelete,
          tone: 'danger',
          disabled: !online,
        },
      ]}
    >
      {row}
    </SwipeRow>
  );
}

function MediaCard({
  r,
  progress,
  onPlay,
  online,
  source,
  onMenu,
}: {
  r: Resource;
  progress: Progress;
  onPlay: () => void;
  online: boolean;
  /** For audio made from a doc: that doc, or null when it was replaced or deleted. Undefined for uploads. */
  source?: Resource | null;
  onMenu?: () => void;
}) {
  const { c } = useTheme();
  const current = usePlayer((s) => s.track?.resource.id === r.id);
  const playing = usePlayer((s) => s.playing && s.track?.resource.id === r.id);
  const item = progress.items[r.id];
  const duration = item?.duration ?? r.duration ?? 0;
  const fraction = item?.done ? 1 : duration ? (item?.position ?? 0) / duration : 0;
  const marks = progress.bookmarks.filter((b) => b.resource_id === r.id).length;
  const generated = !!r.source_id;
  const bits = [
    duration ? formatTime(duration) : r.type === 'video' ? 'Video' : 'Audio',
    generated ? voicesLabel(r.voices) : r.made_with,
    item && !item.done && duration ? `${formatTime(duration - item.position)} left` : null,
    marks ? `${marks} bookmark${marks > 1 ? 's' : ''}` : null,
  ].filter(Boolean);
  // A button cannot sit inside a button on the web, so the card is a frame with the tappable parts side by side.
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        padding: space.sm + 4,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: current ? c.primary : c.rule,
        backgroundColor: current ? c.tint : c.surfaceRaised,
        opacity: online ? 1 : 0.5,
      }}
    >
      <Pressable
        onPress={onPlay}
        disabled={!online}
        accessibilityRole="button"
        accessibilityLabel={`${playing ? 'Pause' : 'Play'} ${r.title}`}
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          borderRadius: radius.base,
          backgroundColor: pressed ? c.surface : 'transparent',
        })}
      >
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: radius.lg,
            backgroundColor: c.primarySoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={r.type === 'video' ? 'movie' : 'graphic-eq'} size={22} tone="primary" />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <T variant="rowTitle" numberOfLines={2}>
            {r.title}
          </T>
          <View
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}
          >
            <T variant="meta" tone="lead">
              {bits.join(' · ')}
            </T>
            {item?.done ? <Badge kind="ready" label="Done" /> : null}
          </View>
          {generated && source === null ? (
            <T variant="meta" tone="faint">
              Made from an earlier version of the doc
            </T>
          ) : null}
          {item && !item.done ? <ProgressBar value={fraction} /> : null}
          {!online ? (
            <T variant="meta" tone="faint">
              Needs the server
            </T>
          ) : null}
        </View>
      </Pressable>
      {onMenu ? (
        <IconButton
          name="more-vert"
          label={`More for ${r.title}`}
          onPress={onMenu}
          disabled={!online}
        />
      ) : null}
      <Pressable
        onPress={onPlay}
        disabled={!online}
        accessible={false}
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: current ? c.primary : c.surface,
        }}
      >
        <Icon
          name={playing ? 'pause' : 'play-arrow'}
          size={26}
          tone={current ? 'onPrimary' : 'ink'}
        />
      </Pressable>
    </View>
  );
}

/** What can be done with audio the app made. */
function AudioMenu({
  audio,
  online,
  busyTopic,
  sourceGone,
  onClose,
  onRegenerate,
  onDelete,
}: {
  audio: Resource | null;
  online: boolean;
  busyTopic: boolean;
  sourceGone: boolean;
  onClose: () => void;
  onRegenerate: (a: Resource) => void;
  onDelete: (a: Resource) => void;
}) {
  const why = !online ? 'Needs the server' : busyTopic ? 'Wait for the current job' : null;
  return (
    <Sheet open={!!audio} onClose={onClose} title={audio?.title ?? 'Audio'}>
      <Row
        title="Regenerate audio"
        subtitle={
          sourceGone
            ? 'The doc this was made from is gone. Open another doc and tap Listen instead.'
            : 'Record it again from the same doc. The current audio stays until the new one is ready.'
        }
        leading={<Icon name="autorenew" size={20} />}
        onPress={() => audio && onRegenerate(audio)}
        disabled={!!why || sourceGone}
        disabledReason={why ?? undefined}
      />
      <Row
        title="Delete audio"
        subtitle="The doc stays; you can make the audio again."
        leading={<Icon name="delete-outline" size={20} tone="danger" />}
        onPress={() => audio && onDelete(audio)}
        disabled={!online}
        disabledReason="Needs the server"
      />
    </Sheet>
  );
}

function ReenrichSheet({
  open,
  onClose,
  onRebuild,
  onDeeper,
}: {
  open: boolean;
  onClose: () => void;
  onRebuild: () => void;
  onDeeper: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Recondense">
      <Row
        title="Go deeper"
        subtitle="Add more sources on one part, with checks against them. Keeps the current pack and builds on it."
        leading={<Icon name="travel-explore" size={22} tone="primary" />}
        onPress={onDeeper}
      />
      <Row
        title="Rebuild the pack"
        subtitle="Start again from the original. Replaces the current pack; condensed docs and media stay."
        leading={<Icon name="autorenew" size={22} tone="lead" />}
        onPress={onRebuild}
      />
    </Sheet>
  );
}

function TopicMenu(props: {
  open: boolean;
  onClose: () => void;
  topic: Topic;
  online: boolean;
  busyTopic: boolean;
  hasPack: boolean;
  onRename: () => void;
  onDeeper: () => void;
  onEnrich: () => void;
  onArchive: () => void;
  onMarkRead: () => void;
}) {
  const { topic, online, busyTopic, hasPack } = props;
  const why = !online ? 'Needs the server' : busyTopic ? 'Wait for the current job' : null;
  return (
    <Sheet open={props.open} onClose={props.onClose} title="Topic">
      <Row
        title="Rename"
        leading={<Icon name="edit" size={20} />}
        onPress={props.onRename}
        disabled={!!why}
        disabledReason={why}
      />
      {hasPack ? (
        <Row
          title="Go deeper"
          subtitle="Deep research on one part, with more sources. Takes longer."
          leading={<Icon name="travel-explore" size={20} />}
          onPress={props.onDeeper}
          disabled={!!why}
          disabledReason={why}
        />
      ) : (
        <Row
          title="Build the study pack"
          leading={<Icon name="auto-awesome" size={20} />}
          onPress={() => {
            props.onClose();
            props.onEnrich();
          }}
          disabled={!!why}
          disabledReason={why}
        />
      )}
      {topic.learning?.gaps?.length ? (
        <Row
          title="Mark topic as read"
          subtitle="Adds its concepts to your profile, so future packs skip them."
          leading={<Icon name="task-alt" size={20} />}
          onPress={props.onMarkRead}
          disabled={!online}
          disabledReason="Needs the server"
        />
      ) : null}
      <Row
        title={topic.status === 'archived' ? 'Unarchive' : 'Archive'}
        leading={<Icon name="inventory-2" size={20} />}
        onPress={props.onArchive}
        disabled={!online}
        disabledReason="Needs the server"
      />
    </Sheet>
  );
}

function RenameSheet({
  open,
  onClose,
  topic,
}: {
  open: boolean;
  onClose: () => void;
  topic: Topic;
}) {
  const [title, setTitle] = useState(topic.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Rename topic"
      footer={
        <Button
          label="Save"
          busy={busy}
          disabled={!title.trim()}
          onPress={async () => {
            setBusy(true);
            setError(null);
            try {
              await api.updateTopic(topic.id, { title: title.trim() });
              await queryClient.invalidateQueries({ queryKey: keys.topic(topic.id) });
              await queryClient.invalidateQueries({ queryKey: keys.topics });
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
      <Input value={title} onChangeText={setTitle} autoFocus accessibilityLabel="Title" />
      {error ? <Notice tone="danger" title={error} /> : null}
    </Sheet>
  );
}

function DeeperSheet({
  open,
  onClose,
  topicId,
}: {
  open: boolean;
  onClose: () => void;
  topicId: string;
}) {
  const [focus, setFocus] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Go deeper"
      footer={
        <Button
          label="Start deep research"
          icon="travel-explore"
          busy={busy}
          onPress={async () => {
            setBusy(true);
            setError(null);
            try {
              await api.startJob(topicId, {
                kind: 'enrich-deep',
                focus: focus.trim() || undefined,
              });
              await queryClient.invalidateQueries({ queryKey: keys.activeJobs });
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
      <T variant="bodySmall" tone="lead" style={{ marginBottom: space.md }}>
        Finds more primary sources and checks claims against them. It uses a larger budget and takes
        longer than the first build.
      </T>
      <Input
        value={focus}
        onChangeText={setFocus}
        placeholder="What should it go deeper on? (optional)"
        multiline
        area
        accessibilityLabel="Focus"
      />
      {error ? <Notice tone="danger" title={error} /> : null}
    </Sheet>
  );
}

/** An upload in flight: how much has been sent and how fast, so a slow connection is visible. */
