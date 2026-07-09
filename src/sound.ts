import { Platform } from 'react-native';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

// Futuristic Tokyo-Night blip played when a pane newly needs attention.
let player: AudioPlayer | null = null;

export function playAlert() {
  if (Platform.OS === 'web') return;
  try {
    if (!player) {
      player = createAudioPlayer(require('../assets/alert.wav'));
      player.volume = 1;
    }
    player.seekTo(0);
    player.play();
  } catch {
    /* audio subsystem unavailable */
  }
}
