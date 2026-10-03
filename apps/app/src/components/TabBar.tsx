import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useActiveJobs, useTopics } from '@/lib/hooks';
import { fonts, MAX_WIDTH, TAB_HEIGHT, useTheme } from '@/theme';
import { Icon, type IconName } from './ui';

const ITEMS: { path: string; label: string; icon: IconName }[] = [
  { path: '/', label: 'Library', icon: 'local-library' },
  { path: '/inbox', label: 'Inbox', icon: 'move-to-inbox' },
  { path: '/activity', label: 'Activity', icon: 'timeline' },
  { path: '/settings', label: 'Settings', icon: 'settings' },
];

/** Bottom navigation on the four top-level screens. */
export function TabBar() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const path = usePathname();
  const topics = useTopics();
  const jobs = useActiveJobs();
  const badges: Record<string, number> = {
    '/inbox': topics.data?.inbox_count ?? 0,
    '/activity': (jobs.data?.jobs ?? []).filter((j) => j.status === 'needs_input').length,
  };
  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: c.canvas, borderTopColor: c.rule, paddingBottom: insets.bottom },
      ]}
    >
      <View style={styles.row} accessibilityRole="tablist">
        {ITEMS.map((item) => {
          const on = path === item.path;
          const badge = badges[item.path] ?? 0;
          return (
            <Pressable
              key={item.path}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={badge ? `${item.label}, ${badge} waiting` : item.label}
              onPress={() => {
                if (!on) router.replace(item.path as never);
              }}
              style={({ pressed }) => [styles.tab, { opacity: pressed ? 0.7 : 1 }]}
            >
              <View>
                <Icon name={item.icon} size={24} tone={on ? 'primary' : 'lead'} />
                {badge ? (
                  <View
                    style={[styles.badge, { backgroundColor: c.primary, borderColor: c.canvas }]}
                  >
                    <Text
                      style={{ color: c.onPrimary, fontFamily: fonts.uiSemibold, fontSize: 10 }}
                    >
                      {badge}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text
                style={{
                  fontFamily: on ? fonts.uiSemibold : fonts.uiMedium,
                  fontSize: 11,
                  color: on ? c.primaryInk : c.lead,
                }}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  row: { flexDirection: 'row', width: '100%', maxWidth: MAX_WIDTH, height: TAB_HEIGHT },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  badge: {
    position: 'absolute',
    top: -4,
    right: -10,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    borderWidth: 2,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
