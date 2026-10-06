import type { TopicDetail } from '@studyo/api';
import { View } from 'react-native';
import {
  audioBytes,
  formatBytes,
  offlineSupported,
  removeTopic,
  saveTopic,
  topicSignature,
  useOffline,
} from '@/lib/offline';
import { space } from '@/theme';
import { Button, Icon, ProgressBar, Row, T } from './ui';

/** "Available offline" on a topic (web): save its docs and audio for a flight, see what's saved, update, remove. */
export function OfflineCard({ detail, online }: { detail: TopicDetail; online: boolean }) {
  const id = detail.topic.id;
  const saved = useOffline((s) => s.topics[id]);
  const saving = useOffline((s) => s.saving[id]);
  if (!offlineSupported()) return null;
  const hasDocs = detail.topic.resources.some((r) => r.type === 'pack' || r.type === 'condensed');
  if (!hasDocs && !saved) return null;

  if (saving && !saving.error) {
    return (
      <View style={{ gap: space.xs }}>
        <Row
          title="Saving for offline…"
          subtitle={`${saving.done} of ${saving.total} files. Keep Studyo open.`}
          leading={<Icon name="downloading" size={20} />}
        />
        <ProgressBar value={saving.total ? saving.done / saving.total : 0} height={3} />
      </View>
    );
  }

  if (saved) {
    const stale = online && topicSignature(detail) !== saved.signature;
    const when = new Date(saved.at).toLocaleString(undefined, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
    return (
      <View style={{ gap: space.xs }}>
        <Row
          title="Available offline"
          subtitle={
            stale
              ? 'New or changed docs or audio since it was saved.'
              : `${formatBytes(saved.bytes)}, saved ${when}`
          }
          leading={<Icon name="offline-pin" size={20} tone="primary" />}
          trailing={
            <View style={{ flexDirection: 'row', gap: space.xs }}>
              {stale ? (
                <Button kind="secondary" label="Update" onPress={() => void saveTopic(id)} />
              ) : null}
              <Button kind="ghost" label="Remove" onPress={() => void removeTopic(id)} />
            </View>
          }
        />
        {saving?.error ? <T tone="danger">{saving.error}</T> : null}
      </View>
    );
  }

  const audio = audioBytes(detail);
  return (
    <View style={{ gap: space.xs }}>
      <Row
        title="Make available offline"
        subtitle={`Docs and audio, to read and listen without a connection${audio ? ` (about ${formatBytes(audio)})` : ''}.`}
        leading={<Icon name="download-for-offline" size={20} />}
        onPress={() => void saveTopic(id)}
        disabled={!online}
        disabledReason="Needs the server"
      />
      {saving?.error ? <T tone="danger">{saving.error}</T> : null}
    </View>
  );
}
