import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  type StyleProp,
  StyleSheet,
  Text,
  type TextProps,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '@/lib/player';
import { DOCK_HEIGHT, fonts, hit, MAX_WIDTH, radius, space, type, useTheme } from '@/theme';

export type IconName = ComponentProps<typeof MaterialIcons>['name'];

type Variant = keyof typeof type;
type Tone = 'ink' | 'lead' | 'faint' | 'primary' | 'sage' | 'amber' | 'danger' | 'onPrimary';

export function T({
  variant = 'body',
  tone = 'ink',
  style,
  ...rest
}: TextProps & { variant?: Variant; tone?: Tone; style?: StyleProp<TextStyle> }) {
  const { c } = useTheme();
  const color = {
    ink: c.ink,
    lead: c.lead,
    faint: c.faint,
    primary: c.primaryInk,
    sage: c.sage,
    amber: c.amber,
    danger: c.danger,
    onPrimary: c.onPrimary,
  }[tone];
  return <Text {...rest} style={[type[variant], { color }, style]} />;
}

export function Icon({
  name,
  size = 22,
  color,
  tone,
}: {
  name: IconName;
  size?: number;
  color?: string;
  tone?: Tone;
}) {
  const { c } = useTheme();
  const tones: Record<Tone, string> = {
    ink: c.ink,
    lead: c.lead,
    faint: c.faint,
    primary: c.primary,
    sage: c.sage,
    amber: c.amber,
    danger: c.danger,
    onPrimary: c.onPrimary,
  };
  return <MaterialIcons name={name} size={size} color={color ?? tones[tone ?? 'ink']} />;
}

/** Page scaffold: safe areas, a centred reading column, and room for the mini player. */
export function Screen({
  children,
  header,
  scroll = true,
  footer,
  contentStyle,
  wide = false,
}: {
  children: ReactNode;
  header?: ReactNode;
  scroll?: boolean;
  footer?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  wide?: boolean;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const hasDock = usePlayer((s) => !!s.track);
  const bottom = (hasDock ? DOCK_HEIGHT + space.md : 0) + insets.bottom + space.lg;
  const column: ViewStyle = {
    width: '100%',
    maxWidth: wide ? 1080 : MAX_WIDTH,
    alignSelf: 'center',
  };
  return (
    <View style={{ flex: 1, backgroundColor: c.canvas, paddingTop: insets.top }}>
      {header ? <View style={column}>{header}</View> : null}
      {scroll ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[
            column,
            { paddingHorizontal: space.md, paddingBottom: bottom },
            contentStyle,
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, column, contentStyle]}>{children}</View>
      )}
      {footer ? (
        <View style={[column, { paddingBottom: hasDock ? DOCK_HEIGHT : insets.bottom }]}>
          {footer}
        </View>
      ) : null}
    </View>
  );
}

