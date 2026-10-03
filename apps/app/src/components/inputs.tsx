import { MaterialIcons } from '@expo/vector-icons';
import { forwardRef } from 'react';
import { Pressable, TextInput, type TextInputProps, type TextStyle, View } from 'react-native';
import { fonts, hit, radius, space, useTheme } from '@/theme';
import { T } from './ui';

/** Text field in the design system's cut-in box, with a theme-aware placeholder. */
export const Input = forwardRef<TextInput, TextInputProps & { area?: boolean }>(function Input(
  { area, style, ...rest },
  ref,
) {
  const { c } = useTheme();
  const base = useInputStyle(area);
  return <TextInput ref={ref} placeholderTextColor={c.faint} {...rest} style={[base, style]} />;
});

/** Crisp cut-in box; focus colour comes from the platform outline on web. */
export function useInputStyle(multiline = false): TextStyle {
  const { c } = useTheme();
  return {
    minHeight: hit.min,
    borderWidth: 1,
    borderColor: c.ruleStrong,
    borderRadius: radius.base,
    paddingHorizontal: 12,
    paddingVertical: multiline ? 10 : 0,
    color: c.ink,
    backgroundColor: c.surfaceRaised,
    fontFamily: fonts.ui,
    fontSize: 16,
    ...(multiline ? { minHeight: 96, textAlignVertical: 'top' as const } : {}),
  };
}

export function Check({
  checked,
  label,
  note,
  onToggle,
  radio,
}: {
  checked: boolean;
  label: string;
  note?: string;
  onToggle: () => void;
  radio?: boolean;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole={radio ? 'radio' : 'checkbox'}
      accessibilityState={{ checked }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm + 4,
        minHeight: hit.min,
        paddingVertical: 6,
        backgroundColor: pressed ? c.surface : 'transparent',
        borderRadius: radius.base,
      })}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: radio ? 11 : radius.sm,
          borderWidth: 1.5,
          borderColor: checked ? c.ink : c.ruleStrong,
          backgroundColor: checked ? c.ink : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? (
          <MaterialIcons
            name={radio ? 'circle' : 'check'}
            size={radio ? 10 : 16}
            color={c.canvas}
          />
        ) : null}
      </View>
      <View style={{ flex: 1 }}>
        <T variant="body">{label}</T>
        {note ? (
          <T variant="meta" tone="lead">
            {note}
          </T>
        ) : null}
      </View>
    </Pressable>
  );
}

/** Segmented choice for a few options. */
export function Segmented<V extends string>({
  value,
  options,
  onChange,
}: {
  value: V;
  options: { value: V; label: string; disabled?: boolean }[];
  onChange: (v: V) => void;
}) {
  const { c } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        borderWidth: 1,
        borderColor: c.ruleStrong,
        borderRadius: radius.base,
        overflow: 'hidden',
      }}
    >
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            disabled={o.disabled}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled: !!o.disabled }}
            style={{
              flex: 1,
              minHeight: hit.min - 4,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: space.sm,
              backgroundColor: on ? c.ink : 'transparent',
              borderLeftWidth: i ? 1 : 0,
              borderLeftColor: c.ruleStrong,
              opacity: o.disabled ? 0.4 : 1,
            }}
          >
            <T variant="label" style={{ color: on ? c.canvas : c.ink, fontFamily: fonts.uiMedium }}>
              {o.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}
