import type { KnowsEntry } from '@studyo/api';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Input } from '@/components/inputs';
import {
  Badge,
  Button,
  Field,
  Header,
  IconButton,
  Loading,
  Notice,
  Screen,
  SectionTitle,
  T,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useOnline, useProfile } from '@/lib/hooks';
import { keys, queryClient } from '@/lib/query';
import { space, useTheme } from '@/theme';

const VIA_LABEL: Record<KnowsEntry['via'], string> = {
  'self-reported': 'You said',
  inferred: 'Inferred',
  read: 'Read in Studyo',
  forgot: 'Forgot',
};

/** library/profile.md: what Studyo knows about the person, editable. */
export default function Profile() {
  const { c } = useTheme();
  const profile = useProfile();
  const { online } = useOnline();
  const [knows, setKnows] = useState<KnowsEntry[] | null>(null);
  const [notes, setNotes] = useState('');
  const [term, setTerm] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile.data && knows === null) {
      setKnows(profile.data.knows);
      setNotes(profile.data.notes);
    }
  }, [profile.data, knows]);

  if (!knows) {
    return (
      <Screen header={<Header title="Your profile" />}>
        {profile.error ? (
          <Notice tone="danger" title={(profile.error as Error).message} />
        ) : (
          <Loading />
        )}
      </Screen>
    );
  }

  const add = () => {
    const t = term.trim();
    if (!t || knows.some((k) => k.term.toLowerCase() === t.toLowerCase())) return;
    setKnows([
      ...knows,
      { term: t, via: 'self-reported', date: new Date().toISOString().slice(0, 10) },
    ]);
    setTerm('');
    setSaved(false);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const p = await api.saveProfile({ knows, notes });
      queryClient.setQueryData(keys.profile, p);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen header={<Header title="Your profile" />}>
      <T variant="bodySmall" tone="lead" style={{ paddingTop: space.md }}>
        Packs and condensed docs skip what you already know. Studyo only records what you tell it or
        what you mark as read.
      </T>
      <SectionTitle>{`You know (${knows.length})`}</SectionTitle>
      {knows.map((k, i) => (
        <View
          key={`${k.term}-${i}`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            minHeight: 48,
            borderBottomWidth: 1,
            borderBottomColor: c.rule,
          }}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <T variant="body">{k.term}</T>
            <T variant="meta" tone="faint">
              {k.topic ? `from ${k.topic} · ` : ''}
              {k.date ?? ''}
            </T>
          </View>
          <Badge kind={k.via === 'read' ? 'ready' : 'neutral'} label={VIA_LABEL[k.via]} />
          <IconButton
            name="close"
            label={`Remove ${k.term}`}
            onPress={() => {
              setKnows(knows.filter((_, j) => j !== i));
              setSaved(false);
            }}
          />
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
        <Input
          value={term}
          onChangeText={setTerm}
          placeholder="Add something you know"
          style={[{ flex: 1 }]}
          onSubmitEditing={add}
        />
        <Button kind="secondary" label="Add" onPress={add} disabled={!term.trim()} />
      </View>
      <SectionTitle>About you</SectionTitle>
      <Field label="Notes" hint="Background, how you like things explained, what to avoid.">
        <Input
          value={notes}
          onChangeText={(v) => {
            setNotes(v);
            setSaved(false);
          }}
          multiline
          area
          style={[{ minHeight: 160 }]}
        />
      </Field>
      {error ? <Notice tone="danger" title={error} /> : null}
      <Button
        label={saved ? 'Saved' : 'Save profile'}
        icon={saved ? 'check' : undefined}
        onPress={save}
        busy={busy}
        disabled={!online}
      />
    </Screen>
  );
}