export function Header({
  title,
  back = true,
  right,
  subtitle,
}: {
  title?: string;
  back?: boolean;
  right?: ReactNode;
  subtitle?: string;
}) {
  const { c } = useTheme();
  return (
    <View style={[styles.header, { borderBottomColor: c.rule }]}>
      {back ? (
        <IconButton
          name="arrow-back"
          label="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        />
      ) : null}
      <View style={{ flex: 1, paddingHorizontal: back ? space.xs : space.md }}>
        {title ? (
          <T variant="label" numberOfLines={1} style={{ fontFamily: fonts.uiSemibold }}>
            {title}
          </T>
        ) : null}
        {subtitle ? (
          <T variant="meta" tone="lead" numberOfLines={1}>
            {subtitle}
          </T>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>{right}</View>
    </View>
  );
}

export function IconButton({
  name,
  label,
  onPress,
  size = hit.min,
  tone = 'ink',
  disabled,
  filled,
  badge,
}: {
  name: IconName;
  label: string;
  onPress?: () => void;
  size?: number;
  tone?: Tone;
  disabled?: boolean;
  filled?: boolean;
  badge?: number;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.4 : 1,
          backgroundColor: filled ? c.primary : pressed ? c.surface : 'transparent',
          transform: [{ scale: pressed ? 0.96 : 1 }],
        },
      ]}
    >
      <Icon name={name} size={size >= hit.big ? 30 : 22} tone={filled ? 'onPrimary' : tone} />
      {badge ? (
        <View style={[styles.badge, { backgroundColor: c.primary }]}>
          <Text style={{ color: c.onPrimary, fontFamily: fonts.uiSemibold, fontSize: 10 }}>
            {badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  icon,
  disabled,
  busy,
  style,
  hint,
}: {
  label: string;
  onPress?: () => void;
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: IconName;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Why the button is disabled, shown under it. */
  hint?: string | null;
}) {
  const { c } = useTheme();
  const bg = {
    primary: c.primary,
    secondary: 'transparent',
    ghost: 'transparent',
    danger: 'transparent',
  }[kind];
  const fg = { primary: c.onPrimary, secondary: c.ink, ghost: c.primaryInk, danger: c.danger }[
    kind
  ];
  const border = kind === 'secondary' ? c.ruleStrong : kind === 'danger' ? c.danger : 'transparent';
  return (
    <View style={style}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !!disabled, busy: !!busy }}
        onPress={onPress}
        disabled={disabled || busy}
        style={({ pressed }) => ({
          minHeight: hit.min,
          paddingHorizontal: kind === 'ghost' ? space.sm : space.md,
          borderRadius: radius.base,
          backgroundColor: bg,
          borderWidth: kind === 'secondary' || kind === 'danger' ? 1 : 0,
          borderColor: border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.sm,
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        })}
      >
        {busy ? (
          <ActivityIndicator color={fg} size="small" />
        ) : icon ? (
          <MaterialIcons name={icon} size={20} color={fg} />
        ) : null}
        <Text style={[type.label, { color: fg, fontFamily: fonts.uiSemibold }]}>{label}</Text>
      </Pressable>
      {hint ? (
        <T variant="meta" tone="lead" style={{ marginTop: 6, textAlign: 'center' }}>
          {hint}
        </T>
      ) : null}
    </View>
  );
}

export type BadgeKind =
  | 'ready'
  | 'enriching'
  | 'waiting'
  | 'failed'
  | 'offline'
  | 'downloaded'
  | 'neutral'
  | 'captured';

/** A status marker with a plain-word label: the design rule "states are always visible". */
export function Badge({ kind, label }: { kind: BadgeKind; label: string }) {
  const { c } = useTheme();
  const map: Record<BadgeKind, { bg: string; fg: string; icon: IconName }> = {
    ready: { bg: c.sageSoft, fg: c.sage, icon: 'check' },
    downloaded: { bg: c.sageSoft, fg: c.sage, icon: 'offline-pin' },
    enriching: { bg: c.amberSoft, fg: c.amber, icon: 'autorenew' },
    waiting: { bg: c.primarySoft, fg: c.primaryInk, icon: 'help-outline' },
    failed: { bg: c.dangerSoft, fg: c.danger, icon: 'error-outline' },
    offline: { bg: c.surface, fg: c.lead, icon: 'cloud-off' },
    captured: { bg: c.surface, fg: c.lead, icon: 'inventory-2' },
    neutral: { bg: c.surface, fg: c.lead, icon: 'circle' },
  };
  const m = map[kind];
  return (
    <View style={[styles.pill, { backgroundColor: m.bg }]}>
      <MaterialIcons name={m.icon} size={12} color={m.fg} />
      <Text style={[type.meta, { color: m.fg, fontFamily: fonts.uiSemibold }]}>{label}</Text>
    </View>
  );
}

