import type { Rendered, Resource } from '@studyo/api';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { api } from '@/lib/api';
import { spokenMinutes } from '@/lib/audio';
import { useServerInfo } from '@/lib/hooks';
import { keys, queryClient } from '@/lib/query';
import { space } from '@/theme';
import { Check, Segmented } from './inputs';
import { Sheet } from './Sheet';
import { Button, Loading, Notice, T } from './ui';

/**
 * Make audio from a condensed doc, or from a topic with none yet (a condensed doc is written first, and kept).
 * With `replace` it regenerates an audio: the current one stays until the new one is ready.
 */
export function ListenSheet({
  open,
  onClose,
  topicId,
  docs,
  fixedDoc,
  replace,
  hasPack,
  isCourse,
  onStarted,
}: {
  open: boolean;
  onClose: () => void;
  topicId: string;
  /** The topic's condensed docs, to choose from. */
  docs: Resource[];
  /** From the reader: the doc being read, so there is nothing to choose. */
  fixedDoc?: Resource | null;
  /** Regenerating this audio. Its doc is fixed. */
  replace?: Resource | null;
  hasPack: boolean;
  isCourse: boolean;
  onStarted?: () => void;
}) {
  const server = useServerInfo();
  const audio = server.data?.audio;
  const sourceDoc = replace
    ? (docs.find((d) => d.id === replace.source_id) ?? null)
    : (fixedDoc ?? null);
  const fixed = !!(replace || fixedDoc);
  const canWriteNew = hasPack && !replace && !fixedDoc;

  const [source, setSource] = useState<string>('new');
  const [depth, setDepth] = useState<'default' | 'longer'>('default');
  const [voices, setVoices] = useState<'2' | '1'>('2');
  const [scope, setScope] = useState<'all' | 'parts'>('all');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filledFor, setFilledFor] = useState<string | null>(null);
  const key = open ? `${replace?.id ?? fixedDoc?.id ?? 'topic'}` : null;
  if (key !== filledFor) {
    setFilledFor(key);
    if (key) {
      setSource(
        fixed ? (sourceDoc?.id ?? 'none') : docs.length ? (docs.at(-1)?.id ?? 'new') : 'new',
      );
      setDepth(isCourse ? 'longer' : 'default');
      setVoices(replace?.voices === 1 ? '1' : '2');
      setScope('all');
      setPicked([]);
      setError(null);
    }
  }

  const doc = source === 'new' ? null : (docs.find((d) => d.id === source) ?? sourceDoc);
  const outline = useQuery<Rendered>({
    queryKey: keys.rendered(topicId, doc?.id ?? ''),
    queryFn: () => api.rendered(topicId, doc?.id as string),
    enabled: open && !!doc && scope === 'parts',
  });
  const sections = (outline.data?.headings ?? []).filter((h) => h.depth === 2);

  const gone = !!replace && !sourceDoc; // the doc it was made from was replaced or deleted
  const unavailable = audio && !audio.available ? audio.reason : null;
  const writingNew = source === 'new';
  const estimate = doc?.read_minutes && scope === 'all' ? spokenMinutes(doc.read_minutes) : null;

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const v = voices === '1' ? 1 : 2;
      if (writingNew) {
        await api.startJob(topicId, {
          kind: 'condense',
          depth,
          scope: 'all',
          audio: true,
          voices: v,
        });
      } else {
        await api.startJob(topicId, {
          kind: 'audio',
          source: (doc as Resource).id,
          voices: v,
          scope: scope === 'all' ? 'all' : picked,
          ...(replace ? { replace: replace.id } : {}),
        });
      }
      await queryClient.invalidateQueries({ queryKey: keys.activeJobs });
      await queryClient.invalidateQueries({ queryKey: keys.topic(topicId) });
      onClose();
      onStarted?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={replace ? 'Regenerate audio' : 'Listen'}
      footer={
        <Button
          label={
            replace
              ? 'Regenerate audio'
              : writingNew
                ? 'Write the doc and make audio'
                : 'Make audio'
          }
          icon="headphones"
          busy={busy}
          onPress={start}
          disabled={
            !!unavailable ||
            gone ||
            (!writingNew && !doc) ||
            (scope === 'parts' && picked.length === 0 && !writingNew)
          }
        />
      }
    >
      <T variant="bodySmall" tone="lead" style={{ marginBottom: space.md }}>
        {replace
          ? 'Makes a fresh recording from the same doc. The current audio stays until the new one is ready, then it is replaced.'
          : 'Two hosts talk through the whole doc, so you can listen instead of read. It takes a few minutes to make. The doc itself does not change.'}
      </T>
      {unavailable ? (
        <Notice
          tone="warning"
          icon="info-outline"
          title="Audio isn't set up on the server"
          body={unavailable}
        />
      ) : null}
      {gone ? (
        <Notice
          tone="warning"
          icon="info-outline"
          title="The doc this was made from is gone"
          body="Open another doc and tap Listen to make audio from it."
        />
      ) : null}

      {!fixed && docs.length ? (
        <View style={{ marginBottom: space.md }}>
          <T variant="caps" tone="lead" style={{ marginBottom: space.xs }}>
            From
          </T>
          {docs.map((d) => (
            <Check
              key={d.id}
              radio
              checked={source === d.id}
              onToggle={() => setSource(d.id)}
              label={d.title}
              note={d.read_minutes ? `${d.read_minutes} min read` : undefined}
            />
          ))}
          {canWriteNew ? (
            <Check
              radio
              checked={source === 'new'}
              onToggle={() => setSource('new')}
              label="A new condensed doc"
              note="Written first, then recorded. You keep the doc."
            />
          ) : null}
        </View>
      ) : null}

      {writingNew ? (
        <View style={{ marginBottom: space.md }}>
          <Segmented
            value={depth}
            onChange={setDepth}
            options={[
              { value: 'default', label: 'Default' },
              { value: 'longer', label: 'Deep dive' },
            ]}
          />
          <T variant="meta" tone="lead" style={{ marginTop: space.xs }}>
            {depth === 'longer'
              ? 'A longer, more thorough doc, and so longer audio. This takes the longest.'
              : 'An overview of the main ideas. Shorter to write and to listen to.'}{' '}
            It is added to your docs and may ask a quick question about what you already know.
          </T>
        </View>
      ) : null}

      <T variant="caps" tone="lead" style={{ marginBottom: space.xs }}>
        Voices
      </T>
      <Segmented
        value={voices}
        onChange={setVoices}
        options={[
          { value: '2', label: 'Two hosts' },
          { value: '1', label: 'One narrator' },
        ]}
      />
      <T variant="meta" tone="lead" style={{ marginTop: space.xs, marginBottom: space.md }}>
        {voices === '2'
          ? 'A host explains and a co-host asks the questions you would.'
          : 'One voice explains, asking you the questions as it goes.'}
      </T>

      {!writingNew && doc ? (
        <View style={{ marginBottom: space.md }}>
          <T variant="caps" tone="lead" style={{ marginBottom: space.xs }}>
            Covers
          </T>
          <Segmented
            value={scope}
            onChange={setScope}
            options={[
              { value: 'all', label: 'Whole doc' },
              { value: 'parts', label: 'Selected sections' },
            ]}
          />
          {scope === 'parts' ? (
            <View style={{ marginTop: space.sm }}>
              {outline.isLoading ? <Loading label="Reading the outline" /> : null}
              {sections.map((h) => (
                <Check
                  key={h.id}
                  checked={picked.includes(h.text)}
                  label={h.text}
                  onToggle={() =>
                    setPicked((p) =>
                      p.includes(h.text) ? p.filter((x) => x !== h.text) : [...p, h.text],
                    )
                  }
                />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      <T variant="meta" tone="lead">
        {writingNew
          ? 'The doc is written first, then recorded: expect it to take a while.'
          : estimate
            ? `About ${estimate} minutes of audio.`
            : 'Shorter than the whole doc.'}
      </T>
      {error ? <Notice tone="danger" title={error} /> : null}
    </Sheet>
  );
}

/** Confirm before removing generated audio. The doc it came from stays. */
export function DeleteAudioSheet({
  audio,
  onClose,
  topicId,
}: {
  audio: Resource | null;
  onClose: () => void;
  topicId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet
      open={!!audio}
      onClose={onClose}
      title="Delete this audio?"
      footer={
        <Button
          label="Delete"
          icon="delete-outline"
          busy={busy}
          onPress={async () => {
            if (!audio) return;
            setBusy(true);
            setError(null);
            try {
              await api.deleteResource(topicId, audio.id);
              await queryClient.invalidateQueries({ queryKey: keys.topic(topicId) });
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
      <T variant="bodySmall" tone="lead">
        {audio?.title} and your listening position will be removed. The doc it was made from stays,
        and you can make the audio again.
      </T>
      {error ? <Notice tone="danger" title={error} /> : null}
    </Sheet>
  );
}
