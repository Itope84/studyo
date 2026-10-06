import type { Rendered, Resource } from '@studyo/api';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { api } from '@/lib/api';
import { audioFor } from '@/lib/audio';
import { keys, queryClient } from '@/lib/query';
import { space } from '@/theme';
import { Check, Input, Segmented } from './inputs';
import { Sheet } from './Sheet';
import { Button, Loading, Notice, T } from './ui';

/**
 * Choose how deep the doc goes and what it covers. The level questions come next, from the job.
 * A new doc never replaces another; regenerating one does, once the new run succeeds. A doc that has audio
 * offers to regenerate that too; unchecked, the audio is left as it is.
 */
export function CondenseSheet({
  open,
  onClose,
  topicId,
  packId,
  isCourse,
  regenerate,
  audios,
  onStarted,
}: {
  open: boolean;
  onClose: () => void;
  topicId: string;
  packId: string | null;
  isCourse: boolean;
  regenerate: Resource | null;
  /** The topic's resources that are audio, to find the one made from the doc being regenerated. */
  audios: Resource[];
  onStarted?: () => void;
}) {
  const [depth, setDepth] = useState<'default' | 'longer'>('default');
  const [scope, setScope] = useState<'all' | 'parts'>('all');
  const [picked, setPicked] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [alsoAudio, setAlsoAudio] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const oldAudio = regenerate ? audioFor(audios, regenerate.id).at(-1) : undefined;
  // Fill the form each time the sheet opens: from the doc being regenerated, else the course default.
  const [filledFor, setFilledFor] = useState<string | null>(null);
  const key = open ? `${regenerate?.id ?? 'new'}` : null;
  if (key !== filledFor) {
    setFilledFor(key);
    if (key) {
      setDepth(regenerate ? (regenerate.depth ?? 'default') : isCourse ? 'longer' : 'default');
      const parts = Array.isArray(regenerate?.scope) ? regenerate.scope : [];
      setScope(parts.length ? 'parts' : 'all');
      setPicked(parts);
      setNotes(regenerate?.notes ?? '');
      setAlsoAudio(false);
      setError(null);
    }
  }
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
      title={regenerate ? 'Regenerate this doc' : 'Create a condensed doc'}
      footer={
        <Button
          label={regenerate ? 'Regenerate' : 'Start'}
          icon={regenerate ? 'autorenew' : 'auto-awesome'}
          busy={busy}
          disabled={scope === 'parts' && picked.length === 0 && !notes.trim()}
          onPress={async () => {
            setBusy(true);
            setError(null);
            try {
              await api.startJob(topicId, {
                kind: 'condense',
                depth,
                scope: scope === 'all' ? 'all' : picked,
                ...(notes.trim() ? { notes: notes.trim() } : {}),
                ...(regenerate ? { replace: regenerate.id } : {}),
                ...(alsoAudio ? { audio: true, voices: oldAudio?.voices === 1 ? 1 : 2 } : {}),
              });
              await queryClient.invalidateQueries({ queryKey: keys.activeJobs });
              await queryClient.invalidateQueries({ queryKey: keys.topic(topicId) });
              onClose();
              onStarted?.();
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
        {regenerate
          ? 'Writes a fresh version with the settings below. When it finishes it replaces this doc and its reading position.'
          : 'An easy-to-follow version of the pack, written at your level. It is added next to your other docs and never replaces one. It may ask a quick question about what you already know first.'}
      </T>
      <Segmented
        value={depth}
        onChange={setDepth}
        options={[
          { value: 'default', label: 'Default' },
          { value: 'longer', label: 'Deep dive' },
        ]}
      />
      <T variant="meta" tone="lead" style={{ marginTop: space.xs, marginBottom: space.md }}>
        {depth === 'longer'
          ? 'Every idea shown working, with predict-and-reveal checks. Longer to write and to read.'
          : 'An overview of the main ideas.'}
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
          <T variant="meta" tone="lead" style={{ marginTop: space.md, marginBottom: space.xs }}>
            Anything specific you want covered or stressed? Optional. Without ticking parts it
            applies to the whole pack.
          </T>
          <Input
            area
            value={notes}
            onChangeText={setNotes}
            placeholder="For example: focus on the worked examples"
            accessibilityLabel="What to cover or stress"
          />
        </View>
      ) : null}
      {oldAudio ? (
        <View style={{ marginTop: space.md }}>
          <Check
            checked={alsoAudio}
            onToggle={() => setAlsoAudio((v) => !v)}
            label="Also regenerate its audio"
            note={
              alsoAudio
                ? 'The new audio replaces the current one when it is ready.'
                : 'Left unticked, the current audio stays and still plays the old version.'
            }
          />
        </View>
      ) : null}
      {error ? <Notice tone="danger" title={error} /> : null}
    </Sheet>
  );
}

/** Confirm before removing a condensed doc. Its audio stays unless the box is ticked. */
export function DeleteDocSheet({
  doc,
  onClose,
  topicId,
  audios,
  onDeleted,
}: {
  doc: Resource | null;
  onClose: () => void;
  topicId: string;
  audios: Resource[];
  onDeleted?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [alsoAudio, setAlsoAudio] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const made = doc ? audioFor(audios, doc.id) : [];
  const [forDoc, setForDoc] = useState<string | null>(null);
  if ((doc?.id ?? null) !== forDoc) {
    setForDoc(doc?.id ?? null);
    setAlsoAudio(false);
    setError(null);
  }
  return (
    <Sheet
      open={!!doc}
      onClose={onClose}
      title="Delete this doc?"
      footer={
        <Button
          label="Delete"
          icon="delete-outline"
          busy={busy}
          onPress={async () => {
            if (!doc) return;
            setBusy(true);
            setError(null);
            try {
              await api.deleteResource(topicId, doc.id, { audio: alsoAudio });
              await queryClient.invalidateQueries({ queryKey: keys.topic(topicId) });
              onClose();
              onDeleted?.();
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
        {doc?.title} and your reading position in it will be removed. The study pack and your other
        docs stay.
      </T>
      {made.length ? (
        <View style={{ marginTop: space.md }}>
          <Check
            checked={alsoAudio}
            onToggle={() => setAlsoAudio((v) => !v)}
            label="Also delete its audio"
            note={
              alsoAudio
                ? 'The audio made from this doc is removed too.'
                : 'Left unticked, the audio stays in Listen and watch.'
            }
          />
        </View>
      ) : null}
      {error ? <Notice tone="danger" title={error} /> : null}
    </Sheet>
  );
}