export function Row({
  title,
  subtitle,
  meta,
  leading,
  trailing,
  onPress,
  active,
  disabled,
  disabledReason,
  accessibilityLabel,
}: {
  title: string;
  subtitle?: ReactNode;
  meta?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  active?: boolean;
  disabled?: boolean;
  disabledReason?: string | null;
  accessibilityLabel?: string;
}) {
  const { c } = useTheme();
  // The trailing control sits outside the pressable area: nested buttons are invalid on the web.
  return (
    <View
      style={[
        styles.row,
        {
          borderBottomColor: c.rule,
          backgroundColor: active ? c.tint : 'transparent',
          borderLeftColor: active ? c.primary : 'transparent',
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Pressable
        onPress={onPress}
        disabled={!onPress || disabled}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [
          styles.rowMain,
          { backgroundColor: pressed && !active ? c.surface : 'transparent' },
        ]}
      >
        {leading ? <View style={styles.rowLead}>{leading}</View> : null}
        <View style={{ flex: 1, gap: 3 }}>
          <T variant="rowTitle" numberOfLines={2}>
            {title}
          </T>
          {typeof subtitle === 'string' ? (
            <T variant="meta" tone="lead" numberOfLines={2}>
              {subtitle}
            </T>
          ) : (
            subtitle
          )}
          {disabled && disabledReason ? (
            <T variant="meta" tone="faint">
              {disabledReason}
            </T>
          ) : null}
        </View>
        {meta ? <View style={{ alignItems: 'flex-end', gap: 4 }}>{meta}</View> : null}
      </Pressable>
      {trailing}
    </View>
  );
}

export function SectionTitle({ children, right }: { children: string; right?: ReactNode }) {
  return (
    <View style={styles.section}>
      <T variant="caps" tone="lead">
        {children}
      </T>
      {right}
    </View>
  );
}

export function Notice({
  tone = 'neutral',
  icon,
  title,
  body,
  action,
}: {
  tone?: 'neutral' | 'warning' | 'danger' | 'info';
  icon?: IconName;
  title: string;
  body?: string | null;
  action?: ReactNode;
}) {
  const { c } = useTheme();
  const bg = {
    neutral: c.surface,
    warning: c.amberSoft,
    danger: c.dangerSoft,
    info: c.primarySoft,
  }[tone];
  const fg = { neutral: c.lead, warning: c.amber, danger: c.danger, info: c.primaryInk }[tone];
  return (
    <View style={[styles.notice, { backgroundColor: bg }]}>
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
        {icon ? <MaterialIcons name={icon} size={18} color={fg} style={{ marginTop: 1 }} /> : null}
        <View style={{ flex: 1, gap: 2 }}>
          <T variant="label" style={{ color: fg, fontFamily: fonts.uiSemibold }}>
            {title}
          </T>
          {body ? (
            <T variant="meta" tone="lead">
              {body}
            </T>
          ) : null}
        </View>
      </View>
      {action ? <View style={{ marginTop: space.sm }}>{action}</View> : null}
    </View>
  );
}

export function Empty({
  icon,
  title,
  body,
  action,
}: {
  icon: IconName;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <View
      style={{
        alignItems: 'center',
        paddingVertical: space.xl,
        paddingHorizontal: space.lg,
        gap: space.sm,
      }}
    >
      <Icon name={icon} size={32} tone="faint" />
      <T variant="title" style={{ textAlign: 'center' }}>
        {title}
      </T>
      {body ? (
        <T variant="bodySmall" tone="lead" style={{ textAlign: 'center', maxWidth: 420 }}>
          {body}
        </T>
      ) : null}
      {action ? <View style={{ marginTop: space.md }}>{action}</View> : null}
    </View>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ paddingVertical: space.xl, alignItems: 'center', gap: space.sm }}>
      <ActivityIndicator color={c.lead} />
      <T variant="meta" tone="lead">
        {label}
      </T>
    </View>
  );
}

export function ProgressBar({ value, height = 2 }: { value: number; height?: number }) {
  const { c } = useTheme();
  return (
    <View style={{ height, backgroundColor: c.rule, borderRadius: height, overflow: 'hidden' }}>
      <View
        style={{
          width: `${Math.max(0, Math.min(1, value)) * 100}%`,
          height,
          backgroundColor: c.primary,
        }}
      />
    </View>
  );
}

export function Divider() {
  const { c } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.rule }} />;
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <View style={{ gap: 6, marginBottom: space.md }}>
      <T variant="caps" tone="lead">
        {label}
      </T>
      {children}
      {hint ? (
        <T variant="meta" tone="faint">
          {hint}
        </T>
      ) : null}
    </View>
  );
}

export const formatTime = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
};

export const formatBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
};

export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

const styles = StyleSheet.create({
  header: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  badge: {
    position: 'absolute',
    top: 6,
    right: 6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3,
    minHeight: 64,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: 14,
    paddingLeft: space.sm,
    paddingRight: space.xs,
    minHeight: 64,
  },
  rowLead: { width: 28, alignItems: 'center' },
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.lg,
    marginBottom: space.xs,
    minHeight: 32,
  },
  notice: { borderRadius: radius.base, padding: space.md, marginVertical: space.sm },
});
