import type { Progress, Rendered, Resource, Topic } from '@studyo/api';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, View } from 'react-native';
import { DownloadSheet } from '@/components/DownloadSheet';
import { Check, Input, Segmented } from '@/components/inputs';
import { JobPanel } from '@/components/JobPanel';
import { Sheet } from '@/components/Sheet';
import { TopicBadge } from '@/components/status';
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
import { ApiError, api, fileUrl } from '@/lib/api';
import { useActiveJobs, useOnline, useServerInfo, useTopic, useTopicJob } from '@/lib/hooks';
import { play, topicQueue, usePlayer } from '@/lib/player';
import { keys, queryClient } from '@/lib/query';
import { MEDIA_TYPES, pickFile } from '@/lib/upload';
import { space } from '@/theme';

export default function TopicScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useTopic(id);
  const liveJob = useTopicJob(id);
  const activeJobs = useActiveJobs();
  const { online, reason } = useOnline();
  const server = useServerInfo();
  const [sheet, setSheet] = useState<null | 'condense' | 'rename' | 'deeper' | 'more'>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [download, setDownload] = useState<Resource | null>(null);

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
  const addFile = () =>
    run('upload', async () => {
      const picked = await pickFile([...MEDIA_TYPES, 'text/markdown'], {});
      if (!picked) return;
      picked.form.append('made_with', /notebooklm/i.test(picked.name) ? 'NotebookLM' : '');
      await api.upload(id, picked.form);
    });

  const playMedia = async (r: Resource) => {
    if (r.type === 'video') {
      router.push(`/topic/${id}/watch/${r.id}`);
      return;
    }
    const token = server.data?.file_token;
    if (!token) return;
    const queue = topicQueue(id, topic.title, topic.resources, token);
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
              <IconButton
                name="forum"
                label="Ask about this topic"
                onPress={() => router.push(`/topic/${id}/chat`)}
                disabled={!docs.length && !sources.length}
              />
              <IconButton name="more-vert" label="More" onPress={() => setSheet('more')} />
            </>
          }
        />
      }
    >
      <View style={{ paddingTop: space.lg, gap: space.sm }}>
        <TopicBadge status={topic.status} job={activeJob} />
        <T variant="display" accessibilityRole="header">
          {topic.title}
        </T>
        {topic.summary ? (
          <T variant="body" tone="lead">
            {topic.summary}
          </T>
        ) : null}
        <OriginLine topic={topic} />
      </View>

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

      {/* The one primary action, by state. */}
      <View style={{ marginTop: space.lg, gap: space.sm }}>
        {!pack && !busyTopic ? (
          <Button
            label="Build the study pack"
            icon="auto-awesome"
            onPress={enrich}
            busy={busy === 'enrich'}
            disabled={!online}
            hint={offlineReason}
          />
        ) : null}
        {pack ? (
          <Button
            label={
              progress.items[pack.id] && !progress.items[pack.id]?.done
                ? 'Keep reading the pack'
                : 'Read the pack'
            }
            icon="menu-book"
            onPress={() => router.push(`/topic/${id}/read/${pack.id}`)}
            disabled={!online}
          />
        ) : null}
      </View>

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
              onPress={() => setSheet('condense')}
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
          />
        ))
      )}

      <SectionTitle
        right={
          <Button
            kind="ghost"
            label="Add file"
            icon="upload-file"
            onPress={addFile}
            busy={busy === 'upload'}
            disabled={!online}
          />
        }
      >
        Listen and watch
      </SectionTitle>
      {media.length === 0 ? (
        <T variant="bodySmall" tone="lead" style={{ paddingVertical: space.sm }}>
          Make audio or video from the pack in NotebookLM, then add the file here.
        </T>
      ) : (
        media.map((r) => (
          <MediaRow
            key={r.id}
            r={r}
            progress={progress}
            onPlay={() => void playMedia(r)}
            online={online}
          />
        ))
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
}: {
  topicId: string;
  r: Resource;
  progress: Progress;
  online: boolean;
  onDownload: () => void;
}) {
  const item = progress.items[r.id];
  const fraction = item?.done ? 1 : (item?.position ?? 0);
  return (
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
            {r.type === 'pack' ? 'Study pack' : 'Condensed doc'}
            {r.read_minutes ? ` · ${r.read_minutes} min read` : ''}
            {item?.done ? ' · Read' : item ? ` · ${Math.round(fraction * 100)}% read` : ''}
          </T>
          {item && !item.done ? <ProgressBar value={fraction} /> : null}
        </View>
      }
      meta={item?.done ? <Icon name="check-circle" size={18} tone="sage" /> : undefined}
      trailing={
        <IconButton
          name="file-download"
          label={`Download ${r.title}`}
          onPress={onDownload}
          disabled={!online}
        />
      }
      onPress={() => router.push(`/topic/${topicId}/read/${r.id}`)}
      disabled={!online}
      disabledReason="Needs the server"
    />
  );
}

