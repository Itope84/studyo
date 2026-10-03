import type { Quiz, QuizAttempt, QuizQuestion } from '@studyo/api';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Check, Input } from '@/components/inputs';
import { Markdown } from '@/components/Markdown';
import { Pulse } from '@/components/status';
import {
  Badge,
  Button,
  Divider,
  Header,
  Loading,
  Notice,
  Screen,
  SectionTitle,
  T,
} from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useOnline, useQuiz } from '@/lib/hooks';
import { keys, queryClient } from '@/lib/query';
import { radius, space, useTheme } from '@/theme';

type Answers = Record<string, { selected?: string | null; text?: string | null }>;

/** Take a quiz, then see what you got and where to reread. */
export default function QuizScreen() {
  const { qid, scope } = useLocalSearchParams<{ qid: string; scope: string }>();
  const q = useQuiz(scope, qid);
  const { online } = useOnline();
  const [retake, setRetake] = useState(false);
  const [answers, setAnswers] = useState<Answers>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!q.data) {
    return (
      <Screen header={<Header title="Quiz" />}>
        {q.error ? (
          <Notice tone="danger" title="Couldn't open this quiz" body={(q.error as Error).message} />
        ) : (
          <Loading />
        )}
      </Screen>
    );
  }
  const quiz = q.data;
  const last = quiz.attempts.at(-1);
  const taking = retake || !last;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.submitAttempt(scope, qid, { answers });
      await queryClient.invalidateQueries({ queryKey: keys.quiz(scope, qid) });
      await queryClient.invalidateQueries({ queryKey: keys.quizzes(scope) });
      await queryClient.invalidateQueries({ queryKey: keys.activeJobs });
      setRetake(false);
      setAnswers({});
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const answered = quiz.questions.filter((x) => {
    const a = answers[x.id];
    return x.type === 'choice' ? !!a?.selected : !!a?.text?.trim();
  }).length;

  return (
    <Screen header={<Header title={quiz.title} subtitle={`${quiz.questions.length} questions`} />}>
      {taking ? (
        <>
          <View style={{ paddingTop: space.lg, gap: space.sm }}>
            <T variant="body" tone="lead">
              Answer what you can. Blank answers count as not yet. Written answers are graded
              against the material after you submit.
            </T>
          </View>
          {quiz.questions.map((qq, i) => (
            <Question
              key={qq.id}
              n={i + 1}
              q={qq}
              scope={scope}
              value={answers[qq.id] ?? {}}
              onChange={(v) => setAnswers((a) => ({ ...a, [qq.id]: v }))}
            />
          ))}
          {error ? <Notice tone="danger" title={error} /> : null}
          <Button
            label={`Submit${answered ? ` (${answered} of ${quiz.questions.length} answered)` : ''}`}
            icon="send"
            onPress={() => void submit()}
            busy={busy}
            disabled={!online || answered === 0}
            hint={
              !online
                ? 'Submitting needs the server.'
                : answered === 0
                  ? 'Answer at least one question.'
                  : null
            }
            style={{ marginTop: space.lg }}
          />
        </>
      ) : null}
      {taking ? null : <Review quiz={quiz} attempt={last as QuizAttempt} scope={scope} />}
      {!taking ? (
        <View style={{ gap: space.sm, marginTop: space.lg }}>
          <Button
            kind="secondary"
            label="Take it again"
            icon="refresh"
            onPress={() => setRetake(true)}
          />
          <Button
            kind="ghost"
            label="Back to quizzes"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          />
        </View>
      ) : null}
    </Screen>
  );
}

