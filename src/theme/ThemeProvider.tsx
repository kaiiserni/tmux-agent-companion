import { useFonts } from 'expo-font';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getThemeName, setThemeName as persistThemeName } from '../config';
import { DEFAULT_THEME, THEMES } from './palettes';
import type { Theme } from './tokens';

interface ThemeContextValue extends Theme {
  setThemeName: (name: string) => void;
  available: string[];
}

const ThemeContext = createContext<ThemeContextValue>({
  ...THEMES[DEFAULT_THEME],
  setThemeName: () => {},
  available: Object.keys(THEMES),
});

export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [fontsLoaded] = useFonts({
    SauceCodePro: require('../../assets/fonts/SauceCodeProNerdFont-Regular.ttf'),
    'SauceCodePro-Medium': require('../../assets/fonts/SauceCodeProNerdFont-Medium.ttf'),
    'SauceCodePro-SemiBold': require('../../assets/fonts/SauceCodeProNerdFont-SemiBold.ttf'),
    'SauceCodePro-Bold': require('../../assets/fonts/SauceCodeProNerdFont-Bold.ttf'),
  });
  const [name, setName] = useState(DEFAULT_THEME);

  useEffect(() => {
    getThemeName().then((n) => {
      if (n && THEMES[n]) setName(n);
    });
  }, []);

  const theme = THEMES[name] ?? THEMES[DEFAULT_THEME];
  const value: ThemeContextValue = {
    ...theme,
    available: Object.keys(THEMES),
    setThemeName: (n) => {
      if (!THEMES[n]) return;
      setName(n);
      persistThemeName(n);
    },
  };

  if (!fontsLoaded) return null;
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