function MediaRow({
  r,
  progress,
  onPlay,
  online,
}: {
  r: Resource;
  progress: Progress;
  onPlay: () => void;
  online: boolean;
}) {
  const current = usePlayer((s) => s.track?.resource.id === r.id);
  const playing = usePlayer((s) => s.playing && s.track?.resource.id === r.id);
  const item = progress.items[r.id];
  const duration = item?.duration ?? r.duration ?? 0;
  const fraction = item?.done ? 1 : duration ? (item?.position ?? 0) / duration : 0;
  return (
    <Row
      title={r.title}
      active={current}
      leading={<Icon name={r.type === 'video' ? 'movie' : 'graphic-eq'} size={20} tone="primary" />}
      subtitle={
        <View style={{ gap: 6 }}>
          <View
            style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center', flexWrap: 'wrap' }}
          >
            <T variant="meta" tone="lead">
              {duration ? formatTime(duration) : r.type === 'video' ? 'Video' : 'Audio'}
              {r.made_with ? ` · ${r.made_with}` : ''}
              {item && !item.done && duration
                ? ` · ${formatTime(duration - item.position)} left`
                : ''}
            </T>
            {item?.done ? <Badge kind="ready" label="Done" /> : null}
          </View>
          {item && !item.done ? <ProgressBar value={fraction} /> : null}
        </View>
      }
      trailing={
        <IconButton
          name={playing ? 'pause' : 'play-arrow'}
          label={playing ? 'Pause' : `Play ${r.title}`}
          onPress={onPlay}
          disabled={!online}
        />
      }
      onPress={onPlay}
      disabled={!online}
      disabledReason="Needs the server"
    />
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

/** Choose what the condensed doc covers. The level questions come next, from the job. */
function CondenseSheet({
  open,
  onClose,
  topicId,
  packId,
}: {
  open: boolean;
  onClose: () => void;
  topicId: string;
  packId: string | null;
}) {
  const [scope, setScope] = useState<'all' | 'parts'>('all');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const outline = useQuery<Rendered>({
    queryKey: keys.rendered(topicId, packId ?? ''),
    queryFn: () => api.rendered(topicId, packId as string),
    enabled: open && !!packId && scope === 'parts',
  });
  const sections = (outline.data?.headings ?? []).filter((h) => h.depth === 2 || h.depth === 3);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Create a condensed doc"
      footer={
        <Button
          label="Start"
          icon="auto-awesome"
          busy={busy}
          disabled={scope === 'parts' && picked.length === 0}
          onPress={async () => {
            setBusy(true);
            setError(null);
            try {
              const job = await api.startJob(topicId, {
                kind: 'condense',
                scope: scope === 'all' ? 'all' : picked,
              });
              await queryClient.invalidateQueries({ queryKey: keys.activeJobs });
              await queryClient.invalidateQueries({ queryKey: keys.topic(topicId) });
              onClose();
              void job;
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
        An easy-to-follow version of the pack, written at your level. It may ask a quick question
        about what you already know first.
      </T>
      <Segmented
        value={scope}
        onChange={setScope}
        options={[
          { value: 'all', label: 'Whole pack' },
          { value: 'parts', label: 'Selected parts' },
        ]}
      />
      {scope === 'parts' ? (
        <View style={{ marginTop: space.md }}>
          {outline.isLoading ? <Loading label="Reading the outline" /> : null}
          {sections.map((h) => (
            <View key={h.id} style={{ paddingLeft: h.depth === 3 ? space.lg : 0 }}>
              <Check
                checked={picked.includes(h.id)}
                label={h.text}
                onToggle={() =>
                  setPicked((p) => (p.includes(h.id) ? p.filter((x) => x !== h.id) : [...p, h.id]))
                }
              />
            </View>
          ))}
        </View>
      ) : null}
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
