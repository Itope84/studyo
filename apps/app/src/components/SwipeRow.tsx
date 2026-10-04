import { type ReactNode, useRef, useState } from 'react';
import { Animated, PanResponder, Platform, View } from 'react-native';
import { IconButton, type IconName } from '@/components/ui';
import { hit, useTheme } from '@/theme';

export interface SwipeAction {
  icon: IconName;
  label: string;
  onPress: () => void;
  tone?: 'ink' | 'danger';
  disabled?: boolean;
}

const ACTION_WIDTH = hit.min + 8;

/**
 * A row that slides left to show icon actions behind it. Drag with a finger or a mouse; on web a small
 * toggle button does the same, since dragging is awkward with a pointer and there is no other way in.
 */
export function SwipeRow({
  children,
  actions,
  name,
}: {
  children: ReactNode;
  actions: SwipeAction[];
  /** What the row is, so the toggle can say whose actions it shows. */
  name: string;
}) {
  const { c } = useTheme();
  const reveal = ACTION_WIDTH * actions.length;
  const x = useRef(new Animated.Value(0)).current;
  const open = useRef(false);
  const [isOpen, setOpen] = useState(false);

  const settle = (to: 'open' | 'closed') => {
    open.current = to === 'open';
    setOpen(open.current);
    Animated.spring(x, {
      toValue: to === 'open' ? -reveal : 0,
      useNativeDriver: Platform.OS !== 'web',
      bounciness: 0,
    }).start();
  };

  const pan = useRef(
    PanResponder.create({
      // Only a mostly-horizontal drag takes over, so the page still scrolls.
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_, g) => {
        const start = open.current ? -reveal : 0;
        x.setValue(Math.max(-reveal, Math.min(0, start + g.dx)));
      },
      onPanResponderRelease: (_, g) => {
        const start = open.current ? -reveal : 0;
        const at = start + g.dx;
        settle(at < -reveal / 2 ? 'open' : 'closed');
      },
      onPanResponderTerminate: () => settle(open.current ? 'open' : 'closed'),
    }),
  ).current;

  return (
    <View style={{ overflow: 'hidden' }}>
      <View
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          right: 0,
          width: reveal,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: c.surface,
        }}
      >
        {actions.map((a) => (
          <IconButton
            key={a.label}
            name={a.icon}
            label={a.label}
            tone={a.tone}
            disabled={a.disabled}
            onPress={() => {
              settle('closed');
              a.onPress();
            }}
          />
        ))}
      </View>
      <Animated.View
        style={{ transform: [{ translateX: x }], backgroundColor: c.canvas }}
        {...pan.panHandlers}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
          {Platform.OS === 'web' ? (
            <IconButton
              name={isOpen ? 'chevron-right' : 'more-horiz'}
              label={isOpen ? `Hide actions for ${name}` : `Show actions for ${name}`}
              onPress={() => settle(isOpen ? 'closed' : 'open')}
            />
          ) : null}
        </View>
      </Animated.View>
    </View>
  );
}
