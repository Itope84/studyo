import type { Assignment, Submission } from '@studyo/api';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Input, Segmented } from '@/components/inputs';
import { Markdown } from '@/components/Markdown';
import { Pulse } from '@/components/status';
import {
  Badge,
  Button,
  Header,
  Icon,
  Loading,
  Notice,
  Screen,
  SectionTitle,
  T,
  timeAgo,
} from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useAssignment, useOnline } from '@/lib/hooks';
import { keys, queryClient } from '@/lib/query';
import { type Picked, pickFile } from '@/lib/upload';
import { radius, space, useTheme } from '@/theme';

/** The brief, a place to hand in your work, and the review. */
export default function AssignmentScreen() {
  const { aid, topic } = useLocalSearchParams<{ aid: string; topic: string }>();
  const q = useAssignment(topic, aid);

  if (!q.data) {
    return (
      <Screen header={<Header title="Take-home" />}>
        {q.error ? (
          <Notice tone="danger" title="Couldn't open this" body={(q.error as Error).message} />
        ) : (
          <Loading />
        )}
      </Screen>
    );
  }
  const a = q.data;
  const b = a.brief;
  return (
    <Screen header={<Header title="Take-home" subtitle={b?.estimate ?? undefined} />}>
      {!b ? (
        <View
          style={{
            paddingTop: space.lg,
            flexDirection: 'row',
            gap: space.sm,
            alignItems: 'center',
          }}
        >
          <Pulse />
          <T variant="label" tone="amber">
            Writing the brief…
          </T>
        </View>
      ) : (
        <>
          <View style={{ paddingTop: space.lg, gap: space.sm }}>
            <T variant="display" accessibilityRole="header">
              {b.title}
            </T>
            {b.summary ? (
              <T variant="body" tone="lead">
                {b.summary}
              </T>
            ) : null}
            {b.grounded_in ? (
              <T variant="bodySmall" tone="lead">
                {b.grounded_in}
              </T>
            ) : null}
          </View>
          <SectionTitle>The task</SectionTitle>
          <Markdown text={b.task} topicId={topic} />
          {b.constraints?.length ? (
            <>
              <SectionTitle>Constraints</SectionTitle>
              {b.constraints.map((c) => (
                <T key={c} variant="body" style={{ marginBottom: 4 }}>
                  • {c}
                </T>
              ))}
            </>
          ) : null}
          <SectionTitle>You are done when</SectionTitle>
          {b.acceptance?.map((x) => (
            <View key={x.id} style={{ flexDirection: 'row', gap: space.sm, marginBottom: 4 }}>
              <Icon name="check-box-outline-blank" size={20} tone="lead" />
              <T variant="body" style={{ flex: 1 }}>
                {x.text}
              </T>
            </View>
          ))}
          {b.stretch ? (
            <>
              <SectionTitle>Stretch</SectionTitle>
              <T variant="body">{b.stretch}</T>
            </>
          ) : null}
          <SectionTitle>Hand it in</SectionTitle>
          <Submit a={a} topic={topic} />
          {a.submissions.length ? (
            <>
              <SectionTitle>Your submissions</SectionTitle>
              {[...a.submissions].reverse().map((s) => (
                <SubmissionCard key={s.id} s={s} a={a} topic={topic} />
              ))}
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}

type Kind = 'text' | 'link' | 'file';

function Submit({ a, topic }: { a: Assignment; topic: string }) {
  const { online } = useOnline();
  const [kind, setKind] = useState<Kind>('text');
  const [text, setText] = useState('');
  const [link, setLink] = useState('');
  const [file, setFile] = useState<Picked | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reviewing = a.submissions.some((s) => s.status === 'reviewing');
  const ready =
    kind === 'text' ? !!text.trim() : kind === 'link' ? /^https?:\/\//.test(link.trim()) : !!file;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      if (kind === 'file' && file) {
        if (text.trim()) file.form.set('text', text.trim());
        await api.submitAssignment(topic, a.id, file.form);
        setFile(null);
      } else if (kind === 'link') {
        await api.submitAssignment(topic, a.id, {
          link: link.trim(),
          text: text.trim() || undefined,
        });
        setLink('');
      } else {
        await api.submitAssignment(topic, a.id, { text: text.trim() });
      }
      setText('');
      await queryClient.invalidateQueries({ queryKey: keys.assignment(topic, a.id) });
      await queryClient.invalidateQueries({ queryKey: keys.activeJobs });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: space.md }}>
      <T variant="bodySmall" tone="lead">
        Saying "I did it, here is what I built and why" is fine. A link or a file lets the review
        look at the work itself. Submitted code is read, never run.
      </T>
      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { value: 'text', label: 'Describe it' },
          { value: 'link', label: 'Link' },
          { value: 'file', label: 'File' },
        ]}
      />
      {kind === 'link' ? (
        <Input
          value={link}
          onChangeText={setLink}
          placeholder="https://github.com/you/project"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          accessibilityLabel="Link"
        />
      ) : null}
      {kind === 'file' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Button
            kind="secondary"
            icon="attach-file"
            label={file ? 'Change file' : 'Choose a file'}
            onPress={async () => setFile(await pickFile(['*/*']))}
          />
          {file ? (
            <T variant="meta" tone="lead" numberOfLines={1} style={{ flex: 1 }}>
              {file.name}
            </T>
          ) : null}
        </View>
      ) : null}
      <Input
        value={text}
        onChangeText={setText}
        multiline
        area
        placeholder={
          kind === 'text'
            ? 'What you built, how, and what you decided'
            : 'Anything the reviewer should know (optional)'
        }
        accessibilityLabel="Notes"
      />
      {error ? <Notice tone="danger" title={error} /> : null}
      <Button
        label="Submit for review"
        icon="send"
        onPress={() => void send()}
        busy={busy}
        disabled={!online || !ready || reviewing}
        hint={
          reviewing
            ? 'A review is already running.'
            : !online
              ? 'Submitting needs the server.'
              : null
        }
      />
    </View>
  );
}

