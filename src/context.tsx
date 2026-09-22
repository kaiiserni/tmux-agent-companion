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
  autoSpeak: boolean;
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
  // Default for a conversation's read-aloud toggle; TTS costs money per reply.
  autoSpeak: false,
};

interface AppContextValue {
  baseUrl: string;
  setBaseUrl: (u: string) => void;
  prefs: Prefs;
  togglePref: (key: keyof Prefs) => void;
  autoSpeakOn: (paneId: string) => boolean;
  toggleAutoSpeak: (paneId: string) => void;
}

const AppContext = createContext<AppContextValue>({
  baseUrl: '',
  setBaseUrl: () => {},
  prefs: DEFAULT_PREFS,
  togglePref: () => {},
  autoSpeakOn: () => false,
  toggleAutoSpeak: () => {},
});

export const useApp = () => useContext(AppContext);

const PREFS_KEY = 'appPrefs';
const AUTO_SPEAK_KEY = 'autoSpeakPanes';

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
  // Read-aloud is per conversation; only panes that differ from the default are stored.
  const [autoSpeakPanes, setAutoSpeakPanes] = useState<Record<string, boolean>>({});

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
    storageGet(AUTO_SPEAK_KEY).then((raw) => {
      if (raw) {
        try {
          setAutoSpeakPanes(JSON.parse(raw));
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

  const autoSpeakOn = (paneId: string) => autoSpeakPanes[paneId] ?? prefs.autoSpeak;

  const toggleAutoSpeak = (paneId: string) => {
    setAutoSpeakPanes((m) => {
      const next = { ...m, [paneId]: !(m[paneId] ?? prefs.autoSpeak) };
      storageSet(AUTO_SPEAK_KEY, JSON.stringify(next));
      return next;
    });
  };

  return (
    <AppContext.Provider value={{ baseUrl, setBaseUrl, prefs, togglePref, autoSpeakOn, toggleAutoSpeak }}>
      {children}
    </AppContext.Provider>
  );
}

// Redact free text when privacy mode is on (mirror dashboard `p`).
export function redact(text: string, on: boolean): string {
  if (!on || !text) return text;
  return text.replace(/[^\s]/g, '•');
}
