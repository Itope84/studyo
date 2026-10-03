import type { InboxItem } from '@studyo/api';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Input } from '@/components/inputs';
import { Sheet } from '@/components/Sheet';
import {
  Badge,
  Button,
  Empty,
  Field,
  formatBytes,
  Header,
  Icon,
  IconButton,
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
import { fonts, radius, space, useTheme } from '@/theme';

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
  const [menu, setMenu] = useState<InboxItem | null>(null);
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
          <InboxRow
            key={item.path}
            item={item}
            online={online}
            onAssign={() => setPicked(item)}
            onMenu={() => setMenu(item)}
          />
        ))}
      </View>
      {picked ? <AssignSheet item={picked} onClose={() => setPicked(null)} /> : null}
      {menu ? <FileMenu item={menu} onClose={() => setMenu(null)} /> : null}
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

/** One unfiled file: what it is, and the two things to do with it right there. */
function InboxRow({
  item,
  online,
  onAssign,
  onMenu,
}: {
  item: InboxItem;
  online: boolean;
  onAssign: () => void;
  onMenu: () => void;
}) {
  const { c } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startTopic = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.assign({ path: item.path, new_topic: { enrich: true } });
      await queryClient.invalidateQueries({ queryKey: keys.inbox });
      await queryClient.invalidateQueries({ queryKey: keys.topics });
      router.push(`/topic/${res.topic.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View
      style={{
        paddingVertical: space.md,
        borderBottomWidth: 1,
        borderBottomColor: c.rule,
        gap: space.sm,
        opacity: online ? 1 : 0.5,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: radius.lg,
            backgroundColor: c.primarySoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={KIND_ICON[item.kind]} size={20} tone="primary" />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <T variant="label" numberOfLines={2} style={{ fontFamily: fonts.uiSemibold }}>
            {item.name}
          </T>
          <T variant="meta" tone="lead" numberOfLines={1}>
            {KIND_LABEL[item.kind]} · {formatBytes(item.size)} · added {timeAgo(item.added)}
          </T>
        </View>
        <Badge kind="neutral" label="Unassigned" />
        <IconButton
          name="more-horiz"
          label={`More for ${item.name}`}
          tone="lead"
          onPress={onMenu}
          disabled={!online}
        />
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm, paddingLeft: 40 + space.md }}>
        <Button
          kind="secondary"
          label="Assign to topic"
          onPress={onAssign}
          disabled={!online}
          style={{ flexGrow: 1 }}
        />
        {item.kind === 'pdf' ? (
          <Button
            label="Create new topic"
            icon="add-circle-outline"
            onPress={() => void startTopic()}
            busy={busy}
            disabled={!online}
            style={{ flexGrow: 1 }}
          />
        ) : null}
      </View>
      {!online ? (
        <T variant="meta" tone="faint" style={{ paddingLeft: 40 + space.md }}>
          Needs the server
        </T>
      ) : null}
      {error ? <Notice tone="danger" title={error} /> : null}
    </View>
  );
}

const KIND_LABEL: Record<InboxItem['kind'], string> = {
  pdf: 'PDF',
  audio: 'Audio',
  video: 'Video',
  document: 'Document',
  other: 'File',
};

/** Rename or delete an inbox file. */
function FileMenu({ item, onClose }: { item: InboxItem; onClose: () => void }) {
  const ext = item.name.includes('.') ? item.name.slice(item.name.lastIndexOf('.')) : '';
  const [name, setName] = useState(ext ? item.name.slice(0, -ext.length) : item.name);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<'rename' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (kind: 'rename' | 'delete', fn: () => Promise<unknown>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: keys.inbox });
      await queryClient.invalidateQueries({ queryKey: keys.topics });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Sheet open onClose={onClose} title="File">
      <Field label="Name" hint={ext ? `Keeps its ${ext} ending.` : undefined}>
        <Input value={name} onChangeText={setName} accessibilityLabel="File name" />
      </Field>
      <Button
        kind="secondary"
        label="Rename"
        icon="edit"
        busy={busy === 'rename'}
        disabled={!name.trim() || `${name.trim()}${ext}` === item.name}
        onPress={() => void run('rename', () => api.renameInbox(item.name, name.trim()))}
      />
      <View style={{ marginTop: space.lg }}>
        {confirm ? (
          <Notice
            tone="danger"
            icon="delete-outline"
            title="Delete this file from the server?"
            body="It is removed from library/inbox for good."
            action={
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <Button
                  kind="danger"
                  label="Delete"
                  busy={busy === 'delete'}
                  onPress={() => void run('delete', () => api.deleteInbox(item.name))}
                />
                <Button kind="ghost" label="Keep it" onPress={() => setConfirm(false)} />
              </View>
            }
          />
        ) : (
          <Button
            kind="danger"
            label="Delete file"
            icon="delete-outline"
            onPress={() => setConfirm(true)}
          />
        )}
      </View>
      {error ? <Notice tone="danger" title={error} /> : null}
    </Sheet>
  );
}
