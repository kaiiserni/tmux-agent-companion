import { FONTS, type Theme, type ThemeColors } from './tokens';

// Exact Ghostty "TokyoNight" (Night variant) palette - matches Kai's ghostty/tmux/nvim.
const tokyonight: ThemeColors = {
  bg: '#1a1b26',
  surface: '#24283b',
  surfaceAlt: '#1f2335',
  deepest: '#15161e',
  text: '#c0caf5',
  dim: '#a9b1d6',
  muted: '#7c85ad',
  border: '#414868',
  selection: '#33467c',
  attention: '#f7768e',
  running: '#9ece6a',
  waiting: '#e0af68',
  accent: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
};

// Add palettes here to extend; a picker later just switches the active key.
export const THEMES: Record<string, Theme> = {
  tokyonight: { name: 'tokyonight', colors: tokyonight, font: FONTS },
};

export const DEFAULT_THEME = 'tokyonight';
