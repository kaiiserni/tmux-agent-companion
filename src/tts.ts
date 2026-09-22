import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { getToken } from './config';

// Reads an agent's reply out loud: the bridge renders it through CanaryLLM and
// serves the mp3, the app only plays a URL. One line at a time - starting a new
// one stops whatever was playing.

export interface SpeechState {
  key: string | null;
  loading: boolean;
}

let state: SpeechState = { key: null, loading: false };
const listeners = new Set<() => void>();
let player: AudioPlayer | null = null;
let sub: { remove: () => void } | null = null;
// Bumped on every start/stop so a render that finishes late can't grab the player.
let generation = 0;

function set(next: SpeechState) {
  state = next;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export const useSpeech = (): SpeechState => useSyncExternalStore(subscribe, () => state, () => state);

let audioModeSet = false;
async function ensureAudioMode() {
  if (audioModeSet || Platform.OS === 'web') return;
  audioModeSet = true;
  // Without this the ring/silent switch mutes playback on iOS.
  try {
    await setAudioModeAsync({ playsInSilentMode: true });
  } catch {
    /* audio subsystem unavailable */
  }
}

export function stopSpeech() {
  generation++;
  sub?.remove();
  sub = null;
  try {
    player?.remove();
  } catch {
    /* already gone */
  }
  player = null;
  if (state.key !== null || state.loading) set({ key: null, loading: false });
}

// `key` identifies the turn being spoken; speaking the one already active stops it.
export async function speak(baseUrl: string, key: string, text: string, paneId?: string): Promise<void> {
  if (state.key === key) {
    stopSpeech();
    return;
  }
  stopSpeech();
  const gen = ++generation;
  set({ key, loading: true });
  try {
    await ensureAudioMode();
    const token = await getToken();
    const res = await fetch(`${baseUrl}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text, pane_id: paneId }),
    });
    const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !body.url) throw new Error(body.error ?? `tts → ${res.status}`);
    if (gen !== generation) return;
    // Token in both places: AVPlayer doesn't always carry custom headers through
    // its range requests, and the bridge accepts either.
    const uri = `${baseUrl}${body.url}?token=${encodeURIComponent(token)}`;
    const p = createAudioPlayer({ uri, headers: { Authorization: `Bearer ${token}` } });
    player = p;
    sub = p.addListener('playbackStatusUpdate', (status) => {
      if (status.didJustFinish && gen === generation) stopSpeech();
    });
    p.play();
    set({ key, loading: false });
  } catch (e) {
    if (gen === generation) stopSpeech();
    throw e;
  }
}
