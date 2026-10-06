import type { Job } from '@studyo/api';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { api } from '@/lib/api';
import { radius, space, useTheme } from '@/theme';
import { Pulse } from './status';
import { Button, Icon, ProgressBar, T, timeAgo } from './ui';

export const jobLabel = (job: Job) =>
  ({
    enrich: 'Building your study pack',
    'enrich-deep': 'Going deeper',
    condense: 'Writing a condensed doc',
    audio: 'Making your audio',
    answer: 'Chat reply',
    'course-outline': 'Planning your course',
    quiz: 'Writing a quiz',
    'quiz-grade': 'Grading your answers',
    assignment: 'Writing a take-home',
    'assignment-review': 'Reviewing your work',
  })[job.kind];

/** What the AI is doing on this topic right now, with the one action that matters. */
export function JobPanel({ job, online }: { job: Job; online: boolean }) {
  const { c } = useTheme();
  const [busy, setBusy] = useState(false);
  const waiting = job.status === 'needs_input';
  const queued = job.status === 'queued';
  return (
    <View
      style={{
        marginTop: space.md,
        borderRadius: radius.base,
        borderWidth: 1,
        borderColor: waiting ? c.primary : c.rule,
        backgroundColor: waiting ? c.tint : c.surface,
        padding: space.md,
        gap: space.sm,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        {waiting ? <Icon name="help" size={18} tone="primary" /> : <Pulse />}
        <T variant="caps" tone={waiting ? 'primary' : 'amber'} style={{ flex: 1 }}>
          {waiting ? 'Waiting for your answer' : queued ? 'Queued' : jobLabel(job)}
        </T>
        <T variant="meta" tone="faint">
          {job.cli === 'claude' ? 'Claude Code' : 'OpenCode'} ·{' '}
          {timeAgo(job.started ?? job.created)}
        </T>
      </View>
      <T variant="body">
        {waiting
          ? (job.questions?.title ?? 'A quick question before it continues')
          : (job.activity ?? 'Starting…')}
      </T>
      {!waiting && job.step ? (
        <View style={{ gap: 4 }}>
          <ProgressBar value={job.step.n / job.step.of} height={3} />
          <T variant="meta" tone="faint">
            Step {job.step.n} of {job.step.of}
          </T>
        </View>
      ) : null}
      {waiting && job.questions?.intro ? (
        <T variant="bodySmall" tone="lead">
          {job.questions.intro}
        </T>
      ) : null}
      <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', marginTop: space.xs }}>
        {waiting ? (
          <Button
            label="Answer"
            icon="edit"
            onPress={() => router.push(`/job/${job.id}`)}
            disabled={!online}
          />
        ) : (
          <Button
            kind="secondary"
            label="Show progress"
            icon="receipt-long"
            onPress={() => router.push(`/job/${job.id}`)}
          />
        )}
        <Button
          kind="ghost"
          label="Cancel"
          busy={busy}
          disabled={!online}
          onPress={async () => {
            setBusy(true);
            try {
              await api.cancel(job.id);
            } finally {
              setBusy(false);
            }
          }}
        />
      </View>
    </View>
  );
}
