import { useEffect, useRef } from 'react';
import { registerPushToken } from './api';
import { useApp } from './context';
import { usePanes } from './hooks';
import { hapticWarn } from './haptics';
import {
  addPushTokenListener,
  addResponseListener,
  fireAttentionAlert,
  getDeviceToken,
  pushEnv,
  requestNotificationPermission,
} from './notifications';
import { playAlert } from './sound';

// Watches the pane poll and fires a local notification when a pane newly needs
// attention (rising edge, deduped). Renders nothing. Piggybacks on the existing
// usePanes query (same key → React Query dedupes, no extra polling).
export function NotificationsController({ onOpenPane }: { onOpenPane: (paneId: string) => void }) {
  const panes = usePanes();
  const { baseUrl, prefs } = useApp();
  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  useEffect(() => {
    const sub = addResponseListener(onOpenPane);
    return () => sub.remove();
  }, [onOpenPane]);

  // Register the raw APNs token with the bridge so it can push while the app is
  // closed. Re-registers whenever the bridge URL changes or APNs rotates the token.
  useEffect(() => {
    let tokenSub: { remove(): void } | undefined;
    (async () => {
      const granted = await requestNotificationPermission();
      if (!granted || !baseUrl) return;
      const token = await getDeviceToken();
      if (token) await registerPushToken(baseUrl, token, pushEnv()).catch(() => {});
      tokenSub = addPushTokenListener((t) => {
        registerPushToken(baseUrl, t, pushEnv()).catch(() => {});
      });
    })();
    return () => tokenSub?.remove();
  }, [baseUrl]);

  useEffect(() => {
    if (!panes.data) return;
    const attn = panes.data.panes.filter((p) => p.priority != null && p.priority < 5);
    const current = new Set(attn.map((p) => p.pane_id));
    if (!primed.current) {
      // Seed on first pass so opening the app doesn't burst-notify existing state.
      primed.current = true;
      seen.current = current;
      return;
    }
    let fired = false;
    for (const p of attn) {
      if (!seen.current.has(p.pane_id)) {
        fireAttentionAlert(`⚠ ${p.project}`, p.needs_from_you || p.wait_reason || 'needs attention', p.pane_id);
        fired = true;
      }
    }
    if (fired) {
      if (prefs.soundAlerts) playAlert();
      hapticWarn();
    }
    seen.current = current;
  }, [panes.data]);

  return null;
}
