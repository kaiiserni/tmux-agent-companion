import { useCallback, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';

// A monospace calibration string measured once at `base` size to derive a
// char-width ratio, then used to size text so `maxLineLen` columns fill the
// container width exactly - the same idea as xterm's FitAddon, applied to
// plain RN <Text> (used by the Screen tab, which isn't a real terminal).
export const FIT_CALIBRATION = 'M'.repeat(40);

export function useFitFontSize(maxLineLen: number, opts?: { base?: number; min?: number; max?: number }) {
  const base = opts?.base ?? 12;
  const min = opts?.min ?? 9;
  const max = opts?.max ?? 16;
  const [width, setWidth] = useState(0);
  const [charWidth, setCharWidth] = useState<number | null>(null);

  const onLayout = useCallback((e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width), []);
  const onCalibrate = useCallback(
    (e: LayoutChangeEvent) => setCharWidth(e.nativeEvent.layout.width / FIT_CALIBRATION.length),
    [],
  );

  if (!charWidth || !width || !maxLineLen) {
    return { onLayout, onCalibrate, fontSize: base, overflows: false, ready: false };
  }
  const natural = base * (width / (maxLineLen * charWidth));
  const fontSize = Math.max(min, Math.min(max, Math.floor(natural)));
  return { onLayout, onCalibrate, fontSize, overflows: natural < min, ready: true };
}