function SubmissionCard({ s, a, topic }: { s: Submission; a: Assignment; topic: string }) {
  const { c } = useTheme();
  const r = s.review;
  const label =
    s.kind === 'link'
      ? (s.link ?? 'Link')
      : s.kind === 'file'
        ? (s.file?.split('/').pop() ?? 'File')
        : 'Description';
  const criteria = new Map(a.brief?.acceptance?.map((x) => [x.id, x.text]) ?? []);
  const metBadge = {
    yes: { kind: 'ready', label: 'Met' },
    partly: { kind: 'waiting', label: 'Partly' },
    no: { kind: 'failed', label: 'Not yet' },
  } as const;
  const reread = async (section?: string | null) => {
    const d = await api.topic(topic);
    const pack = d.topic.resources.find((x) => x.type === 'pack');
    if (pack) router.push(`/topic/${topic}/read/${pack.id}${section ? `?section=${section}` : ''}`);
  };
  return (
    <View
      style={{
        borderRadius: radius.base,
        borderWidth: 1,
        borderColor: c.rule,
        padding: space.md,
        gap: space.sm,
        marginBottom: space.sm,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
        <T variant="label" numberOfLines={1} style={{ flex: 1 }}>
          {label} · {timeAgo(s.created)}
        </T>
        <Badge
          kind={s.status === 'reviewed' ? 'ready' : s.status === 'failed' ? 'failed' : 'enriching'}
          label={
            s.status === 'reviewed' ? 'Reviewed' : s.status === 'failed' ? 'Failed' : 'Reviewing'
          }
        />
      </View>
      {s.text ? (
        <T variant="bodySmall" tone="lead" numberOfLines={4}>
          {s.text}
        </T>
      ) : null}
      {s.status === 'reviewing' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Pulse />
          <T variant="meta" tone="amber">
            Reading your work…
          </T>
        </View>
      ) : null}
      {s.status === 'failed' ? (
        <Notice
          tone="danger"
          title="The review failed"
          body="Submit again, or check the job log."
        />
      ) : null}
      {r ? (
        <View style={{ gap: space.sm }}>
          <T variant="body">{r.summary}</T>
          {r.criteria.map((cr) => (
            <View key={cr.id} style={{ gap: 2 }}>
              <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
                <Badge {...metBadge[cr.met]} />
                <T variant="label" style={{ flex: 1 }}>
                  {criteria.get(cr.id) ?? cr.id}
                </T>
              </View>
              {cr.feedback ? (
                <T variant="bodySmall" tone="lead">
                  {cr.feedback}
                </T>
              ) : null}
            </View>
          ))}
          {r.next_steps?.length ? (
            <View style={{ gap: 2 }}>
              <T variant="caps" tone="lead">
                Next
              </T>
              {r.next_steps.map((n) => (
                <T key={n} variant="bodySmall">
                  • {n}
                </T>
              ))}
            </View>
          ) : null}
          {r.pointers?.map((p) => (
            <Button
              key={p.label}
              kind="ghost"
              icon="menu-book"
              label={`Reread: ${p.label}`}
              onPress={() => void reread(p.section)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
