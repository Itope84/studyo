import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { DocFrame } from '@/components/DocFrame';
import type { DocFrameHandle, DocMessage } from '@/components/DocFrame.types';
import { DownloadSheet } from '@/components/DownloadSheet';
import { Sheet } from '@/components/Sheet';
import { Header, IconButton, Loading, Notice, ProgressBar, Row, Screen, T } from '@/components/ui';
import { ApiError, api, fileUrl } from '@/lib/api';
import { useServerInfo, useTopic } from '@/lib/hooks';
import { keys, queryClient } from '@/lib/query';
import { space, useTheme } from '@/theme';

/** The pack or a condensed doc as a clean page. Remembers where you stopped. */
export default function Reader() {
  const { id, rid, section } = useLocalSearchParams<{
    id: string;
    rid: string;
    section?: string;
  }>();
  const { scheme } = useTheme();
  const topic = useTopic(id);
  const server = useServerInfo();
  const frame = useRef<DocFrameHandle>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [pos, setPos] = useState<{ fraction: number; section: string | null } | null>(null);
  const [headings, setHeadings] = useState<{ id: string; depth: number; text: string }[]>([]);
  const [done, setDone] = useState(false);
  // The first theme goes in the URL; later changes are sent as messages, so the page doesn't reload.
  const [initialScheme] = useState(scheme);
  const lastSave = useRef(0);
  const pending = useRef<{ fraction: number; section: string | null } | null>(null);

  const rendered = useQuery({
    queryKey: keys.rendered(id, rid),
    queryFn: () => api.rendered(id, rid),
    staleTime: 0,
  });
  const resource = topic.data?.topic.resources.find((r) => r.id === rid);
  const saved = topic.data?.progress.items[rid];

  useEffect(() => {
    if (saved?.done) setDone(true);
  }, [saved?.done]);

  const save = useCallback(
    async (fraction: number, sec: string | null, markDone?: boolean) => {
      lastSave.current = Date.now();
      try {
        await api.saveProgress(id, {
          resource_id: rid,
          position: fraction,
          section: sec,
          done: markDone || undefined,
          updated: new Date().toISOString(),
        });
      } catch {
        // Offline: the next scroll saves again.
      }
    },
    [id, rid],
  );

  // Save the last position when leaving.
  useEffect(
    () => () => {
      const p = pending.current;
      if (p) {
        void save(p.fraction, p.section).then(() => {
          void queryClient.invalidateQueries({ queryKey: keys.topic(id) });
          void queryClient.invalidateQueries({ queryKey: keys.topics });
        });
      }
    },
    [id, save],
  );

  useEffect(() => {
    frame.current?.post({ type: 'studyo:theme', theme: scheme });
  }, [scheme]);

  const onMessage = useCallback(
    (msg: DocMessage) => {
      if (msg.type === 'studyo:ready') {
        setHeadings(msg.headings);
        frame.current?.post({ type: 'studyo:theme', theme: scheme });
        if (section) frame.current?.post({ type: 'studyo:goto', section, flash: true });
        else if (saved && !saved.done) {
          frame.current?.post({
            type: 'studyo:goto',
            section: saved.section ?? undefined,
            fraction: saved.position,
          });
        }
      } else if (msg.type === 'studyo:position') {
        pending.current = { fraction: msg.fraction, section: msg.section };
        setPos({ fraction: msg.fraction, section: msg.section });
        if (Date.now() - lastSave.current > 5000) void save(msg.fraction, msg.section);
      }
    },
    [save, saved, scheme, section],
  );

  const token = server.data?.file_token;
  const url =
    rendered.data && token
      ? `${fileUrl(token, rendered.data.html_path)}?theme=${initialScheme}`
      : null;
  const renderError = rendered.error instanceof ApiError ? rendered.error : null;

  return (
    <Screen
      scroll={false}
      wide
      header={
        <Header
          title={resource?.title ?? 'Reading'}
          subtitle={topic.data?.topic.title}
          right={
            <>
              <IconButton
                name="toc"
                label="Outline"
                onPress={() => setOutlineOpen(true)}
                disabled={!headings.length}
              />
              <IconButton
                name="file-download"
                label="Download as PDF or Markdown"
                onPress={() => setDownloadOpen(true)}
                disabled={!resource}
              />
              <IconButton
                name="forum"
                label="Ask about this"
                onPress={() => router.push(`/topic/${id}/chat`)}
              />
              <IconButton
                name={done ? 'check-circle' : 'check-circle-outline'}
                tone={done ? 'sage' : 'ink'}
                label={done ? 'Marked as read' : 'Mark as read'}
                onPress={async () => {
                  setDone(true);
                  await save(1, pending.current?.section ?? null, true);
                  await queryClient.invalidateQueries({ queryKey: keys.topic(id) });
                  await queryClient.invalidateQueries({ queryKey: keys.topics });
                }}
              />
            </>
          }
        />
      }
    >
      {url && headings.length ? (
        <ReadingStrip
          headings={headings}
          pos={pos ?? (saved ? { fraction: saved.position, section: saved.section ?? null } : null)}
        />
      ) : null}
      {url ? (
        <DocFrame ref={frame} url={url} onMessage={onMessage} />
      ) : (
        <View style={{ padding: space.md }}>
          {renderError ? (
            <Notice
              tone="danger"
              icon="error-outline"
              title={
                renderError.offline ? 'The server is offline' : "This document couldn't be shown"
              }
              body={renderError.message}
            />
          ) : (
            <Loading label="Preparing the page" />
          )}
        </View>
      )}
      <DownloadSheet
        open={downloadOpen}
        onClose={() => setDownloadOpen(false)}
        topicId={id}
        resource={resource ?? null}
      />
      <Sheet open={outlineOpen} onClose={() => setOutlineOpen(false)} title="Outline">
        {headings
          .filter((h) => h.depth <= 3)
          .map((h) => (
            <Row
              key={h.id}
              title={h.text}
              onPress={() => {
                frame.current?.post({ type: 'studyo:goto', section: h.id, flash: true });
                setOutlineOpen(false);
              }}
              leading={
                h.depth > 2 ? (
                  <T variant="meta" tone="faint">
                    ·
                  </T>
                ) : undefined
              }
            />
          ))}
      </Sheet>
    </Screen>
  );
}

/** "Section 3 of 6 · 48% read": where you are, counted in top-level sections. */
function ReadingStrip({
  headings,
  pos,
}: {
  headings: { id: string; depth: number; text: string }[];
  pos: { fraction: number; section: string | null } | null;
}) {
  const { c } = useTheme();
  const sections = headings.filter((h) => h.depth === 2);
  let index = 0;
  if (pos?.section) {
    const at = headings.findIndex((h) => h.id === pos.section);
    for (let i = 0; i <= at; i++) {
      const h = headings[i];
      if (h?.depth === 2) index = sections.indexOf(h) + 1;
    }
  }
  const fraction = pos?.fraction ?? 0;
  return (
    <View
      style={{
        paddingHorizontal: space.md,
        paddingTop: space.sm,
        paddingBottom: space.xs,
        gap: 6,
        borderBottomWidth: 1,
        borderBottomColor: c.rule,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
        <T variant="meta" tone="lead" numberOfLines={1} style={{ flex: 1 }}>
          {sections.length
            ? `Section ${Math.max(1, index)} of ${sections.length}${index && sections[index - 1] ? ` · ${sections[index - 1]?.text}` : ''}`
            : 'Reading'}
        </T>
        <T variant="meta" tone="primary">
          {Math.round(fraction * 100)}% read
        </T>
      </View>
      <ProgressBar value={fraction} />
    </View>
  );
}
