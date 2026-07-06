export interface ThemeColors {
  bg: string;
  surface: string;
  surfaceAlt: string;
  deepest: string;
  text: string;
  dim: string;
  muted: string;
  border: string;
  selection: string;
  attention: string; // red
  running: string; // green
  waiting: string; // yellow
  accent: string; // blue
  magenta: string;
  cyan: string;
}

// expo-font family keys registered in ThemeProvider.
export const FONTS = {
  regular: 'SauceCodePro',
  medium: 'SauceCodePro-Medium',
  semibold: 'SauceCodePro-SemiBold',
  bold: 'SauceCodePro-Bold',
} as const;

export type FontTokens = typeof FONTS;

export interface Theme {
  name: string;
  colors: ThemeColors;
  font: FontTokens;
}
