import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Check, Input, Segmented } from '@/components/inputs';
import { Button, Field, Header, Icon, Notice, Screen, T } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useOnline, useServerInfo } from '@/lib/hooks';
import { keys, queryClient } from '@/lib/query';
import { PDF_TYPES, type Picked, pickFile } from '@/lib/upload';
import { radius, space, useTheme } from '@/theme';

type Mode = 'link' | 'pdf' | 'topic';

/** Three ways in: a link, a PDF, or just a name. */
export default function Add() {
  const { c } = useTheme();
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  const course = kind === 'course';
  const [goal, setGoal] = useState('');
  const [mode, setMode] = useState<Mode>(course ? 'pdf' : 'link');
  const [link, setLink] = useState('');
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [pdf, setPdf] = useState<Picked | null>(null);
  const [enrich, setEnrich] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { online, reason } = useOnline();
  const server = useServerInfo();
  const cli = server.data?.clis.find((x) => x.id === server.data?.settings.cli);

  const ready =
    mode === 'link'
      ? /^https?:\/\/\S+\.\S+/.test(link.trim())
      : mode === 'topic'
        ? name.trim().length > 1
        : !!pdf;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      if (course) {
        let made;
        if (mode === 'pdf' && pdf) {
          if (title.trim()) pdf.form.set('title', title.trim());
          if (goal.trim()) pdf.form.set('goal', goal.trim());
          made = await api.createCourseFromPdf(pdf.form);
        } else {
          made = await api.createCourse({
            origin:
              mode === 'link'
                ? { type: 'link', link: link.trim() }
                : { type: 'topic', name: name.trim() },
            title: title.trim() || undefined,
            goal: goal.trim() || undefined,
          });
        }
        await queryClient.invalidateQueries({ queryKey: keys.courses });
        await queryClient.invalidateQueries({ queryKey: keys.activeJobs });
        router.replace(`/course/${made.course.id}`);
        return;
      }
      let result;
      if (mode === 'pdf' && pdf) {
        if (title.trim()) pdf.form.set('title', title.trim());
        pdf.form.set('enrich', String(enrich));
        result = await api.createTopicFromPdf(pdf.form);
      } else if (mode === 'link') {
        result = await api.createTopic({
          origin: { type: 'link', link: link.trim() },
          title: title.trim() || undefined,
          enrich,
        });
      } else {
        result = await api.createTopic({
          origin: { type: 'topic', name: name.trim() },
          title: title.trim() || undefined,
          enrich,
        });
      }
      await queryClient.invalidateQueries({ queryKey: keys.topics });
      await queryClient.invalidateQueries({ queryKey: keys.activeJobs });
      router.replace(`/topic/${result.topic.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen header={<Header title={course ? 'Add course' : 'Add topic'} />}>
      <View style={{ paddingTop: space.lg, gap: space.sm, marginBottom: space.lg }}>
        <T variant="display">
          {course ? 'What do you want to study?' : 'What do you want to learn?'}
        </T>
        <T variant="body" tone="lead">
          {course
            ? 'A book, a long document or a whole subject. The server finds the chapters without reading everything, you approve the outline, and chapters are built as you go.'
            : 'The server keeps the original, finds the background you need from real sources, and links every addition to where it came from.'}
        </T>
      </View>

      <Segmented
        value={mode}
        onChange={(m) => {
          setMode(m);
          setError(null);
        }}
        options={[
          { value: 'link', label: 'Link' },
          { value: 'pdf', label: course ? 'Book (PDF)' : 'PDF' },
          { value: 'topic', label: course ? 'Subject' : 'Topic name' },
        ]}
      />

      <View style={{ marginTop: space.lg }}>
        {mode === 'link' ? (
          <Field label="Link" hint="A blog post, paper page or article.">
            <Input
              value={link}
              onChangeText={setLink}
              placeholder="https://"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              autoFocus
              accessibilityLabel="Link"
            />
          </Field>
        ) : null}
        {mode === 'topic' ? (
          <Field
            label={course ? 'Subject' : 'Topic'}
            hint={
              course
                ? 'No source? The AI looks for a syllabus or standard textbook to follow and shows you the outline first.'
                : 'The AI finds primary sources first, then builds the pack from them. You can check what it chose.'
            }
          >
            <Input
              value={name}
              onChangeText={setName}
              placeholder={
                course ? 'For example: Distributed systems' : 'For example: Raft consensus'
              }
              autoFocus
              accessibilityLabel={course ? 'Subject' : 'Topic'}
            />
          </Field>
        ) : null}
        {mode === 'pdf' ? (
          <Field label="PDF">
            <View
              style={{
                borderWidth: 1,
                borderStyle: 'dashed',
                borderColor: c.ruleStrong,
                borderRadius: radius.base,
                padding: space.md,
                gap: space.sm,
                alignItems: 'flex-start',
              }}
            >
              {pdf ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <Icon name="picture-as-pdf" tone="primary" />
                  <T variant="label">{pdf.name}</T>
                </View>
              ) : (
                <T variant="meta" tone="lead">
                  {course
                    ? 'A book with selectable text. Scanned PDFs are not supported yet.'
                    : 'A paper, a chapter or a whitepaper.'}
                </T>
              )}
              <Button
                kind="secondary"
                icon="upload-file"
                label={pdf ? 'Choose another' : 'Choose a PDF'}
                onPress={async () => setPdf(await pickFile(PDF_TYPES))}
              />
            </View>
          </Field>
        ) : null}
        <Field label="Title (optional)">
          <Input
            value={title}
            onChangeText={setTitle}
            placeholder="Taken from the source if empty"
            accessibilityLabel="Title"
          />
        </Field>
        {course ? (
          <Field
            label="Your goal (optional)"
            hint="What you want to be able to do afterwards. It shapes the outline and what gets emphasised."
          >
            <Input
              value={goal}
              onChangeText={setGoal}
              multiline
              area
              placeholder="For example: design the storage layer of a service I'm building"
              accessibilityLabel="Goal"
            />
          </Field>
        ) : (
          <Check
            checked={enrich}
            onToggle={() => setEnrich((v) => !v)}
            label="Build the study pack now"
            note={
              enrich
                ? `Runs on your server with ${cli?.label ?? 'the selected CLI'}. It may ask one quick question about what you already know.`
                : 'Saves the topic. Build the pack later from the topic page.'
            }
          />
        )}
      </View>

      {error ? (
        <Notice
          tone="danger"
          icon="error-outline"
          title={course ? "Couldn't add the course" : "Couldn't add the topic"}
          body={error}
        />
      ) : null}
      <Button
        label={course ? 'Plan the course' : enrich ? 'Add and build' : 'Add topic'}
        icon="add"
        onPress={create}
        busy={busy}
        disabled={!ready || !online}
        hint={!online ? reason : null}
        style={{ marginTop: space.lg }}
      />
    </Screen>
  );
}
