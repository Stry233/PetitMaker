/**
 * The UI-scale shortcut, mounted once by the editor root of either edition. It scales the panels,
 * never the map.
 */
import { useEffect, useRef } from 'react';
import { useEditorStore } from '../../state/store';
import { UI_ZOOM_DEFAULTS, scaleProfileOf } from '../../platform/storage/prefs';
import { scaleLattice, UI_SCALE_STEP, useScaleReach } from '../design/scale';
import { effectiveCombo, matchesUiZoomCombo, type Overrides } from '../../state/keymap/resolve';
import { useKeybinds } from '../../state/keymap/store';
import { isTextEntry } from '../../platform/input/text-entry';

/** The two UI-scale bindings under `overrides`. */
function uiZoomCombos(overrides: Overrides): { in: string | null; out: string | null } {
  return {
    in: effectiveCombo(overrides, 'app.ui_zoom_in'),
    out: effectiveCombo(overrides, 'app.ui_zoom_out'),
  };
}

/** The UI-scale keys (Ctrl/Cmd += and -= by default, rebindable) scale the panels, not the map,
 *  writing the store's uiZoom target once per press. The `app.ui_zoom_in`/`app.ui_zoom_out` keymap
 *  rows carry no run body: this listener carries them out with their effective combos, matched by
 *  `matchesUiZoomCombo` (Cmd counts as Ctrl; either spelling of the `=`/`+` and `-`/`_` keycaps).
 *  `ui/design/ui-zoom-anim.ts` eases the live value toward the target, so rapid presses accumulate
 *  against the target rather than restarting a tween from the drifting value. */
export function useUiZoomShortcut() {
  const overrides = useKeybinds((s) => s.overrides);
  const combos = useRef(uiZoomCombos(overrides));
  useEffect(() => { combos.current = uiZoomCombos(overrides); }, [overrides]);
  // The Settings slider's reach (`design/scale-model.ts:reachOf`): a step past it would change nothing.
  const reachNow = useScaleReach();
  const reach = useRef(reachNow);
  useEffect(() => { reach.current = reachNow; }, [reachNow]);
  useEffect(() => {
    // Accumulates against the persisted target, on the stops of the scale in force (each through its
    // own default) up to the slider's reach, as the Settings slider steps. A preference saved past the
    // reach steps down from the reach and never up toward it.
    const bumpUiZoom = (steps: number) => {
      const store = useEditorStore.getState();
      const { snap } = scaleLattice(UI_ZOOM_DEFAULTS[scaleProfileOf(store.inputMode, store.layoutShape)], reach.current);
      const next = snap(snap(store.uiZoom) + steps * UI_SCALE_STEP);
      if (steps > 0 ? next > store.uiZoom : next < store.uiZoom) store.setUiZoom(next);
    };
    const onKeyZoom = (e: KeyboardEvent) => {
      // Not suppressed while a modal is open: UI scaling is the one binding that
      // stays live behind an overlay, so the user can resize the whole chrome
      // (modal included — every surface reads the same uiZoom) while a dialog is
      // up. Every other shortcut (map pan, tool keys, delete) still self-suppresses.
      // A text field still wins, the same guard the discrete engine applies: rebound to a plain
      // letter, this would otherwise scale the chrome while the user types.
      if (isTextEntry(e.target)) return;
      // Zoom-in is tested first, so a pair deliberately bound onto each other's twin scales one way
      // rather than firing both and cancelling out.
      if (matchesUiZoomCombo(combos.current.in, e)) { e.preventDefault(); bumpUiZoom(1); }
      else if (matchesUiZoomCombo(combos.current.out, e)) { e.preventDefault(); bumpUiZoom(-1); }
    };

    window.addEventListener('keydown', onKeyZoom);
    return () => { window.removeEventListener('keydown', onKeyZoom); };
  }, []);
}

/** The shortcut as a component, mounted inside the scale's providers so its reach reads the view the
 *  slider reads. */
export function UiZoomShortcut(): null {
  useUiZoomShortcut();
  return null;
}
