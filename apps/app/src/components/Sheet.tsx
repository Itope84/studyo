import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MAX_WIDTH, radius, space, useTheme } from '@/theme';
import { IconButton, T } from './ui';

/** Bottom sheet over a matte scrim, with a crisp top edge. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: c.scrim }}
          onPress={onClose}
          accessibilityLabel="Close"
        />
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: 'center',
            maxHeight: '88%',
            // Lets the card shrink to this height, so a long list scrolls inside it.
            flexDirection: 'column',
          }}
        >
          <View
            style={{
              width: '100%',
              maxWidth: MAX_WIDTH,
              flexShrink: 1,
              backgroundColor: c.canvas,
              borderTopLeftRadius: radius.lg,
              borderTopRightRadius: radius.lg,
              borderTopWidth: 1,
              borderColor: c.ruleStrong,
              paddingBottom: insets.bottom + space.md,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingLeft: space.md,
                paddingRight: space.xs,
                paddingTop: space.xs,
              }}
            >
              <T variant="title" style={{ flex: 1 }}>
                {title}
              </T>
              <IconButton name="close" label="Close" onPress={onClose} />
            </View>
            <ScrollView
              style={{ flexGrow: 0, flexShrink: 1 }}
              contentContainerStyle={{ paddingHorizontal: space.md, paddingBottom: space.sm }}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
            {footer ? (
              <View style={{ paddingHorizontal: space.md, paddingTop: space.sm }}>{footer}</View>
            ) : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
