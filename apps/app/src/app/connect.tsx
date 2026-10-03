import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { Input } from '@/components/inputs';
import { Button, Field, Header, Notice, Screen, T } from '@/components/ui';
import { signInWithAccess } from '@/lib/access';
import { ApiError, api, sameOriginServer } from '@/lib/api';
import { type Connection, usePrefs } from '@/lib/prefs';
import { queryClient } from '@/lib/query';
import { space } from '@/theme';

function defaultUrl() {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:8787`;
  }
  return '';
}

/** First run and "change server": URL, token and optional Cloudflare Access service token. */
export default function Connect() {
  const params = useLocalSearchParams<{ server?: string; token?: string }>();
  const existing = usePrefs((s) => s.connection);
  const setConnection = usePrefs((s) => s.setConnection);
  const [url, setUrl] = useState(params.server ?? existing?.url ?? defaultUrl());
  const [token, setToken] = useState(params.token ?? existing?.token ?? '');
  const [cfId, setCfId] = useState(existing?.cfClientId ?? '');
  const [cfSecret, setCfSecret] = useState(existing?.cfClientSecret ?? '');
  const [showCf, setShowCf] = useState(!!existing?.cfClientId);
  const [sameOrigin, setSameOrigin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessFor, setAccessFor] = useState<Connection | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [accessSure, setAccessSure] = useState(false);

  const connect = async (cfToken?: string, override?: Partial<Connection>) => {
    setBusy(true);
    setError(null);
    setAccessFor(null);
    const conn: Connection = {
      url: (override?.url ?? url).trim().replace(/\/+$/, ''),
      token: (override?.token ?? token).trim(),
      cfClientId: (override?.cfClientId ?? cfId).trim(),
      cfClientSecret: (override?.cfClientSecret ?? cfSecret).trim(),
      ...(cfToken
        ? { cfToken }
        : existing?.cfToken && existing.url === url.trim()
          ? { cfToken: existing.cfToken }
          : {}),
    };
    try {
      if (!/^https?:\/\//.test(conn.url))
        throw new ApiError(0, 'bad_url', 'The address must start with http:// or https://');
      const health = await api.health(conn);
      if (health?.name !== 'studyo')
        throw new ApiError(0, 'not_studyo', "That address answered, but it isn't a Studyo server.");
      await api.server(conn);
      queryClient.clear();
      setConnection(conn);
      router.replace('/');
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'access_required' || e.code === 'access_expired')) {
        setAccessFor(conn);
        setAccessSure(true);
      } else if (e instanceof ApiError && e.offline) {
        // A browser can't see Access's redirect from another origin, so offer the sign-in as a possibility.
        setAccessFor(conn);
        setAccessSure(false);
      } else {
        setError(
          e instanceof ApiError
            ? e.status === 401
              ? 'The server refused the access token.'
              : e.message
            : (e as Error).message,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  // A setup link (…/connect?server=…&token=…) connects straight away. Coming back from a Cloudflare Access
  // sign-in (web), the waiting connection now carries its Access token: try it.
  useEffect(() => {
    const pending = usePrefs.getState().pendingConnection;
    if (pending?.cfToken) {
      usePrefs.getState().setPending(null);
      setUrl(pending.url);
      setToken(pending.token);
      setCfId(pending.cfClientId);
      setCfSecret(pending.cfClientSecret);
      void connect(pending.cfToken, pending);
      return;
    }
    if (params.server && params.token) void connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = async () => {
    if (!accessFor) return;
    setSigningIn(true);
    try {
      const got = await signInWithAccess(accessFor, '/connect');
      if (got) await connect(got, accessFor);
    } finally {
      setSigningIn(false);
    }
  };

  // Served by the Studyo server itself (for example through a Cloudflare tunnel): use its own /api, which
  // shares the page's origin and so its Cloudflare Access sign-in.
  useEffect(() => {
    if (params.server || existing) return;
    void sameOriginServer().then((found) => {
      if (found) {
        setUrl(found);
        setSameOrigin(true);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Screen header={<Header title="Connect" back={!!existing} />}>
      <View style={{ paddingTop: space.lg, gap: space.sm, marginBottom: space.lg }}>
        <T variant="display">Connect to your server</T>
        <T variant="body" tone="lead">
          Studyo keeps your library on your home server. Enter its address and the access token it
          printed when it started.
        </T>
      </View>
      <Field
        label="Server address"
        hint={
          sameOrigin
            ? "This app is served by your Studyo server, so it uses the server's own /api."
            : 'A Tailscale or tunnel address works too.'
        }
      >
        <Input
          value={url}
          onChangeText={setUrl}
          placeholder="https://studyo.example.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          accessibilityLabel="Server address"
        />
      </Field>
      <Field label="Access token">
        <Input
          value={token}
          onChangeText={setToken}
          placeholder="From the server's first start"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          accessibilityLabel="Access token"
          onSubmitEditing={() => void connect()}
        />
      </Field>
      {showCf ? (
        <>
          <Field label="Cloudflare Access client ID">
            <Input value={cfId} onChangeText={setCfId} autoCapitalize="none" autoCorrect={false} />
          </Field>
          <Field label="Cloudflare Access client secret">
            <Input
              value={cfSecret}
              onChangeText={setCfSecret}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
          </Field>
        </>
      ) : (
        <Button
          kind="ghost"
          label="Server behind Cloudflare Access?"
          onPress={() => setShowCf(true)}
          style={{ alignSelf: 'flex-start' }}
        />
      )}
      {accessFor ? (
        <Notice
          tone={accessSure ? 'info' : 'warning'}
          icon={accessSure ? 'lock-outline' : 'cloud-off'}
          title={
            accessSure ? 'This server is behind Cloudflare Access' : "Couldn't reach the server"
          }
          body={
            accessSure
              ? "Sign in with Cloudflare Access to continue. You'll come straight back here afterwards."
              : "If it's behind Cloudflare Access, sign in first and you'll come straight back here. Otherwise check the address and that the server is running."
          }
          action={
            <Button
              label="Sign in with Cloudflare Access"
              icon="login"
              onPress={() => void signIn()}
              busy={signingIn}
            />
          }
        />
      ) : null}
      {error ? (
        <Notice tone="danger" icon="error-outline" title="Couldn't connect" body={error} />
      ) : null}
      <Button
        label="Connect"
        icon="link"
        onPress={() => void connect()}
        busy={busy}
        disabled={!url || !token}
        style={{ marginTop: space.md }}
      />
    </Screen>
  );
}
