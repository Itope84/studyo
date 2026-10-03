/**
 * Monograph & Signal design tokens. One source for the renderer's HTML and the app's theme.
 * Light is warm paper and ink; dark is the cockpit mode for night reading and driving.
 */
export const tokens = {
  light: {
    canvas: '#FBFBFA',
    surface: '#F3F2EE',
    surfaceRaised: '#FFFFFF',
    tint: '#F6F4EE',
    rule: '#E5E4DE',
    ruleStrong: '#D6D4CC',
    ink: '#1E1E1C',
    lead: '#6F6E69',
    faint: '#9A988F',
    primary: '#C85A32',
    primaryInk: '#9F3C16',
    onPrimary: '#FFFFFF',
    primarySoft: 'rgba(200, 90, 50, 0.10)',
    sage: '#4A6B5B',
    sageSoft: 'rgba(74, 107, 91, 0.12)',
    amber: '#A36717',
    amberSoft: 'rgba(210, 142, 61, 0.14)',
    danger: '#B83A3A',
    dangerSoft: 'rgba(184, 58, 58, 0.10)',
    scrim: 'rgba(22, 22, 20, 0.48)',
  },
  dark: {
    canvas: '#161614',
    surface: '#22221F',
    surfaceRaised: '#2A2A26',
    tint: '#1F1D1A',
    rule: '#2D2D29',
    ruleStrong: '#3A3A35',
    ink: '#ECEAE4',
    lead: '#A3A19A',
    faint: '#77756E',
    primary: '#E07A52',
    primaryInk: '#F09A76',
    onPrimary: '#1A0E08',
    primarySoft: 'rgba(224, 122, 82, 0.14)',
    sage: '#8DB5A1',
    sageSoft: 'rgba(141, 181, 161, 0.14)',
    amber: '#E0A75E',
    amberSoft: 'rgba(224, 167, 94, 0.14)',
    danger: '#E07070',
    dangerSoft: 'rgba(224, 112, 112, 0.14)',
    scrim: 'rgba(0, 0, 0, 0.6)',
  },
  font: {
    content: "'Newsreader', 'Iowan Old Style', 'Georgia', serif",
    apparatus: "'Geist', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
    mono: "'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace",
  },
  radius: { sm: 2, base: 4, md: 6, lg: 8, full: 9999 },
} as const;

export type ThemeName = 'light' | 'dark';
export type Palette = { [K in keyof typeof tokens.light]: string };

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** CSS custom properties for a palette, for example `--canvas: #FBFBFA;`. */
export function cssVars(palette: Palette): string {
  return Object.entries(palette)
    .map(([k, v]) => `--${kebab(k)}: ${v};`)
    .join(' ');
}

export const GOOGLE_FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=Geist:wght@400;500;600&family=Geist+Mono:wght@400&display=swap';
