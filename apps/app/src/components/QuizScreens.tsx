import type { Quiz } from '@studyo/api';
import { courseIdOf, isCourseScope } from '@studyo/api';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { ApiError, api } from '@/lib/api';
import { useCourse, useOnline, useQuizzes, useTopic } from '@/lib/hooks';
import { keys, queryClient } from '@/lib/query';
import { space } from '@/theme';
import { Input, Segmented } from './inputs';
import { Sheet } from './Sheet';
import {
  Badge,
  Button,
  Empty,
  Field,
  Header,
  Loading,
  Notice,
  Row,
  Screen,
  SectionTitle,
  T,
  timeAgo,
} from './ui';

/** Quizzes for a topic, a chapter or a whole course. A quiz is only made when you ask for one. */
export function QuizListScreen({ scope }: { scope: string }) {
  const course = isCourseScope(scope);
  const q = useQuizzes(scope);
  const topic = useTopic(course ? '' : scope);
  const courseQ = useCourse(course ? courseIdOf(scope) : '');
  const { online, reason } = useOnline();
  const [open, setOpen] = useState(false);
  const title = course ? courseQ.data?.course.title : topic.data?.topic.title;
  const hasMaterial = course
    ? (courseQ.data?.chapters.some((c) => c.state !== 'planned' && c.state !== 'building') ?? false)
    : (topic.data?.topic.resources.some((r) => r.type === 'pack' || r.type === 'condensed') ??
      false);

  return (
    <Screen header={<Header title="Quizzes" subtitle={title} />}>
      <View style={{ paddingTop: space.lg, gap: space.sm }}>
        <T variant="display">Check what stuck</T>
        <T variant="body" tone="lead">
          {course
            ? 'A quiz across the chapters you have built. Questions come from the packs, and every one points back to where it is explained.'
            : 'Questions come from this pack, and every one points back to where it is explained. Nothing is graded unless you ask.'}
        </T>
        <Button
          label="Make a quiz"
          icon="quiz"
          onPress={() => setOpen(true)}
          disabled={!online || !hasMaterial}
          hint={!online ? reason : !hasMaterial ? 'Build a pack first.' : null}
          style={{ marginTop: space.sm }}
        />
      </View>
      {q.error ? (
        <Notice tone="danger" title="Couldn't load quizzes" body={(q.error as Error).message} />
      ) : null}
      <SectionTitle>Your quizzes</SectionTitle>
      {q.isLoading ? <Loading /> : null}
      {q.data && q.data.quizzes.length === 0 ? (
        <Empty
          icon="quiz"
          title="No quizzes yet"
          body="Make one when you want to test yourself. Written answers are graded against the material."
        />
      ) : null}
      {q.data?.quizzes.map((z) => (
        <QuizRow key={z.id} quiz={z} scope={scope} />
      ))}
      <Sheet open={open} onClose={() => setOpen(false)} title="Make a quiz">
        <NewQuiz scope={scope} onDone={() => setOpen(false)} />
      </Sheet>
    </Screen>
  );
}

function QuizRow({ quiz, scope }: { quiz: Quiz; scope: string }) {
  const last = quiz.attempts.at(-1);
  const badge =
    quiz.status === 'generating'
      ? ({ kind: 'enriching', label: 'Writing' } as const)
      : quiz.status === 'failed'
        ? ({ kind: 'failed', label: 'Failed' } as const)
        : last?.status === 'grading'
          ? ({ kind: 'enriching', label: 'Grading' } as const)
          : last && last.score != null
            ? ({ kind: 'ready', label: `${Math.round(last.score * 100)}%` } as const)
            : ({ kind: 'captured', label: 'Not taken' } as const);
  return (
    <Row
      title={quiz.title}
      subtitle={
        quiz.status === 'failed'
          ? (quiz.failure_reason ?? 'The quiz could not be written.')
          : `${quiz.questions.length} questions${quiz.focus ? ` · ${quiz.focus}` : ''} · ${timeAgo(quiz.created)}${quiz.attempts.length ? ` · ${quiz.attempts.length} attempt${quiz.attempts.length > 1 ? 's' : ''}` : ''}`
      }
      meta={<Badge kind={badge.kind} label={badge.label} />}
      onPress={
        quiz.status === 'ready'
          ? () => router.push(`/quiz/${quiz.id}?scope=${encodeURIComponent(scope)}`)
          : undefined
      }
      accessibilityLabel={`${quiz.title}, ${badge.label}`}
    />
  );
}

function NewQuiz({ scope, onDone }: { scope: string; onDone: () => void }) {
  const [count, setCount] = useState('8');
  const [focus, setFocus] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.createQuiz(scope, { count: Number(count), focus: focus.trim() || undefined });
      await queryClient.invalidateQueries({ queryKey: keys.quizzes(scope) });
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
      <Field label="How many questions">
        <Segmented
          value={count}
          onChange={setCount}
          options={[
            { value: '5', label: '5' },
            { value: '8', label: '8' },
            { value: '12', label: '12' },
          ]}
        />
      </Field>
      <Field label="Focus (optional)" hint="A concept or section to concentrate on.">
        <Input
          value={focus}
          onChangeText={setFocus}
          placeholder="Everything, if empty"
          accessibilityLabel="Focus"
        />
      </Field>
      {error ? <Notice tone="danger" title={error} /> : null}
      <Button label="Make the quiz" icon="quiz" busy={busy} onPress={() => void go()} />
      <T variant="meta" tone="faint">
        It runs on your server and takes a minute or two.
      </T>
    </View>
  );
}
