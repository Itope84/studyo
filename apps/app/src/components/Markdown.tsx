import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Linking, Text, View } from 'react-native';
import { fonts, radius, space, type, useTheme } from '@/theme';

const INLINE =
  /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\[S\d+[^\]]*\](?!\()|\(pack:\s*#[\w-]+\)|\*[^*\s][^*]*\*|\b_[^_\s][^_]*_\b)/g;

/**
 * Small Markdown for chat replies: paragraphs, lists, headings, code, bold and italic, links,
 * reference citations ([S3] with `[S3]: url` definitions) and pack anchors `(pack: #section)`.
 */
export function Markdown({
  text,
  topicId,
  packId,
}: {
  text: string;
  topicId: string;
  packId?: string;
}) {
  const { c } = useTheme();
  const refs = new Map<string, string>();
  const body = text
    .split('\n')
    .filter((line) => {
      const m = /^\s*\[(S\d+[^\]]*)\]:\s*(\S+)/.exec(line);
      if (m) refs.set((m[1] as string).toUpperCase(), m[2] as string);
      return !m;
    })
    .join('\n')
    .trim();

  const open = (url: string) => void Linking.openURL(url);

  const inline = (s: string, key: string): ReactNode[] => {
    const out: ReactNode[] = [];
    let last = 0;
    let i = 0;
    for (const m of s.matchAll(INLINE)) {
      const tok = m[0];
      const at = m.index ?? 0;
      if (at > last) out.push(s.slice(last, at));
      const k = `${key}-${i++}`;
      if (tok.startsWith('**')) {
        out.push(
          <Text key={k} style={{ fontFamily: fonts.contentSemibold }}>
            {tok.slice(2, -2)}
          </Text>,
        );
      } else if (tok.startsWith('`')) {
        out.push(
          <Text
            key={k}
            style={{ fontFamily: fonts.mono, fontSize: 14, backgroundColor: c.surface }}
          >
            {tok.slice(1, -1)}
          </Text>,
        );
      } else if (tok.startsWith('(pack:')) {
        const section = tok.replace(/^\(pack:\s*#/, '').replace(/\)$/, '');
        out.push(
          <Text
            key={k}
            style={{ fontFamily: fonts.uiMedium, fontSize: 13, color: c.primaryInk }}
            onPress={
              packId
                ? () => router.push(`/topic/${topicId}/read/${packId}?section=${section}`)
                : undefined
            }
            accessibilityRole="link"
          >
            {' '}
            ↗ in the pack
          </Text>,
        );
      } else if (/^\[S\d+/.test(tok)) {
        const label = tok.slice(1, -1);
        const url = refs.get((label.split(/[,\s]/)[0] as string).toUpperCase());
        out.push(<Cite key={k} label={label} onPress={url ? () => open(url) : undefined} />);
      } else if (tok.startsWith('[')) {
        const m2 = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
        const label = m2?.[1] ?? tok;
        const url = m2?.[2] ?? '';
        if (/^S\d+/.test(label)) out.push(<Cite key={k} label={label} onPress={() => open(url)} />);
        else
          out.push(
            <Text
              key={k}
              style={{ color: c.primaryInk, textDecorationLine: 'underline' }}
              onPress={() => open(url)}
              accessibilityRole="link"
            >
              {label}
            </Text>,
          );
      } else {
        out.push(
          <Text key={k} style={{ fontFamily: fonts.contentItalic }}>
            {tok.slice(1, -1)}
          </Text>,
        );
      }
      last = at + tok.length;
    }
    if (last < s.length) out.push(s.slice(last));
    return out;
  };

  const blocks = body.split(/\n{2,}/);
  return (
    <View style={{ gap: space.sm + 2 }}>
      {blocks.map((block, bi) => {
        const key = `b${bi}`;
        if (block.startsWith('```')) {
          const code = block.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
          return (
            <View
              key={key}
              style={{ backgroundColor: c.surface, borderRadius: radius.base, padding: space.sm }}
            >
              <Text style={[type.mono, { color: c.ink }]}>{code}</Text>
            </View>
          );
        }
        const lines = block.split('\n');
        if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) {
          return (
            <View key={key} style={{ gap: 4 }}>
              {lines.map((l, li) => {
                const bullet = /^\s*(\d+)\./.exec(l)?.[1];
                return (
                  <View key={`${key}-${li}`} style={{ flexDirection: 'row', gap: space.sm }}>
                    <Text style={[type.body, { color: c.lead, width: 18 }]}>
                      {bullet ? `${bullet}.` : '•'}
                    </Text>
                    <Text style={[type.body, { color: c.ink, flex: 1 }]}>
                      {inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ''), `${key}-${li}`)}
                    </Text>
                  </View>
                );
              })}
            </View>
          );
        }
        const heading = /^#{1,4}\s+(.*)$/.exec(block);
        if (heading) {
          return (
            <Text key={key} style={[type.title, { color: c.ink }]}>
              {inline(heading[1] as string, key)}
            </Text>
          );
        }
        if (block.startsWith('>')) {
          return (
            <View
              key={key}
              style={{ borderLeftWidth: 2, borderLeftColor: c.ruleStrong, paddingLeft: space.sm }}
            >
              <Text style={[type.body, { color: c.lead, fontFamily: fonts.contentItalic }]}>
                {inline(block.replace(/^>\s?/gm, ''), key)}
              </Text>
            </View>
          );
        }
        return (
          <Text key={key} style={[type.body, { color: c.ink }]}>
            {inline(block, key)}
          </Text>
        );
      })}
    </View>
  );
}

function Cite({ label, onPress }: { label: string; onPress?: () => void }) {
  const { c } = useTheme();
  return (
    <Text
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`Source ${label}`}
      style={{
        fontFamily: fonts.uiMedium,
        fontSize: 12,
        color: c.sage,
        backgroundColor: c.sageSoft,
      }}
    >
      {` ${label} `}
    </Text>
  );
}
