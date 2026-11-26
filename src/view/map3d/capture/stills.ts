/**
 * Best-effort offscreen 3D still for the export composition. Creates a throwaway
 * MapRenderer3D inside a container attached off-screen to document.body (so
 * clientWidth/clientHeight report the real requested size), renders one frame via
 * skipIntroAndRender(), captures a PNG, then disposes everything. Returns null on
 * any failure (no WebGL, build error, capture error) — export must never be
 * blocked by 3D.
 *
 * The scene creates its own canvas inside `container` and starts a rAF loop plus window
 * listeners; dispose() shuts all of them down.
 *
 * jsdom has no WebGL2: the shared probe answers false and the function returns immediately (never
 * throws, never imports three.js).
 */
import { surfaceImagesReady } from '../../shared/road/surface-image';
import { roadMaterialSettled } from '../../shared/road/material';
import { getCatalogItem } from '../../../state/catalog';
import type { GridState } from '../../../core/model/types';
import { hasWebGL2 } from '../../../platform/device/device-quality';
import { loadScene3D } from '../scene/preload';
import type { CameraAngle } from '../../../state/view-camera';
import { buildSmartAngles } from '../../../state/shot-list';
import type { SeenView } from '../camera/camera-pose';
import { createSignal } from '../../../core/base/signal';

/** Serialized identity of a CameraAngle: the key a still is kept under (`createStillShelf`) and the
 *  one the export preview's re-capture compares. */
export const angleKey = (a: CameraAngle): string =>
  `${a.az.toFixed(1)},${a.el.toFixed(1)},${a.dist.toFixed(2)},${a.tx ?? 0},${a.tz ?? 0}`;

/** Capture several "smart angle" 3D stills from one throwaway scene (cheaper than N scenes).
 *  When `angles` is omitted, content-aware angles are derived from the map's relief; a `SeenView`
 *  among them is drawn as its view saw it.
 *  Returns one data URL per angle ('' for any that fail); [] if 3D/WebGL is unavailable. */
export async function captureMapStills(
  state: GridState,
  angles?: (CameraAngle | SeenView)[],
  opts: { maxPx?: number; aspect?: number } = {},
): Promise<string[]> {
  try {
    // three needs WebGL2, and the shared probe both answers once and releases its own context.
    if (!hasWebGL2()) return [];
    const useAngles = angles ?? buildSmartAngles(state);
    await Promise.all([surfaceImagesReady(Array.from(state.objects.values(), obj => getCatalogItem(obj.catalogId))), roadMaterialSettled()]);
    const { MapRenderer3D } = await loadScene3D();
    const maxPx = opts.maxPx ?? 420;
    // `aspect` (width / height) lets callers request a landscape frame (the export 3D card's cell
    // shape) so the still needs no cropping to fill the card / menu tile. Defaults to square.
    const aspect = opts.aspect && opts.aspect > 0 ? opts.aspect : 1;
    const capW = maxPx, capH = Math.max(1, Math.round(maxPx / aspect));
    const container = document.createElement('div');
    container.style.cssText = `position:fixed; left:-99999px; top:0; width:${capW}px; height:${capH}px;`;
    container.setAttribute('aria-hidden', 'true');
    const urls: string[] = [];
    // The host enters the document inside the guard: a scene that throws on construction would
    // otherwise leave a fixed div in the page for the rest of the session.
    let scene: InstanceType<typeof MapRenderer3D> | null = null;
    try {
      document.body.appendChild(container);
      scene = new MapRenderer3D(container, state);
      scene.skipIntroAndRender(); // settle to the resting frame first
      for (const a of useAngles) { try { urls.push('eye' in a ? scene.captureSeen(a) : scene.captureFromAngle(a)); } catch { urls.push(''); } }
    } finally { scene?.destroy(); container.remove(); }
    return urls;
  } catch { return []; }
}

/** A still shelf as it stands: one data URL per angle asked for, in order ('' for one not captured
 *  yet or that failed), and whether a capture is on its way. */
export interface StillShelfState { urls: string[]; loading: boolean }

const NO_STILLS: StillShelfState = { urls: [], loading: false };

/**
 * Small stills of one map by camera angle, for a surface showing a list of them that changes: each
 * angle is captured once and kept (`angleKey`), so dropping or reordering angles captures nothing
 * and only a new angle builds the throwaway scene, which holds the main thread. Another map forgets
 * every still. A capture starts `settleMs` after the list was last shown, so the surface's own
 * motion ends first.
 */
export function createStillShelf(opts: { maxPx: number; aspect: number; settleMs: number; capture?: typeof captureMapStills }) {
  const capture = opts.capture ?? captureMapStills;
  const shelf = createSignal<StillShelfState>(NO_STILLS);
  const kept = new Map<string, string>();
  let map: GridState | null = null;
  let stop = (): void => {};
  return {
    /** Shows the stills of `angles` on `state`'s map in place of the list shown before; no map shows none. */
    show(state: GridState | null, angles: readonly CameraAngle[]): void {
      stop();
      stop = () => {};
      if (!state || angles.length === 0) { shelf.emit(NO_STILLS); return; }
      if (map !== state) { kept.clear(); map = state; }
      const urls = (): string[] => angles.map((angle) => kept.get(angleKey(angle)) ?? '');
      const missing = (): CameraAngle[] => angles.filter((angle) => !kept.has(angleKey(angle)));
      if (missing().length === 0) { shelf.emit({ urls: urls(), loading: false }); return; }
      shelf.emit({ urls: urls(), loading: true });
      let shown = true;
      const timer = setTimeout(() => {
        // Read as the capture starts: one overtaken on its way may have landed these since.
        const wanted = missing();
        void (wanted.length ? capture(state, wanted, { maxPx: opts.maxPx, aspect: opts.aspect }) : Promise.resolve([])).then((out) => {
          if (map === state) wanted.forEach((angle, i) => { if (out[i]) kept.set(angleKey(angle), out[i]); });
          if (shown) shelf.emit({ urls: urls(), loading: false });
        });
      }, opts.settleMs);
      stop = () => { shown = false; clearTimeout(timer); };
    },
    /** Stops a capture on its way from being shown, as a surface going away does. */
    release(): void {
      stop();
      stop = () => {};
    },
    subscribe: (listener: () => void): (() => void) => shelf.subscribe(() => listener()),
    snapshot: (): StillShelfState => shelf.get(),
  };
}
