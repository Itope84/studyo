import { type Palette, tokens } from '@studyo/renderer/tokens';
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { usePrefs } from '@/lib/prefs';

export type Scheme = 'light' | 'dark';

export const fonts = {
  content: 'Newsreader_400Regular',
  contentItalic: 'Newsreader_400Regular_Italic',
  contentMedium: 'Newsreader_500Medium',
  contentSemibold: 'Newsreader_600SemiBold',
  ui: 'Geist_400Regular',
  uiMedium: 'Geist_500Medium',
  uiSemibold: 'Geist_600SemiBold',
  mono: 'GeistMono_400Regular',
} as const;

/** Type scale from the design system: Newsreader for content, Geist for apparatus. */
export const type = {
  display: { fontFamily: fonts.content, fontSize: 32, lineHeight: 38, letterSpacing: -0.3 },
  headline: { fontFamily: fonts.content, fontSize: 26, lineHeight: 32, letterSpacing: -0.2 },
  title: { fontFamily: fonts.contentMedium, fontSize: 21, lineHeight: 27 },
  rowTitle: { fontFamily: fonts.contentMedium, fontSize: 18, lineHeight: 24 },
  body: { fontFamily: fonts.content, fontSize: 17, lineHeight: 26 },
  bodySmall: { fontFamily: fonts.content, fontSize: 15, lineHeight: 22 },
  label: { fontFamily: fonts.uiMedium, fontSize: 14, lineHeight: 20, letterSpacing: 0.1 },
  meta: { fontFamily: fonts.uiMedium, fontSize: 12, lineHeight: 16, letterSpacing: 0.2 },
  caps: {
    fontFamily: fonts.uiSemibold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.6,
    textTransform: 'uppercase' as const,
  },
  mono: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 17 },
} as const;

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 40 } as const;
export const radius = tokens.radius;
/** Minimum touch target, and the larger one for transport controls. */
export const hit = { min: 48, big: 56 } as const;
export const MAX_WIDTH = 720;
export const DOCK_HEIGHT = 68;

interface Theme {
  scheme: Scheme;
  c: Palette;
}

const ThemeContext = createContext<Theme>({ scheme: 'light', c: tokens.light });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const pref = usePrefs((s) => s.theme);
  const scheme: Scheme = pref === 'system' ? (system === 'dark' ? 'dark' : 'light') : pref;
  const value = useMemo(() => ({ scheme, c: tokens[scheme] }), [scheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
