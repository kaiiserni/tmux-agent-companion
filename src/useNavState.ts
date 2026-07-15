import type { NavigationState } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { storageGet, storageSet } from './storage';

const NAV_KEY = 'navState';
// A stale route (e.g. a pane that's gone) shouldn't be restored days later.
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

// Restores the screen you were on when iOS killed the backgrounded app. Keeping
// NavigationContainer mounted covers a plain minimize/restore; this covers the
// case where the process was actually terminated in between.
export function useNavState() {
  const [ready, setReady] = useState(false);
  const [initialState, setInitialState] = useState<NavigationState | undefined>();

  useEffect(() => {
    storageGet(NAV_KEY)
      .then((raw) => {
        if (!raw) return;
        const saved = JSON.parse(raw) as { at: number; state: NavigationState };
        if (Date.now() - saved.at < MAX_AGE_MS) setInitialState(saved.state);
      })
      .catch(() => {
        /* corrupt entry - start fresh */
      })
      .finally(() => setReady(true));
  }, []);

  const onStateChange = useCallback((state: NavigationState | undefined) => {
    if (state) storageSet(NAV_KEY, JSON.stringify({ at: Date.now(), state }));
  }, []);

  return { ready, initialState, onStateChange };
}
