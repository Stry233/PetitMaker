/**
 * The UI-scale shortcut, mounted once by the editor root of either edition. It scales the panels,
 * never the map, and publishes the window's reach the store clamps the scale to.
 */
import { useEffect, useRef } from 'react';
import { pressCommand } from '../../editor/commands/run';
import { registerUiZoomReach } from '../../state/ui-zoom-reach';
import { useScaleReach } from '../design/scale';
import { effectiveCombo, matchesUiZoomCombo, type Overrides } from '../../state/keymap/resolve';
import { useKeybinds } from '../../state/keymap/store';
import { appKeyReaches } from '../../state/keymap/toolbar';

/** The two UI-scale bindings under `overrides`. */
function uiZoomCombos(overrides: Overrides): { in: string | null; out: string | null } {
  return {
    in: effectiveCombo(overrides, 'app.ui_zoom_in'),
    out: effectiveCombo(overrides, 'app.ui_zoom_out'),
  };
}

/** The UI-scale keys (Ctrl/Cmd += and -= by default, rebindable) scale the panels, not the map,
 *  writing the store's uiZoom target once per press. This listener hears the `app.ui_zoom_in` and
 *  `app.ui_zoom_out` rows' effective combos, matched by `matchesUiZoomCombo` (Cmd counts as Ctrl;
 *  either spelling of the `=`/`+` and `-`/`_` keycaps), and runs their commands.
 *  `ui/design/ui-zoom-anim.ts` eases the live value toward the target, so rapid presses accumulate
 *  against the target rather than restarting a tween from the drifting value. */
function useUiZoomShortcut() {
  const overrides = useKeybinds((s) => s.overrides);
  const combos = useRef(uiZoomCombos(overrides));
  useEffect(() => { combos.current = uiZoomCombos(overrides); }, [overrides]);
  // The Settings slider's reach (`design/scale-model.ts:reachOf`), published for every caller that
  // sets or steps the scale (`state/ui-zoom-reach.ts`): a step past it would change nothing.
  const reachNow = useScaleReach();
  const reach = useRef(reachNow);
  useEffect(() => { reach.current = reachNow; }, [reachNow]);
  useEffect(() => registerUiZoomReach(() => reach.current), []);
  useEffect(() => {
    const onKeyZoom = (e: KeyboardEvent) => {
      // Not suppressed while a modal is open: UI scaling is the one binding that
      // stays live behind an overlay, so the user can resize the whole chrome
      // (modal included — every surface reads the same uiZoom) while a dialog is
      // up. Every other shortcut (map pan, tool keys, delete) still self-suppresses.
      // A text field keeps what types there (`appKeyReaches`): rebound to a plain letter, this would
      // otherwise scale the chrome while the user types.
      if (!appKeyReaches(e)) return;
      // Zoom-in is tested first, so a pair deliberately bound onto each other's twin scales one way
      // rather than firing both and cancelling out.
      if (matchesUiZoomCombo(combos.current.in, e)) { e.preventDefault(); pressCommand('app.ui_zoom_in'); }
      else if (matchesUiZoomCombo(combos.current.out, e)) { e.preventDefault(); pressCommand('app.ui_zoom_out'); }
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
