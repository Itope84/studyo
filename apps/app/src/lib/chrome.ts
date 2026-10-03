import { usePathname } from 'expo-router';
import { usePlayer } from './player';

/** The four top-level places, reached from the bottom tab bar. */
export const TABS = ['/', '/inbox', '/activity', '/settings'] as const;

/** Which persistent chrome the current screen has: the tab bar, and the mini player dock above it. */
export function useChrome() {
  const path = usePathname();
  const tabs = (TABS as readonly string[]).includes(path);
  const dock = usePlayer((s) => !!s.track) && path !== '/player';
  return { tabs, dock };
}
