import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

const on = Platform.OS !== 'web';

// Wrapped so a build without the native module (pre-rebuild) no-ops instead of crashing.
const safe = (fn: () => Promise<void>) => {
  if (!on) return;
  try {
    fn().catch(() => {});
  } catch {
    /* native module missing */
  }
};

export const hapticTap = () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
export const hapticSelect = () => safe(() => Haptics.selectionAsync());
export const hapticSuccess = () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
export const hapticWarn = () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
