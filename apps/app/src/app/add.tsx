import { router } from 'expo-router';
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
  const [mode, setMode] = useState<Mode>('link');
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
    <Screen header={<Header title="Add topic" />}>
      <View style={{ paddingTop: space.lg, gap: space.sm, marginBottom: space.lg }}>
        <T variant="display">What do you want to learn?</T>
        <T variant="body" tone="lead">
          The server keeps the original, finds the background you need from real sources, and links
          every addition to where it came from.
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
          { value: 'pdf', label: 'PDF' },
          { value: 'topic', label: 'Topic name' },
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
            label="Topic"
            hint="The AI finds primary sources first, then builds the pack from them. You can check what it chose."
          >
            <Input
              value={name}
              onChangeText={setName}
              placeholder="For example: Raft consensus"
              autoFocus
              accessibilityLabel="Topic"
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
                  A paper, a chapter or a whitepaper.
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
      </View>

      {error ? (
        <Notice tone="danger" icon="error-outline" title="Couldn't add the topic" body={error} />
      ) : null}
      <Button
        label={enrich ? 'Add and build' : 'Add topic'}
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
