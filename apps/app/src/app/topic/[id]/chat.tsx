import type { ChatMessage } from '@studyo/api';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Input } from '@/components/inputs';
import { Markdown } from '@/components/Markdown';
import { Button, Empty, Header, IconButton, Loading, Notice, T } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useChat, useOnline, useTopic } from '@/lib/hooks';
import { usePlayer } from '@/lib/player';
import { keys, queryClient, upsertChatMessage } from '@/lib/query';
import { DOCK_HEIGHT, fonts, MAX_WIDTH, radius, space, useTheme } from '@/theme';

/** Ask inside a topic. Answers come only from the pack and its sources, with links. */
export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const chat = useChat(id);
  const topic = useTopic(id);
  const { online } = useOnline();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const hasDock = usePlayer((s) => !!s.track);
  const pack = topic.data?.topic.resources.find((r) => r.type === 'pack');

  const messages = chat.data?.messages ?? [];
  const lastLen = messages.at(-1)?.text.length ?? 0;
  useEffect(() => {
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
  }, [messages.length, lastLen]);

  const answering = messages.some(
    (m) => m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming'),
  );
  const available = chat.data?.available ?? false;
  const blocked = !online
    ? 'The server is offline.'
    : !available
      ? (chat.data?.unavailable_reason ?? null)
      : null;

  const send = async () => {
    const q = text.trim();
    if (!q) return;
    setSending(true);
    setError(null);
    try {
      const turn = await api.send(id, q);
      upsertChatMessage(id, turn.user);
      upsertChatMessage(id, turn.assistant);
      setText('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.canvas, paddingTop: insets.top }}>
      <View style={{ width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' }}>
        <Header title="Ask" subtitle={topic.data?.topic.title} />
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scroll}
          style={{ flex: 1 }}
          contentContainerStyle={{
            width: '100%',
            maxWidth: MAX_WIDTH,
            alignSelf: 'center',
            padding: space.md,
            gap: space.lg,
          }}
        >
          {chat.isLoading ? <Loading /> : null}
          {chat.data && messages.length === 0 ? (
            <Empty
              icon="forum"
              title="Ask about this topic"
              body="Answers come from the pack and its saved sources, with links. If the material doesn't cover it, the answer says so."
            />
          ) : null}
          {messages.map((m) => (
            <Message key={m.id} m={m} topicId={id} packId={pack?.id} online={online} />
          ))}
        </ScrollView>
        <View
          style={{
            width: '100%',
            maxWidth: MAX_WIDTH,
            alignSelf: 'center',
            paddingHorizontal: space.md,
            paddingTop: space.sm,
            paddingBottom: (hasDock ? DOCK_HEIGHT : 0) + insets.bottom + space.sm,
            borderTopWidth: 1,
            borderTopColor: c.rule,
            backgroundColor: c.canvas,
          }}
        >
          {error ? <Notice tone="danger" title={error} /> : null}
          {blocked ? (
            <T variant="meta" tone="lead" style={{ marginBottom: space.xs }}>
              {blocked}
            </T>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
            <Input
              value={text}
              onChangeText={setText}
              placeholder={blocked ? 'Chat is paused' : 'Ask a question'}
              editable={!blocked}
              multiline
              style={[{ flex: 1, minHeight: 48, maxHeight: 140, paddingTop: 12 }]}
              accessibilityLabel="Your question"
              onKeyPress={(e) => {
                const ne = e.nativeEvent as unknown as { key: string; shiftKey?: boolean };
                if (Platform.OS === 'web' && ne.key === 'Enter' && !ne.shiftKey) {
                  (e as unknown as { preventDefault: () => void }).preventDefault();
                  void send();
                }
              }}
            />
            <IconButton
              name="arrow-upward"
              label="Send"
              filled
              onPress={() => void send()}
              disabled={!!blocked || !text.trim() || sending || answering}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function Message({
  m,
  topicId,
  packId,
  online,
}: {
  m: ChatMessage;
  topicId: string;
  packId?: string;
  online: boolean;
}) {
  const { c } = useTheme();
  const [busy, setBusy] = useState(false);
  if (m.role === 'user') {
    return (
      <View
        style={{
          alignSelf: 'flex-end',
          maxWidth: '85%',
          backgroundColor: c.surface,
          borderRadius: radius.lg,
          padding: space.md,
        }}
      >
        <T variant="body">{m.text}</T>
      </View>
    );
  }
  return (
    <View style={{ gap: space.sm }}>
      <T variant="caps" tone="lead">
        Studyo
      </T>
      {m.text ? <Markdown text={m.text} topicId={topicId} packId={packId} /> : null}
      {m.status === 'pending' || m.status === 'streaming' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <ActivityIndicator size="small" color={c.lead} />
          <T variant="meta" tone="lead">
            {m.status === 'pending'
              ? 'Waiting for its turn'
              : m.text
                ? 'Writing'
                : 'Looking through the pack'}
          </T>
        </View>
      ) : null}
      {m.status === 'failed' ? (
        <Notice tone="danger" icon="error-outline" title="No answer" body={m.error} />
      ) : null}
      {m.suggest_enrich ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: c.rule,
            borderStyle: 'dashed',
            borderRadius: radius.base,
            padding: space.md,
            gap: space.sm,
          }}
        >
          <T variant="label" style={{ fontFamily: fonts.uiSemibold }}>
            The pack doesn't cover this yet
          </T>
          <T variant="bodySmall" tone="lead">
            {m.suggest_enrich}
          </T>
          <Button
            kind="secondary"
            icon="travel-explore"
            label="Enrich further"
            busy={busy}
            disabled={!online}
            onPress={async () => {
              setBusy(true);
              try {
                await api.startJob(topicId, {
                  kind: 'enrich-deep',
                  focus: m.suggest_enrich ?? undefined,
                });
                await queryClient.invalidateQueries({ queryKey: keys.activeJobs });
                router.push(`/topic/${topicId}`);
              } finally {
                setBusy(false);
              }
            }}
          />
        </View>
      ) : null}
    </View>
  );
}
