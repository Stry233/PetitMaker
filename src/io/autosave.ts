// Crash-safe autosave: debounced localStorage persistence of the working map,
// restored on the next load. Built on the versioned codec (json-codec →
// io/save-format), so an autosave written by an older build still loads, and one
// written by a newer build is ignored rather than mis-parsed.
import { serialize, deserialize, readSaveCamera } from './json-codec';
import { getMapTemplate } from '../config/maps';
import { petitWindow } from '../core/runtime/window-bridge';
import type { GridState } from '../core/model/types';
import type { PersistedCamera } from './save-format';

const STORAGE_KEY = 'petit-planet-autosave';
const DEBOUNCE_MS = 2000;

let timer: ReturnType<typeof setTimeout> | null = null;

/** The camera(s) to persist alongside the map, read live from whichever view(s) have ever been
 *  active — NOT hooked to camera movement itself (a pan/orbit fires continuously; hammering
 *  localStorage on every frame would be the bug). It only rides along on the NEXT
 *  content-triggered write, and because it's read HERE (at write time, ~DEBOUNCE_MS after the
 *  triggering edit) rather than captured back when that edit happened, it can never be more stale
 *  than "whatever the user is looking at right now" — there is no drift window to bound. Each view
 *  is independent: a view never opened this session simply reports undefined and is omitted. */
function currentCamera(): PersistedCamera | undefined {
  const win = petitWindow();
  const view2d = win.__petitGetCamera?.();
  const view3d = win.__petitGet3DCamera?.();
  if (!view2d && !view3d) return undefined;
  return { ...(view2d ? { view2d } : {}), ...(view3d ? { view3d } : {}) };
}

/** Debounced: persist the working map ~DEBOUNCE_MS after the last edit. Safe to
 *  call on every mutation — only the trailing call writes. */
export function scheduleAutosave(state: GridState): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    // The content gate runs at write time: what matters is whether the map has
    // content when the save actually lands, and the check is a grid walk that
    // must not run once per command.
    if (!autosaveWorthy(state)) return;
    const camera = currentCamera();
    try {
      localStorage.setItem(STORAGE_KEY, serialize(state, camera));
    } catch {
      // Quota exceeded. The provenance section dominates the payload on generated
      // maps (per-cell taint + the operation ledger); the map itself is what the
      // restore bubble protects, so save it without provenance before giving up.
      try {
        const { provenance: _dropped, ...rest } = state;
        localStorage.setItem(STORAGE_KEY, serialize(rest as GridState, camera));
      } catch {
        // Still failing (storage unavailable / truly full) — drop this autosave;
        // the next edit tries again.
      }
    }
  }, DEBOUNCE_MS);
}

/** A map worth persisting: any terrain, or any object beyond the built-in plaza.
 *  A fresh empty map must never clobber a real save. Exported as the ONE definition of empty,
 *  shared with the startup restore offer and the drag-drop import confirm. */
export function autosaveWorthy(state: GridState): boolean {
  for (const row of state.cells) {
    for (const cell of row) if (cell.terrain) return true;
  }
  for (const [, obj] of state.objects) if (!obj.locked) return true;
  return false;
}

/** A restored autosave: the map plus whatever camera(s) rode along with it (either may be
 *  absent — a save written before this feature, or one where a view was never opened). */
export interface RestoredAutosave {
  state: GridState;
  camera?: PersistedCamera;
}

/**
 * Restore the last autosaved map, resolving its template from the saved id.
 * Returns null when there's nothing to restore or the save can't be read
 * (corrupt, or saved by a newer build — the version guard lives in deserialize →
 * migrateToCurrent). Never throws.
 */
export function readAutosave(): RestoredAutosave | null {
  let json: string | null = null;
  try {
    json = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // localStorage unavailable (private mode / SSR)
  }
  if (!json) return null;
  try {
    const { templateId } = JSON.parse(json) as { templateId?: string };
    const state = deserialize(json, getMapTemplate(templateId));
    // A pre-camera autosave simply has no `camera` key — readSaveCamera reads undefined and the
    // restore leaves the camera alone (App.tsx only applies it when present).
    return { state, camera: readSaveCamera(json) };
  } catch {
    return null;
  }
}

/** Forget the autosave (e.g. a deliberate reset). */
export function clearAutosave(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Whether a restorable autosave exists. */
export function hasAutosave(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}
