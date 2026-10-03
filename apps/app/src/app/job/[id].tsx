import type { AnswerSet, LogLine, Question, QuestionSet } from '@studyo/api';
import { courseIdOf, isCourseScope } from '@studyo/api';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Check, Input } from '@/components/inputs';
import { jobLabel } from '@/components/JobPanel';
import { Markdown } from '@/components/Markdown';
import { Pulse } from '@/components/status';
import {
  Badge,
  Button,
  Divider,
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
import { useCourse, useJob, useOnline, useTopic } from '@/lib/hooks';
import { keys, queryClient } from '@/lib/query';
import { scopeHref } from '@/lib/scope';
import { fonts, radius, space, useTheme } from '@/theme';

/** One job: its questions when it is waiting, and its live log. */
export default function JobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const job = useJob(id);
  const scope = job.data?.topic_id ?? '';
  const topic = useTopic(isCourseScope(scope) ? '' : scope);
  const course = useCourse(isCourseScope(scope) ? courseIdOf(scope) : '');
  const subtitle = isCourseScope(scope) ? course.data?.course.title : topic.data?.topic.title;
  const { online } = useOnline();
  const [showAll, setShowAll] = useState(false);

  if (!job.data) {
    return (
      <Screen header={<Header title="Job" />}>
        {job.error ? (
          <Notice
            tone="danger"
            title="Couldn't load this job"
            body={(job.error as Error).message}
          />
        ) : (
          <Loading />
        )}
      </Screen>
    );
  }
  const j = job.data;
  const status = {
    queued: { kind: 'enriching', label: 'Queued' },
    running: { kind: 'enriching', label: 'Running' },
    needs_input: { kind: 'waiting', label: 'Waiting for you' },
    succeeded: { kind: 'ready', label: 'Done' },
    failed: { kind: 'failed', label: 'Failed' },
    cancelled: { kind: 'neutral', label: 'Cancelled' },
  }[j.status] as { kind: 'enriching' | 'waiting' | 'ready' | 'failed' | 'neutral'; label: string };

  const log = showAll
    ? j.log
    : j.log.filter((l) => l.kind === 'progress' || l.kind === 'tool' || l.kind === 'system');

  return (
    <Screen header={<Header title={jobLabel(j)} subtitle={subtitle} />}>
      <View style={{ paddingTop: space.lg, gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Badge kind={status.kind} label={status.label} />
          <T variant="meta" tone="lead">
            {j.cli === 'claude' ? 'Claude Code' : 'OpenCode'} · started{' '}
            {timeAgo(j.started ?? j.created)}
          </T>
        </View>
        {j.status === 'running' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Pulse />
            <T variant="body">{j.activity ?? 'Working…'}</T>
          </View>
        ) : null}
        {j.status === 'failed' ? (
          <Notice tone="danger" icon="error-outline" title="What went wrong" body={j.error} />
        ) : null}
        {j.status === 'succeeded' ? (
          <Button
            label={isCourseScope(j.topic_id) ? 'Open the course' : 'Open the topic'}
            icon="arrow-forward"
            onPress={() => router.replace(scopeHref(j.topic_id))}
            style={{ marginTop: space.sm }}
          />
        ) : null}
      </View>

      {j.status === 'needs_input' && j.questions ? (
        <QuestionForm jobId={j.id} topicId={j.topic_id} set={j.questions} online={online} />
      ) : null}

      <SectionTitle
        right={
          <Button
            kind="ghost"
            label={showAll ? 'Steps only' : 'Everything'}
            onPress={() => setShowAll((v) => !v)}
          />
        }
      >
        Log
      </SectionTitle>
      {log.length === 0 ? (
        <T variant="meta" tone="lead">
          Nothing yet.
        </T>
      ) : (
        log.map((l) => <LogRow key={l.seq} line={l} />)
      )}
      {j.status === 'queued' || j.status === 'running' || j.status === 'needs_input' ? (
        <Button
          kind="danger"
          label="Cancel this job"
          onPress={async () => {
            await api.cancel(j.id);
            await queryClient.invalidateQueries({ queryKey: keys.job(j.id) });
          }}
          disabled={!online}
          style={{ marginTop: space.lg }}
        />
      ) : null}
    </Screen>
  );
}

function LogRow({ line }: { line: LogLine }) {
  const icon = {
    progress: 'chevron-right',
    tool: 'build',
    text: 'notes',
    stderr: 'warning-amber',
    system: 'info-outline',
  }[line.kind] as 'chevron-right' | 'build' | 'notes' | 'warning-amber' | 'info-outline';
  return (
    <View
      style={{ flexDirection: 'row', gap: space.sm, paddingVertical: 6, alignItems: 'flex-start' }}
    >
      <View style={{ paddingTop: 2 }}>
        <Icon
          name={icon}
          size={14}
          tone={line.kind === 'stderr' ? 'amber' : line.kind === 'progress' ? 'primary' : 'faint'}
        />
      </View>
      <T
        variant={line.kind === 'progress' ? 'label' : 'meta'}
        tone={line.kind === 'progress' ? 'ink' : 'lead'}
        style={{ flex: 1, fontFamily: line.kind === 'text' ? fonts.content : undefined }}
        numberOfLines={line.kind === 'text' ? 6 : undefined}
      >
        {line.text}
      </T>
      <T variant="meta" tone="faint">
        {new Date(line.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </T>
    </View>
  );
}

type Answers = AnswerSet['answers'];

/** The skill's questions as a form: ticks, a single choice or a line of text. */
function QuestionForm({
  jobId,
  topicId,
  set,
  online,
}: {
  jobId: string;
  topicId: string;
  set: QuestionSet;
  online: boolean;
}) {
  const { c } = useTheme();
  const initial = useMemo<Answers>(() => {
    const a: Answers = {};
    for (const q of set.questions) {
      if (q.kind === 'text') a[q.id] = { text: '' };
      else a[q.id] = { selected: (q.options ?? []).filter((o) => o.checked).map((o) => o.id) };
    }
    return a;
  }, [set]);
  const [answers, setAnswers] = useState<Answers>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missing = set.questions.filter((q) => {
    if (!q.required) return false;
    const a = answers[q.id];
    return q.kind === 'text' ? !a?.text?.trim() : !a?.selected?.length;
  });

  const submit = async (skip = false) => {
    setBusy(true);
    setError(null);
    try {
      await api.answer(jobId, { question_set_id: set.id, answers: skip ? {} : answers });
      await queryClient.invalidateQueries({ queryKey: keys.activeJobs });
      await queryClient.invalidateQueries({ queryKey: keys.job(jobId) });
      router.replace(scopeHref(topicId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View
      style={{
        marginTop: space.lg,
        borderRadius: radius.base,
        borderWidth: 1,
        borderColor: c.primary,
        backgroundColor: c.tint,
        padding: space.md,
        gap: space.md,
      }}
    >
      <View style={{ gap: 4 }}>
        <T variant="caps" tone="primary">
          Studyo has a question
        </T>
        <T variant="title">{set.title ?? 'Before it continues'}</T>
        {set.intro ? <Markdown text={set.intro} topicId={topicId} /> : null}
      </View>
      {set.questions.map((q) => (
        <QuestionField
          key={q.id}
          q={q}
          value={answers[q.id] ?? {}}
          onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
        />
      ))}
      {error ? <Notice tone="danger" title={error} /> : null}
      <Divider />
      <Button
        label="Send answers"
        icon="send"
        onPress={() => void submit()}
        busy={busy}
        disabled={!online || missing.length > 0}
        hint={
          !online
            ? 'Answering needs the server.'
            : missing.length
              ? 'Answer the required questions first.'
              : null
        }
      />
      <Button
        kind="ghost"
        label={
          set.questions.some((q) => q.id === 'decision')
            ? 'Skip, use it as it is'
            : "Skip, assume I'm new to all of it"
        }
        onPress={() => void submit(true)}
        disabled={!online || busy}
      />
    </View>
  );
}

function QuestionField({
  q,
  value,
  onChange,
}: {
  q: Question;
  value: { selected?: string[]; text?: string };
  onChange: (v: { selected?: string[]; text?: string }) => void;
}) {
  const groups = new Map<string, NonNullable<Question['options']>>();
  for (const o of q.options ?? []) {
    const g = o.group ?? '';
    groups.set(g, [...(groups.get(g) ?? []), o]);
  }
  const selected = value.selected ?? [];
  return (
    <View style={{ gap: space.xs }}>
      <T variant="rowTitle">
        {q.label}
        {q.required ? ' *' : ''}
      </T>
      {q.help ? (
        <T variant="meta" tone="lead">
          {q.help}
        </T>
      ) : null}
      {q.kind === 'text' ? (
        <Input
          value={value.text ?? ''}
          onChangeText={(text) => onChange({ text })}
          placeholder={q.placeholder}
          multiline
          area
          accessibilityLabel={q.label}
        />
      ) : (
        [...groups.entries()].map(([group, options]) => (
          <View key={group} style={{ marginTop: group ? space.sm : 0 }}>
            {group ? (
              <T variant="caps" tone="lead" style={{ marginBottom: 2 }}>
                {group}
              </T>
            ) : null}
            {options.map((o) => (
              <Check
                key={o.id}
                radio={q.kind === 'single'}
                checked={selected.includes(o.id)}
                label={o.label}
                note={o.note}
                onToggle={() =>
                  onChange({
                    selected:
                      q.kind === 'single'
                        ? [o.id]
                        : selected.includes(o.id)
                          ? selected.filter((x) => x !== o.id)
                          : [...selected, o.id],
                  })
                }
              />
            ))}
          </View>
        ))
      )}
    </View>
  );
}
