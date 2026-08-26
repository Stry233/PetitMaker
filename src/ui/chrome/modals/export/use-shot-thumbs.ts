// Thumbnail capture for the export 3D-shots menu. Each still is captured once and CACHED by its
// camera angle, so add/delete/reorder reuse cached images and only a genuinely-new angle triggers a
// capture. This matters for performance: capturing spins up (and disposes) a whole throwaway
// three.js scene, so recapturing the whole set on every delete freezes the main thread mid-animation.
// The cache is cleared when the map (GridState) changes. Returns one data URL per shot in order
// ('' for any not yet captured / that failed); [] when WebGL is unavailable.
import { useEffect, useRef, useState } from 'react';
import type { GridState } from '../../../../core/model/types';
import { captureMapStills, angleKey, type CameraAngle } from '../../../../canvas/map3d/capture';
import { CARD_3D_CELL_ASPECT } from '../../../../io/export/paint';

const THUMB_PX = 220;
// Capturing builds a throwaway three.js scene, which BLOCKS the main thread. Defer it until after
// the shots strip's add/expand spring (springs.gentle, ~400ms) has settled, so the heavy build
// never stalls that animation mid-flight (a stall snaps the layout on the final frame). Placeholders
// show meanwhile. Delete needs no capture (cached), so it stays instant.
const DEBOUNCE_MS = 480;

export function useShot3dThumbs(
  shots: CameraAngle[],
  state: GridState | null,
  open: boolean,
): { urls: string[]; loading: boolean } {
  const [urls, setUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const gen = useRef(0);
  const cache = useRef(new Map<string, string>());
  const lastState = useRef<GridState | null>(null);
  const key = shots.map(angleKey).join('|');

  useEffect(() => {
    if (!open || !state || shots.length === 0) { setUrls([]); setLoading(false); return; }
    // A new map invalidates every cached still.
    if (lastState.current !== state) { cache.current.clear(); lastState.current = state; }

    const build = () => shots.map((s) => cache.current.get(angleKey(s)) ?? '');
    const missing = shots.filter((s) => !cache.current.has(angleKey(s)));
    setUrls(build()); // show whatever is already cached immediately

    if (missing.length === 0) { setLoading(false); return; }
    const my = ++gen.current;
    setLoading(true);
    const id = setTimeout(async () => {
      // Capture ONLY the missing angles (one scene for the batch).
      const out = await captureMapStills(state, missing, { maxPx: THUMB_PX, aspect: CARD_3D_CELL_ASPECT });
      if (gen.current !== my) return;
      missing.forEach((s, i) => { if (out[i]) cache.current.set(angleKey(s), out[i]!); });
      setUrls(build());
      setLoading(false);
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialized shots + open + map
  }, [open, state, key]);

  return { urls, loading };
}
