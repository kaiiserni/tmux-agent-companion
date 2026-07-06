import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Foreground/local-notification groundwork. True silent-push wake (app fully
// closed) needs an EAS dev build + self-hosted APNs key (bucket 4) - this layer
// already fires local alerts on new attention while the app runs/background-polls.
const supported = Platform.OS !== 'web';

if (supported) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

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
export function paneIdFromResponse(r: Notifications.NotificationResponse): string | undefined {
  const data = r.notification.request.content.data as { paneId?: string } | undefined;
  return data?.paneId;
}

export const addResponseListener = (fn: (paneId: string) => void) =>
  Notifications.addNotificationResponseReceivedListener((r) => {
    const id = paneIdFromResponse(r);
    if (id) fn(id);
  });
