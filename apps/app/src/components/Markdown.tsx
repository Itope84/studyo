import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Linking, Text, View } from 'react-native';
import { fonts, radius, space, useTheme } from '@/theme';
import { MathText } from './MathText';
import { Icon } from './ui';

const INLINE =
  /(\*\*[^*]+\*\*|`[^`]+`|\$(?=\S)[^$\n]*?[^\s\\]\$(?!\d)|\[[^\]]+\]\([^)\s]+\)|\[S\d+[^\]]*\](?!\()|\(pack:\s*#[\w-]+\)|\*[^*\s][^*]*\*|\b_[^_\s][^_]*_\b)/g;

/** Chat text uses the apparatus face (Geist), not the reading serif. */
const body = { fontFamily: fonts.ui, fontSize: 15.5, lineHeight: 24 } as const;

/**
 * Small Markdown for chat replies: paragraphs, lists, headings, code, bold and italic, links, maths,
 * reference citations ([S3] with `[S3]: url` definitions), pack anchors `(pack: #section)`, and quoted
 * passages (`> "…" [S4]`) shown as citation cards.
 */
export function Markdown({
  text,
  topicId,
  packId,
  sources,
}: {
  text: string;
  topicId: string;
  packId?: string;
  /** Source titles by id, for citation cards. */
  sources?: Map<string, string>;
}) {
  const { c } = useTheme();
  const refs = new Map<string, string>();
  const content = text
    .split('\n')
    .filter((line) => {
      const m = /^\s*\[(S\d+[^\]]*)\]:\s*(\S+)/.exec(line);
      if (m) refs.set((m[1] as string).toUpperCase(), m[2] as string);
      return !m;
    })
    .join('\n')
    .trim();

  const open = (url: string) => void Linking.openURL(url);
  const urlFor = (label: string) => refs.get((label.split(/[,\s]/)[0] as string).toUpperCase());

  const inline = (s: string, key: string, color = c.ink): ReactNode[] => {
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
          <Text key={k} style={{ fontFamily: fonts.uiSemibold }}>
            {tok.slice(2, -2)}
          </Text>,
        );
      } else if (tok.startsWith('`')) {
        out.push(
          <Text
            key={k}
            style={{
              fontFamily: fonts.mono,
              fontSize: 13.5,
              color: c.primaryInk,
              backgroundColor: c.surface,
            }}
          >
            {tok.slice(1, -1)}
          </Text>,
        );
      } else if (tok.startsWith('$')) {
        out.push(<MathText key={k} tex={tok.slice(1, -1)} color={color} />);
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
        const url = urlFor(label);
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
          <Text key={k} style={{ fontStyle: 'italic' }}>
            {tok.slice(1, -1)}
          </Text>,
        );
      }
      last = at + tok.length;
    }
    if (last < s.length) out.push(s.slice(last));
    return out;
  };

  const blocks = content.split(/\n{2,}/);
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
              <Text
                style={{ fontFamily: fonts.mono, fontSize: 12.5, lineHeight: 18, color: c.ink }}
              >
                {code}
              </Text>
            </View>
          );
        }
        const display = /^\$\$([\s\S]+)\$\$$/.exec(block.trim());
        if (display) {
          return (
            <View
              key={key}
              style={{
                backgroundColor: c.surface,
                borderRadius: radius.base,
                paddingHorizontal: space.sm,
              }}
            >
              <MathText tex={(display[1] as string).trim()} display color={c.ink} />
            </View>
          );
        }
        const lines = block.split('\n');
        if (lines.every((l) => l.startsWith('>'))) {
          return (
            <QuoteCard
              key={key}
              raw={lines.map((l) => l.replace(/^>\s?/, '')).join(' ')}
              urlFor={urlFor}
              sources={sources}
              inline={inline}
              k={key}
            />
          );
        }
        if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) {
          return (
            <View key={key} style={{ gap: 4 }}>
              {lines.map((l, li) => {
                const bullet = /^\s*(\d+)\./.exec(l)?.[1];
                return (
                  <View key={`${key}-${li}`} style={{ flexDirection: 'row', gap: space.sm }}>
                    <Text style={[body, { color: c.lead, width: 18 }]}>
                      {bullet ? `${bullet}.` : '•'}
                    </Text>
                    <Text style={[body, { color: c.ink, flex: 1 }]}>
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
            <Text
              key={key}
              style={{ fontFamily: fonts.uiSemibold, fontSize: 16.5, lineHeight: 24, color: c.ink }}
            >
              {inline(heading[1] as string, key)}
            </Text>
          );
        }
        return (
          <Text key={key} style={[body, { color: c.ink }]}>
            {inline(block, key)}
          </Text>
        );
      })}
    </View>
  );
}

/** A quoted passage with where it comes from: `"…" [S4, §3]` becomes a card headed by the source. */
function QuoteCard({
  raw,
  urlFor,
  sources,
  inline,
  k,
}: {
  raw: string;
  urlFor: (label: string) => string | undefined;
  sources?: Map<string, string>;
  inline: (s: string, key: string, color?: string) => ReactNode[];
  k: string;
}) {
  const { c } = useTheme();
  const cite = /\s*\(?\[(S\d+)([^\]]*)\](?:\([^)]*\))?\)?\s*\.?$/.exec(raw);
  const quote = cite ? raw.slice(0, cite.index).trim() : raw.trim();
  const id = cite?.[1]?.toUpperCase();
  const where = cite?.[2]?.replace(/^[,\s]+/, '').trim();
  const url = id ? urlFor(id) : undefined;
  const title = id ? sources?.get(id) : undefined;
  return (
    <View
      style={{
        borderRadius: radius.base,
        backgroundColor: c.primarySoft,
        padding: space.sm + 4,
        gap: space.sm,
      }}
    >
      {id ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="verified" size={14} tone="primary" />
          <Text
            style={{
              flex: 1,
              fontFamily: fonts.uiSemibold,
              fontSize: 11,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              color: c.primaryInk,
            }}
            numberOfLines={2}
            onPress={url ? () => void Linking.openURL(url) : undefined}
          >
            {id}
            {where ? ` · ${where}` : ''}
            {title ? ` · ${title}` : ''}
          </Text>
          {url ? <Icon name="open-in-new" size={14} tone="primary" /> : null}
        </View>
      ) : null}
      <View
        style={{ backgroundColor: c.surfaceRaised, borderRadius: radius.sm, padding: space.sm + 4 }}
      >
        <Text
          style={{ fontFamily: fonts.contentItalic, fontSize: 17, lineHeight: 26, color: c.ink }}
        >
          {inline(quote, k)}
        </Text>
      </View>
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
