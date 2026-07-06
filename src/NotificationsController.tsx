import { useEffect, useRef } from 'react';
import { usePanes } from './hooks';
import { addResponseListener, fireAttentionAlert, requestNotificationPermission } from './notifications';

// Watches the pane poll and fires a local notification when a pane newly needs
// attention (rising edge, deduped). Renders nothing. Piggybacks on the existing
// usePanes query (same key → React Query dedupes, no extra polling).
export function NotificationsController({ onOpenPane }: { onOpenPane: (paneId: string) => void }) {
  const panes = usePanes();
  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  useEffect(() => {
    requestNotificationPermission();
    const sub = addResponseListener(onOpenPane);
    return () => sub.remove();
  }, [onOpenPane]);

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
    for (const p of attn) {
      if (!seen.current.has(p.pane_id)) {
        fireAttentionAlert(`⚠ ${p.project}`, p.needs_from_you || p.wait_reason || 'needs attention', p.pane_id);
      }
    }
    seen.current = current;
  }, [panes.data]);

  return null;
}
