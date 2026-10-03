import type { InboxItem } from '@studyo/api';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Sheet } from '@/components/Sheet';
import {
  Button,
  Empty,
  formatBytes,
  Header,
  Icon,
  type IconName,
  Loading,
  Notice,
  Row,
  Screen,
  T,
  timeAgo,
} from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useInbox, useOnline, useTopics } from '@/lib/hooks';
import { keys, queryClient } from '@/lib/query';
import { pickFile } from '@/lib/upload';
import { space } from '@/theme';

const KIND_ICON: Record<InboxItem['kind'], IconName> = {
  pdf: 'picture-as-pdf',
  audio: 'graphic-eq',
  video: 'movie',
  document: 'description',
  other: 'insert-drive-file',
};

/** Files on the server that belong to no topic yet. */
export default function Inbox() {
  const inbox = useInbox();
  const { online, reason } = useOnline();
  const [picked, setPicked] = useState<InboxItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async () => {
    setError(null);
    const file = await pickFile(['*/*']);
    if (!file) return;
    setBusy(true);
    try {
      await api.uploadInbox(file.form);
      await queryClient.invalidateQueries({ queryKey: keys.inbox });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen header={<Header title="Inbox" back={false} />}>
      <T variant="bodySmall" tone="lead" style={{ paddingTop: space.md }}>
        Files dropped into <T variant="mono">library/inbox/</T> on the server, or uploaded here,
        wait until you file them.
      </T>
      {error ? <Notice tone="danger" title={error} /> : null}
      <Button
        kind="secondary"
        icon="upload-file"
        label="Upload a file"
        onPress={upload}
        busy={busy}
        disabled={!online}
        hint={online ? null : reason}
        style={{ marginTop: space.md }}
      />
      <View style={{ marginTop: space.md }}>
        {inbox.isLoading ? <Loading /> : null}
        {inbox.data && inbox.data.items.length === 0 ? (
          <Empty icon="inbox" title="Inbox is empty" body="Nothing waiting to be filed." />
        ) : null}
        {inbox.data?.items.map((item) => (
          <Row
            key={item.path}
            title={item.name}
            leading={<Icon name={KIND_ICON[item.kind]} size={20} tone="primary" />}
            subtitle={`${item.kind.toUpperCase()} · ${formatBytes(item.size)} · added ${timeAgo(item.added)}`}
            trailing={<Icon name="chevron-right" size={20} tone="faint" />}
            onPress={() => setPicked(item)}
            disabled={!online}
            disabledReason="Needs the server"
          />
        ))}
      </View>
      {picked ? <AssignSheet item={picked} onClose={() => setPicked(null)} /> : null}
    </Screen>
  );
}

function AssignSheet({ item, onClose }: { item: InboxItem; onClose: () => void }) {
  const topics = useTopics();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const assign = async (key: string, body: Parameters<typeof api.assign>[0]) => {
    setBusy(key);
    setError(null);
    try {
      const res = await api.assign(body);
      await queryClient.invalidateQueries({ queryKey: keys.inbox });
      await queryClient.invalidateQueries({ queryKey: keys.topics });
      onClose();
      router.push(`/topic/${res.topic.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet open onClose={onClose} title={item.name}>
      {error ? <Notice tone="danger" title={error} /> : null}
      {item.kind === 'pdf' ? (
        <Button
          label="Start a new topic from it"
          icon="auto-awesome"
          busy={busy === 'new'}
          onPress={() => assign('new', { path: item.path, new_topic: { enrich: true } })}
          style={{ marginBottom: space.md }}
        />
      ) : null}
      <T variant="caps" tone="lead" style={{ marginBottom: space.xs }}>
        Add to a topic
      </T>
      {topics.data?.topics.map((t) => (
        <Row
          key={t.id}
          title={t.title}
          subtitle={
            item.kind === 'audio' || item.kind === 'video'
              ? 'Goes into its media'
              : 'Goes into its sources'
          }
          onPress={() => assign(t.id, { path: item.path, topic_id: t.id })}
          trailing={busy === t.id ? <Loading label="" /> : undefined}
        />
      ))}
    </Sheet>
  );
}
