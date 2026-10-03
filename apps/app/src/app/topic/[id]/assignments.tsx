import type { Assignment } from '@studyo/api';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Input } from '@/components/inputs';
import { Sheet } from '@/components/Sheet';
import {
  Badge,
  Button,
  Empty,
  Field,
  Header,
  Icon,
  Loading,
  Notice,
  Row,
  Screen,
  SectionTitle,
  T,
  timeAgo,
} from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useAssignments, useOnline, useTopic } from '@/lib/hooks';
import { keys, queryClient } from '@/lib/query';
import { type Picked, pickFile } from '@/lib/upload';
import { space } from '@/theme';

/** Take-home work for a topic or chapter: apply the ideas to something real. Only when you ask. */
export default function Assignments() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useAssignments(id);
  const topic = useTopic(id);
  const { online, reason } = useOnline();
  const [open, setOpen] = useState(false);
  const hasPack =
    topic.data?.topic.resources.some((r) => r.type === 'pack' || r.type === 'condensed') ?? false;

  return (
    <Screen header={<Header title="Take-home" subtitle={topic.data?.topic.title} />}>
      <View style={{ paddingTop: space.lg, gap: space.sm }}>
        <T variant="display">Go use it</T>
        <T variant="body" tone="lead">
          A small task that puts the ideas to work. Tell it about a project or a situation of yours
          and it frames the task around that, or leave it empty for a generic one.
        </T>
        <Button
          label="New take-home"
          icon="assignment"
          onPress={() => setOpen(true)}
          disabled={!online || !hasPack}
          hint={!online ? reason : !hasPack ? 'Build a pack first.' : null}
          style={{ marginTop: space.sm }}
        />
      </View>
      {q.error ? (
        <Notice tone="danger" title="Couldn't load take-homes" body={(q.error as Error).message} />
      ) : null}
      <SectionTitle>Yours</SectionTitle>
      {q.isLoading ? <Loading /> : null}
      {q.data && q.data.assignments.length === 0 ? (
        <Empty
          icon="assignment"
          title="Nothing yet"
          body="You can submit a repository link, a file, or just say what you built."
        />
      ) : null}
      {q.data?.assignments.map((a) => (
        <AssignmentRow key={a.id} a={a} topicId={id} />
      ))}
      <Sheet open={open} onClose={() => setOpen(false)} title="New take-home">
        <NewAssignment topicId={id} onDone={() => setOpen(false)} />
      </Sheet>
    </Screen>
  );
}

function AssignmentRow({ a, topicId }: { a: Assignment; topicId: string }) {
  const reviewed = a.submissions.filter((s) => s.status === 'reviewed').length;
  const badge =
    a.status === 'briefing'
      ? ({ kind: 'enriching', label: 'Writing' } as const)
      : a.status === 'failed'
        ? ({ kind: 'failed', label: 'Failed' } as const)
        : a.submissions.some((s) => s.status === 'reviewing')
          ? ({ kind: 'enriching', label: 'Reviewing' } as const)
          : reviewed
            ? ({ kind: 'ready', label: 'Reviewed' } as const)
            : ({ kind: 'waiting', label: 'Open' } as const);
  return (
    <Row
      title={a.brief?.title ?? a.title}
      subtitle={
        a.status === 'failed'
          ? (a.failure_reason ?? 'The brief could not be written.')
          : `${a.brief?.estimate ? `${a.brief.estimate} · ` : ''}${a.context ? 'About your situation · ' : 'Generic task · '}${timeAgo(a.created)}`
      }
      meta={<Badge kind={badge.kind} label={badge.label} />}
      onPress={
        a.status === 'open'
          ? () => router.push(`/assignment/${a.id}?topic=${encodeURIComponent(topicId)}`)
          : undefined
      }
    />
  );
}

function NewAssignment({ topicId, onDone }: { topicId: string; onDone: () => void }) {
  const [text, setText] = useState('');
  const [link, setLink] = useState('');
  const [file, setFile] = useState<Picked | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      if (file) {
        if (text.trim()) file.form.set('context_text', text.trim());
        if (link.trim()) file.form.set('context_link', link.trim());
        // The picker names the field `file`; the server wants `context_file`.
        const f = file.form.get('file');
        if (f) {
          file.form.delete('file');
          file.form.append('context_file', f as Blob);
        }
        await api.createAssignment(topicId, file.form);
      } else {
        await api.createAssignment(topicId, {
          context_text: text.trim() || undefined,
          context_link: link.trim() || undefined,
        });
      }
      await queryClient.invalidateQueries({ queryKey: keys.assignments(topicId) });
      await queryClient.invalidateQueries({ queryKey: keys.activeJobs });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: space.md }}>
      <Field
        label="Your situation (optional)"
        hint="A project you are building, something at work, a problem you have. Leave empty for a generic task."
      >
        <Input
          value={text}
          onChangeText={setText}
          multiline
          area
          placeholder="For example: I'm building a notes app and syncing between devices is flaky"
          accessibilityLabel="Your situation"
        />
      </Field>
      <Field
        label="A link (optional)"
        hint="A public repository or page. Private ones can't be read."
      >
        <Input
          value={link}
          onChangeText={setLink}
          placeholder="https://"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          accessibilityLabel="Link"
        />
      </Field>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Button
          kind="secondary"
          icon="attach-file"
          label={file ? 'Change file' : 'Attach a file'}
          onPress={async () => setFile(await pickFile(['*/*']))}
        />
        {file ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 }}>
            <Icon name="description" size={16} tone="lead" />
            <T variant="meta" tone="lead" numberOfLines={1} style={{ flex: 1 }}>
              {file.name}
            </T>
          </View>
        ) : null}
      </View>
      {error ? <Notice tone="danger" title={error} /> : null}
      <Button label="Write the take-home" icon="assignment" busy={busy} onPress={() => void go()} />
      <T variant="meta" tone="faint">
        What you share is only used to shape the task. It runs on your server.
      </T>
    </View>
  );
}
