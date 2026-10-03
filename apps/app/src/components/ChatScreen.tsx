import type { ChatMessage } from '@studyo/api';
import { courseIdOf, isCourseScope } from '@studyo/api';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Input } from '@/components/inputs';
import { Markdown } from '@/components/Markdown';
import { Sheet } from '@/components/Sheet';
import {
  Badge,
  Button,
  Empty,
  Header,
  Icon,
  IconButton,
  Loading,
  Notice,
  Row,
  T,
} from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useChat, useCourse, useOnline, useTopic } from '@/lib/hooks';
import { usePlayer } from '@/lib/player';
import { usePrefs } from '@/lib/prefs';
import { keys, queryClient, upsertChatMessage } from '@/lib/query';
import { DOCK_HEIGHT, fonts, MAX_WIDTH, radius, space, useTheme } from '@/theme';

/**
 * Ask inside a topic, a chapter or a whole course (`id` is then the course scope id). Answers come only from
 * the pack and its sources, with links.
 */
export function ChatScreen({ id }: { id: string }) {
  const isCourse = isCourseScope(id);
  const course = useCourse(isCourse ? courseIdOf(id) : '');
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const chat = useChat(id);
  const topic = useTopic(isCourse ? '' : id);
  const { online } = useOnline();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const hasDock = usePlayer((s) => !!s.track);
  const pack = topic.data?.topic.resources.find((r) => r.type === 'pack');
  const sourceList = isCourse
    ? (course.data?.course.sources ?? []).map((s) => ({
        id: s.path,
        title: s.title,
        url: s.url ?? null,
      }))
    : (topic.data?.topic.resources.filter((r) => r.type === 'source') ?? []);
  const sources = new Map(sourceList.map((r) => [r.id.toUpperCase(), r.title]));
  const [sourcesOpen, setSourcesOpen] = useState(false);

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
        <Header
          title="Ask"
          subtitle={isCourse ? course.data?.course.title : topic.data?.topic.title}
        />
        {/* What answers are allowed to draw on. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            paddingHorizontal: space.md,
            paddingVertical: space.sm,
            backgroundColor: c.tint,
            borderBottomWidth: 1,
            borderBottomColor: c.rule,
          }}
        >
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.sage }} />
          <T variant="meta" tone="lead" style={{ flex: 1 }} numberOfLines={1}>
            {isCourse ? 'From this course' : 'From this pack only'} · {sourceList.length} source
            {sourceList.length === 1 ? '' : 's'}
          </T>
          <Button
            kind="ghost"
            icon="menu-book"
            label="Sources"
            onPress={() => setSourcesOpen(true)}
          />
        </View>
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
              title={isCourse ? 'Ask about this course' : 'Ask about this topic'}
              body={
                isCourse
                  ? 'Good for questions across chapters. It looks at the course map first, then opens only the chapters it needs.'
                  : "Answers come from the pack and its saved sources, with links. If the material doesn't cover it, the answer says so."
              }
            />
          ) : null}
          {messages.map((m) => (
            <Message
              key={m.id}
              m={m}
              topicId={id}
              packId={pack?.id}
              online={online}
              sources={sources}
            />
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
              placeholder={blocked ? 'Chat is paused' : 'Ask a question grounded in this pack'}
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
      <Sheet open={sourcesOpen} onClose={() => setSourcesOpen(false)} title="Sources in this pack">
        {sourceList.length === 0 ? (
          <T variant="bodySmall" tone="lead">
            No saved sources yet.
          </T>
        ) : (
          sourceList.map((r) => (
            <Row
              key={r.id}
              title={r.title}
              subtitle={`${r.id}${r.url ? ` · ${hostOf(r.url)}` : ''}`}
              leading={<Icon name="verified" size={18} tone="sage" />}
              trailing={r.url ? <Icon name="open-in-new" size={16} tone="faint" /> : undefined}
              onPress={r.url ? () => void Linking.openURL(r.url as string) : undefined}
            />
          ))
        )}
      </Sheet>
    </View>
  );
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function Message({
  m,
  topicId,
  packId,
  online,
  sources,
}: {
  m: ChatMessage;
  topicId: string;
  packId?: string;
  online: boolean;
  sources: Map<string, string>;
}) {
  const { c } = useTheme();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const dismissed = usePrefs((s) => s.dismissedOffers.includes(m.id));
  const dismissOffer = usePrefs((s) => s.dismissOffer);

  if (m.role === 'user') {
    return (
      <View style={{ alignSelf: 'flex-end', maxWidth: '85%', gap: 4 }}>
        <T variant="meta" tone="faint" style={{ alignSelf: 'flex-end' }}>
          You · {timeOf(m.created)}
        </T>
        <View
          style={{
            backgroundColor: c.primary,
            borderRadius: radius.lg,
            borderTopRightRadius: radius.sm,
            paddingHorizontal: space.md,
            paddingVertical: space.sm + 4,
          }}
        >
          <Text
            style={{ fontFamily: fonts.ui, fontSize: 15.5, lineHeight: 23, color: c.onPrimary }}
          >
            {m.text}
          </Text>
        </View>
      </View>
    );
  }

  const done = m.status === 'complete';
  const grounded = done && /\[S\d+/.test(m.text);
  const gap = done && !!m.suggest_enrich;
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: radius.base,
            backgroundColor: c.primarySoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="auto-stories" size={14} tone="primary" />
        </View>
        <T variant="label" style={{ fontFamily: fonts.uiSemibold }}>
          Studyo
        </T>
        {gap ? (
          <Badge kind="neutral" label="Source gap" />
        ) : grounded ? (
          <Badge kind="ready" label="Grounded" />
        ) : null}
        <T variant="meta" tone="faint" style={{ marginLeft: 'auto' }}>
          {timeOf(m.created)}
        </T>
      </View>
      <View
        style={{
          backgroundColor: c.surfaceRaised,
          borderWidth: 1,
          borderColor: c.rule,
          borderRadius: radius.lg,
          padding: space.md,
          gap: space.sm,
        }}
      >
        {m.text ? (
          <Markdown text={m.text} topicId={topicId} packId={packId} sources={sources} />
        ) : null}
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
        {done && m.text ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginTop: -space.xs,
              marginLeft: -space.sm,
            }}
          >
            <IconButton
              name={copied ? 'check' : 'content-copy'}
              label={copied ? 'Copied' : 'Copy answer'}
              tone="lead"
              onPress={async () => {
                await Clipboard.setStringAsync(m.text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            />
            {copied ? (
              <T variant="meta" tone="lead">
                Copied
              </T>
            ) : null}
          </View>
        ) : null}
        {m.suggest_enrich && !dismissed && !isCourseScope(topicId) ? (
          <View
            style={{
              backgroundColor: c.surface,
              borderRadius: radius.base,
              padding: space.md,
              gap: space.sm,
            }}
          >
            <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
              <Icon name="add-to-photos" size={20} tone="primary" />
              <View style={{ flex: 1, gap: 2 }}>
                <T variant="label" style={{ fontFamily: fonts.uiSemibold }}>
                  The pack doesn't cover this yet
                </T>
                <T variant="meta" tone="lead">
                  Enrich the topic with sources on: {m.suggest_enrich}
                </T>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button
                label="Enrich further"
                icon="travel-explore"
                busy={busy}
                disabled={!online}
                style={{ flexGrow: 1 }}
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
              <Button kind="secondary" label="Dismiss" onPress={() => dismissOffer(m.id)} />
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}