function Question({
  n,
  q,
  scope,
  value,
  onChange,
}: {
  n: number;
  q: QuizQuestion;
  scope: string;
  value: { selected?: string | null; text?: string | null };
  onChange: (v: { selected?: string | null; text?: string | null }) => void;
}) {
  return (
    <View style={{ marginTop: space.lg, gap: space.sm }}>
      <T variant="caps" tone="lead">
        Question {n}
        {q.concept ? ` · ${q.concept}` : ''}
      </T>
      <Markdown text={q.prompt} topicId={scope} />
      {q.type === 'choice' ? (
        (q.options ?? []).map((o) => (
          <Check
            key={o.id}
            radio
            checked={value.selected === o.id}
            label={o.label}
            onToggle={() => onChange({ selected: o.id })}
          />
        ))
      ) : (
        <Input
          value={value.text ?? ''}
          onChangeText={(text) => onChange({ text })}
          placeholder={
            q.type === 'explain'
              ? 'In your own words'
              : q.type === 'spot_error'
                ? 'What is wrong, and why?'
                : 'A sentence or two'
          }
          multiline
          area
          accessibilityLabel={`Answer to question ${n}`}
        />
      )}
    </View>
  );
}

function Review({ quiz, attempt, scope }: { quiz: Quiz; attempt: QuizAttempt; scope: string }) {
  const { c } = useTheme();
  const grading = attempt.status === 'grading';
  const [error, setError] = useState<string | null>(null);

  const reread = async (q: QuizQuestion) => {
    setError(null);
    try {
      const topicId = q.chapter_id ?? (scope.startsWith('course--') ? null : scope);
      if (!topicId) return;
      const d = await api.topic(topicId);
      const pack = d.topic.resources.find((r) => r.type === 'pack');
      if (!pack) return;
      router.push(`/topic/${topicId}/read/${pack.id}${q.section ? `?section=${q.section}` : ''}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    }
  };

  return (
    <View style={{ gap: space.sm }}>
      <View style={{ paddingTop: space.lg, gap: space.xs }}>
        {grading ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Pulse />
            <T variant="label" tone="amber">
              Grading your written answers…
            </T>
          </View>
        ) : null}
        <T variant="display">
          {attempt.score != null ? `${Math.round(attempt.score * 100)}%` : 'Submitted'}
        </T>
        {attempt.status === 'failed' ? (
          <Notice
            tone="warning"
            title="Some written answers could not be graded"
            body="Choice questions are marked. Take it again to retry the rest."
          />
        ) : null}
        {attempt.weak_concepts?.length ? (
          <T variant="body" tone="lead">
            Worth another look: {attempt.weak_concepts.join(', ')}.
          </T>
        ) : attempt.status === 'graded' ? (
          <T variant="body" tone="lead">
            Nothing flagged. Solid.
          </T>
        ) : null}
      </View>
      {error ? <Notice tone="danger" title={error} /> : null}
      <SectionTitle>Question by question</SectionTitle>
      {quiz.questions.map((q, i) => {
        const r = attempt.results?.[q.id];
        const a = attempt.answers[q.id];
        const mine =
          q.type === 'choice' ? q.options?.find((o) => o.id === a?.selected)?.label : a?.text;
        const badge = !r
          ? ({ kind: 'enriching', label: 'Grading' } as const)
          : r.score >= 0.99
            ? ({ kind: 'ready', label: 'Right' } as const)
            : r.score <= 0.01
              ? ({ kind: 'failed', label: 'Not yet' } as const)
              : ({ kind: 'waiting', label: 'Partly' } as const);
        return (
          <View
            key={q.id}
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
              <T variant="caps" tone="lead" style={{ flex: 1 }}>
                Question {i + 1}
                {q.concept ? ` · ${q.concept}` : ''}
              </T>
              <Badge kind={badge.kind} label={badge.label} />
            </View>
            <Markdown text={q.prompt} topicId={scope} />
            <T variant="bodySmall" tone="lead">
              You: {mine || 'No answer'}
            </T>
            {r?.feedback ? <T variant="bodySmall">{r.feedback}</T> : null}
            {r && q.type === 'choice' && r.score < 1 && r.correct_option ? (
              <T variant="bodySmall" tone="sage">
                Right answer: {q.options?.find((o) => o.id === r.correct_option)?.label}
              </T>
            ) : null}
            {r?.explanation && r.score < 1 ? (
              <T variant="bodySmall" tone="lead">
                {r.explanation}
              </T>
            ) : null}
            {r && r.score < 1 ? (
              <Button
                kind="ghost"
                icon="menu-book"
                label="Reread this"
                onPress={() => void reread(q)}
              />
            ) : null}
          </View>
        );
      })}
      <Divider />
    </View>
  );
}
