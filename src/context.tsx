import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { storageGet, storageSet } from './storage';

export interface Prefs {
  privacyMode: boolean;
  technicalNames: boolean;
  sortByActivity: boolean;
  respondedNewestFirst: boolean;
  soundAlerts: boolean;
  showSystemStats: boolean;
  showClaudeUsage: boolean;
  faceIdLock: boolean;
}

const DEFAULT_PREFS: Prefs = {
  privacyMode: false,
  technicalNames: false,
  sortByActivity: true,
  respondedNewestFirst: true,
  soundAlerts: true,
  showSystemStats: true,
  showClaudeUsage: true,
  // Agent conversations mix work across different clients - lock by default.
  faceIdLock: true,
};

interface AppContextValue {
  baseUrl: string;
  setBaseUrl: (u: string) => void;
  prefs: Prefs;
  togglePref: (key: keyof Prefs) => void;
}

const AppContext = createContext<AppContextValue>({
  baseUrl: '',
  setBaseUrl: () => {},
  prefs: DEFAULT_PREFS,
  togglePref: () => {},
});

export const useApp = () => useContext(AppContext);

const PREFS_KEY = 'appPrefs';

export function AppProvider({
  baseUrl,
  setBaseUrl,
  children,
}: {
  baseUrl: string;
  setBaseUrl: (u: string) => void;
  children: ReactNode;
}) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);

  useEffect(() => {
    storageGet(PREFS_KEY).then((raw) => {
      if (raw) {
        try {
          setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(raw) });
        } catch {
          /* keep defaults */
        }
      }
    });
  }, []);

  const togglePref = (key: keyof Prefs) => {
    setPrefs((p) => {
      const next = { ...p, [key]: !p[key] };
      storageSet(PREFS_KEY, JSON.stringify(next));
      return next;
    });
  };

  return (
    <AppContext.Provider value={{ baseUrl, setBaseUrl, prefs, togglePref }}>
      {children}
    </AppContext.Provider>
  );
}

// Redact free text when privacy mode is on (mirror dashboard `p`).
export function redact(text: string, on: boolean): string {
  if (!on || !text) return text;
  return text.replace(/[^\s]/g, '•');
}
