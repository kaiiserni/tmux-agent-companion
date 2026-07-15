import * as LocalAuthentication from 'expo-local-authentication';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

// Face ID / Touch ID gate: locked on cold start and whenever the app returns
// from background, so agent data isn't left visible on an unlocked phone.
export function useAppLock(enabled: boolean) {
  const [available, setAvailable] = useState(false);
  const [locked, setLocked] = useState(enabled);
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()]).then(
      ([hw, enrolled]) => setAvailable(hw && enrolled),
    );
  }, []);

  useEffect(() => {
    if (!enabled) setLocked(false);
  }, [enabled]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (enabled && appState.current === 'active' && next.match(/inactive|background/)) {
        setLocked(true);
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [enabled]);

  const authenticate = useCallback(async () => {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock the agent dashboard',
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    });
    if (res.success) setLocked(false);
    return res.success;
  }, []);

  return { locked: enabled && available && locked, available, authenticate };
}
