import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';

const supported = Platform.OS !== 'web';

if (supported) {
  Notifications.setNotificationHandler({
    handleNotification: async (n) => {
      // A server push (rising-edge) and the app's own foreground poll would both
      // alert while the app is open. Suppress the pushed one when active — the
      // local flow already fired. Backgrounded/closed: show it, that's the point.
      const isRemote = (n.request.trigger as { type?: string } | null)?.type === 'push';
      const suppress = isRemote && AppState.currentState === 'active';
      return {
        shouldShowBanner: !suppress,
        shouldShowList: !suppress,
        shouldPlaySound: !suppress,
        shouldSetBadge: false,
      };
    },
  });
}

// Raw APNs device token (NOT getExpoPushTokenAsync — that routes via Expo's
// service; agent data is confidential). Needs the push entitlement in the build.
export async function getDeviceToken(): Promise<string | null> {
  if (!supported) return null;
  try {
    const t = await Notifications.getDevicePushTokenAsync();
    return typeof t.data === 'string' ? t.data : null;
  } catch {
    return null;
  }
}

// Sandbox vs production is baked into the build: a Metro-served dev build gets a
// sandbox token, a release (ad-hoc/TestFlight) build a production one.
export const pushEnv = (): 'sandbox' | 'production' => (__DEV__ ? 'sandbox' : 'production');

export const addPushTokenListener = (fn: (token: string) => void) =>
  Notifications.addPushTokenListener((t) => {
    if (typeof t.data === 'string') fn(t.data);
  });

export async function requestNotificationPermission(): Promise<boolean> {
  if (!supported) return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const req = await Notifications.requestPermissionsAsync();
  return req.granted;
}

export async function fireAttentionAlert(title: string, body: string, paneId: string): Promise<void> {
  if (!supported) return;
  await Notifications.scheduleNotificationAsync({
    content: { title, body: body.slice(0, 140), data: { paneId } },
    trigger: null,
  });
}

// The pane_id carried on a tapped notification, for deep-linking to PaneDetail.
// Local alerts store `paneId`; server pushes carry top-level `pane_id`.
export function paneIdFromResponse(r: Notifications.NotificationResponse): string | undefined {
  const data = r.notification.request.content.data as { paneId?: string; pane_id?: string } | undefined;
  return data?.paneId ?? data?.pane_id;
}

export const addResponseListener = (fn: (paneId: string) => void) =>
  Notifications.addNotificationResponseReceivedListener((r) => {
    const id = paneIdFromResponse(r);
    if (id) fn(id);
  });
