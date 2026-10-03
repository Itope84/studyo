import type { CliId } from '@studyo/api';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { Input, Segmented } from '@/components/inputs';
import {
  Badge,
  Button,
  Field,
  formatBytes,
  Header,
  Icon,
  Notice,
  Row,
  Screen,
  SectionTitle,
  T,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useServerInfo } from '@/lib/hooks';
import { useLive } from '@/lib/live';
import { usePrefs } from '@/lib/prefs';
import { enablePush, type PushState, pushState } from '@/lib/push';
import { keys, queryClient } from '@/lib/query';
import { space } from '@/theme';

export default function Settings() {
  const connection = usePrefs((s) => s.connection);
  const theme = usePrefs((s) => s.theme);
  const setTheme = usePrefs((s) => s.setTheme);
  const setConnection = usePrefs((s) => s.setConnection);
  const status = useLive((s) => s.status);
  const server = useServerInfo();
  const info = server.data;
  const [cli, setCli] = useState<CliId | null>(null);
  const [models, setModels] = useState<{ claude: string; opencode: string }>({
    claude: '',
    opencode: '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [push, setPush] = useState<PushState>('unsupported');

  useEffect(() => {
    if (info && cli === null) {
      setCli(info.settings.cli);
      setModels({
        claude: info.settings.models?.claude ?? '',
        opencode: info.settings.models?.opencode ?? '',
      });
    }
  }, [info, cli]);

  useEffect(() => {
    void pushState()
      .then(setPush)
      .catch(() => setPush('unsupported'));
  }, []);

  const save = async () => {
    if (!cli) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.saveSettings({
        cli,
        models: { claude: models.claude || null, opencode: models.opencode || null },
      });
      await queryClient.invalidateQueries({ queryKey: keys.server });
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen header={<Header title="Settings" back={false} />}>
      <SectionTitle>Server</SectionTitle>
      <Row
        title={connection?.url ?? 'Not connected'}
        leading={<Icon name="dns" size={20} tone="lead" />}
        subtitle={
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center', marginTop: 2 }}>
            <Badge
              kind={status === 'live' ? 'ready' : status === 'down' ? 'offline' : 'enriching'}
              label={status === 'live' ? 'Connected' : status === 'down' ? 'Offline' : 'Connecting'}
            />
            {info ? (
              <T variant="meta" tone="lead">
                v{info.version} · library {formatBytes(info.storage.library_bytes)}
              </T>
            ) : null}
          </View>
        }
      />
      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
        <Button
          kind="secondary"
          label="Change server or token"
          onPress={() => router.push('/connect')}
        />
        <Button
          kind="ghost"
          label="Disconnect"
          onPress={() => {
            setConnection(null);
            queryClient.clear();
            router.replace('/connect');
          }}
        />
      </View>

      <SectionTitle>AI on the server</SectionTitle>
      <T variant="bodySmall" tone="lead" style={{ marginBottom: space.sm }}>
        Which CLI runs enrichment, condensing and chat. Both use the same skills.
      </T>
      {info && cli ? (
        <>
          <Segmented
            value={cli}
            onChange={(v) => {
              setCli(v);
              setSaved(false);
            }}
            options={info.clis.map((c) => ({
              value: c.id,
              label: c.label,
              disabled: !c.installed,
            }))}
          />
          <View style={{ marginTop: space.sm, gap: 4 }}>
            {info.clis.map((c) => (
              <T key={c.id} variant="meta" tone={c.installed ? 'lead' : 'danger'}>
                {c.label}:{' '}
                {c.installed
                  ? `installed${c.version ? ` (${c.version})` : ''}`
                  : 'not installed on the server'}
              </T>
            ))}
          </View>
          <View style={{ marginTop: space.md }}>
            <Field
              label={cli === 'claude' ? 'Claude model (optional)' : 'OpenCode model (optional)'}
              hint={
                cli === 'claude'
                  ? 'Empty uses Claude Code’s default. For example: sonnet, opus.'
                  : 'provider/model. Empty uses your OpenCode default.'
              }
            >
              <Input
                value={models[cli]}
                onChangeText={(v) => {
                  setModels((m) => ({ ...m, [cli]: v }));
                  setSaved(false);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Default"
              />
            </Field>
          </View>
          {error ? <Notice tone="danger" title={error} /> : null}
          <Button
            label={saved ? 'Saved' : 'Save'}
            icon={saved ? 'check' : undefined}
            onPress={save}
            busy={saving}
            kind="secondary"
          />
        </>
      ) : (
        <T variant="meta" tone="lead">
          Connect to see the server's options.
        </T>
      )}

      <SectionTitle>You</SectionTitle>
      <Row
        title="What Studyo knows about you"
        subtitle="Concepts you know and how you like things explained. Packs use it to skip what you know."
        leading={<Icon name="person-outline" size={20} tone="lead" />}
        trailing={<Icon name="chevron-right" size={20} tone="faint" />}
        onPress={() => router.push('/profile')}
      />

      <SectionTitle>Appearance</SectionTitle>
      <Segmented
        value={theme}
        onChange={setTheme}
        options={[
          { value: 'system', label: 'System' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
      />

      <SectionTitle>Notifications</SectionTitle>
      {push === 'on' ? (
        <Notice
          tone="neutral"
          icon="notifications-active"
          title="On"
          body="You'll hear when Studyo has a question, a pack is ready or a job fails."
        />
      ) : push === 'off' ? (
        <Button
          kind="secondary"
          icon="notifications"
          label="Turn on notifications"
          onPress={async () => setPush(await enablePush())}
        />
      ) : push === 'needs-install' ? (
        <Notice
          tone="info"
          icon="ios-share"
          title="Add Studyo to your Home Screen first"
          body="On iPhone, open the Share menu and choose Add to Home Screen. Notifications work from the installed app."
        />
      ) : push === 'blocked' ? (
        <Notice
          tone="warning"
          icon="notifications-off"
          title="Blocked in the browser"
          body="Allow notifications for this site in the browser's settings."
        />
      ) : (
        <T variant="meta" tone="lead">
          {Platform.OS === 'web'
            ? 'This browser does not support notifications.'
            : 'Notifications come with the Android build.'}
        </T>
      )}

      <SectionTitle>Downloads</SectionTitle>
      <T variant="meta" tone="lead">
        {Platform.OS === 'web'
          ? 'Offline downloads come with the Android app. The web version streams from the server.'
          : 'Offline downloads are coming in the next build step.'}
      </T>
    </Screen>
  );
}
