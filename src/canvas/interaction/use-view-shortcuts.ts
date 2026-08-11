import { useCallback, useEffect, type RefObject } from 'react';
import type { MapRenderer } from '../map2d/map-renderer';
import { getActiveView } from '../active-view';
import { useEditorStore } from '../../state/store';
import { clampUiZoom } from '../map2d/zoom-accum';
import { anyOverlayOpen } from '../../core/runtime/overlay-state';
import { isConstrainHeld } from '../../core/runtime/modifier-state';
import { bindingIndex, effectiveCombo, normalizeCombo, useKeybinds, ALIASES, type Overrides } from '../../core/runtime/keybindings';

type Dir = 'up' | 'down' | 'left' | 'right';
const PAN_CMD: Record<Dir, string> = {
  up: 'camera.pan_up', down: 'camera.pan_down', left: 'camera.pan_left', right: 'camera.pan_right',
};
const PAN_DIR: Record<string, Dir> = {
  'camera.pan_up': 'up', 'camera.pan_down': 'down', 'camera.pan_left': 'left', 'camera.pan_right': 'right',
};

/** key token → pan direction. Arrow keys come from the registry ALIASES (the single source — no
 *  hardcoded arrow list, so the keyboard page and this loop can't disagree); WASD (or any rebound pan
 *  key) comes from the pan commands' effective bindings. Arrows pan by default but the user can
 *  OVERRIDE one by binding a non-pan command to it — then it stops panning. The key is the combo's
 *  last segment, so a bare-letter rebind pans on that letter (modifiers ignored for held pan). */
function panKeyMap(overrides: Overrides): Map<string, Dir> {
  const idx = bindingIndex(overrides);
  const m = new Map<string, Dir>();
  for (const a of ALIASES) {
    const dir = PAN_DIR[a.commandId];
    if (!dir) continue;
    const tok = normalizeCombo(a.combo).split('+').pop()!;
    const bound = idx.get(tok);
    if (!bound || bound.startsWith('camera.pan_')) m.set(tok, dir); // free, or itself a pan binding
  }
  // WASD (and any rebound pan keys) — added last so they set the authoritative direction.
  for (const dir of Object.keys(PAN_CMD) as Dir[]) {
    const combo = effectiveCombo(overrides, PAN_CMD[dir]);
    if (combo) m.set(combo.split('+').pop()!, dir);
  }
  return m;
}

/** Screen px a held pan key walks per frame. */
const PAN_SPEED = 8;

/** Tap a pan key twice inside this and the second press is a RUN, held for as long as it is down —
 *  the double-tap-to-sprint every game uses. Long enough to be reachable, short enough that two
 *  deliberate nudges do not become one sprint. */
const DOUBLE_TAP_MS = 260;
/** Speed multipliers. Sprint is what a double tap buys; creep is the precision modifier. */
const RUN_FACTOR = 2.6;
const CREEP_FACTOR = 0.3;

/**
 * The speed a held pan runs at, given what the hand is doing.
 *
 * Creep WINS over run: the modifier is a deliberate act taken during the sprint, so it has to be
 * able to take it back — otherwise a double tap locks the camera fast until every key is released.
 */
export function panFactor(running: boolean, creeping: boolean): number {
  if (creeping) return CREEP_FACTOR;
  return running ? RUN_FACTOR : 1;
}

/**
 * Held pan keys walk a camera. The rAF loop runs ONLY while a key is held (armed on keydown,
 * self-stops one frame after the last release), so an idle surface schedules no per-frame callback.
 * Keys are ignored while an input/textarea/select is focused.
 *
 * The key map is the user's, read live from the keybind store: WASD (or whatever the pan commands
 * are rebound to) plus the arrows unless something else claims them. Every surface that pans by
 * keyboard goes through here, which is what makes a rebind reach all of them.
 *
 * Two speeds ride on top: double-tap a direction to RUN while it stays down, and hold the constrain
 * modifier (Shift, rebindable) to CREEP. Shift rather than Ctrl for the slow one because Ctrl+W
 * closes the tab in Chromium and a page cannot intercept it.
 */
export function useHeldPan(pan: (dx: number, dy: number) => void, enabled: () => boolean) {
  useEffect(() => {
    let map = panKeyMap(useKeybinds.getState().overrides);
    const unsub = useKeybinds.subscribe((s) => { map = panKeyMap(s.overrides); });
    const keysDown = new Set<string>();
    /** Keys currently held as a RUN, and when each was last released, for the double-tap test. */
    const running = new Set<string>();
    const lastUp = new Map<string, number>();
    let frame = 0;
    const tick = () => {
      if (keysDown.size > 0) {
        // One factor for the whole step, not per key: a diagonal held with one key sprinting and
        // one not would otherwise curve away from the diagonal.
        const speed = PAN_SPEED * panFactor(running.size > 0, isConstrainHeld());
        let dx = 0;
        let dy = 0;
        for (const key of keysDown) {
          const dir = map.get(key);
          if (dir === 'up') dy -= speed;
          else if (dir === 'down') dy += speed;
          else if (dir === 'left') dx -= speed;
          else if (dir === 'right') dx += speed;
        }
        if (dx !== 0 || dy !== 0) pan(dx, dy);
      }
      frame = keysDown.size > 0 ? requestAnimationFrame(tick) : 0;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!enabled()) return;
      const key = e.key.toLowerCase();
      if (!map.has(key)) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      // Auto-repeat is the SAME press held down, not a second tap.
      if (!e.repeat && !keysDown.has(key)) {
        const since = performance.now() - (lastUp.get(key) ?? -Infinity);
        if (since <= DOUBLE_TAP_MS) running.add(key);
      }
      keysDown.add(key);
      if (frame === 0) frame = requestAnimationFrame(tick);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      keysDown.delete(key);
      running.delete(key);
      lastUp.set(key, performance.now());
    };
    const onBlur = () => { keysDown.clear(); running.clear(); lastUp.clear(); };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      unsub();
      cancelAnimationFrame(frame);
    };
  }, [pan, enabled]);
}

/** The editor's held pan: through the ACTIVE view's camera, suppressed while a modal owns the
 *  foreground (the map behind it is a blurred backdrop, and the keys belong to the popup). */
export function useWasdPan(rendererRef: RefObject<MapRenderer | null>) {
  const pan = useCallback((dx: number, dy: number) => {
    const v = getActiveView();
    if (v) { v.camera.pan(dx, dy); return; }
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.viewport.pan(dx, dy);
    renderer.applyViewportTransform();
  }, [rendererRef]);
  useHeldPan(pan, notOverlaid);
}

const notOverlaid = () => !anyOverlayOpen();

/** Ctrl/Cmd + (= / + / - / _) scales the UI (panels), VS Code-style — the map
 *  is untouched. Writes the store's uiZoom TARGET directly (the single
 *  persistence path shared with the Settings slider) — one write per press,
 *  no per-frame localStorage churn.
 *
 *  Registered (not re-wired) as the reserved `app.ui_zoom_in`/`app.ui_zoom_out` rows in
 *  core/runtime/keybindings.ts, so the keyboard modal shows the combo and no rebind can steal it
 *  out from under this listener.
 *
 *  The easing lives at the APPLICATION layer (`ui/design/ui-zoom-anim.ts`),
 *  shared with the Settings slider's release commit and the reset/keyboard
 *  paths, so it applies here by construction. It is a persistent rAF follow
 *  loop that exponentially smooths a live value toward the target: rapid
 *  presses must accumulate against the TARGET, because restarting a tween
 *  from the drifting live value makes the panels shake. */
export function useUiZoomShortcut() {
  useEffect(() => {
    const bumpUiZoom = (delta: number) => {
      const store = useEditorStore.getState();
      store.setUiZoom(clampUiZoom(store.uiZoom + delta)); // accumulate against the persisted TARGET
    };
    const onKeyZoom = (e: KeyboardEvent) => {
      // NOT suppressed while a modal is open: UI scaling is the one binding that
      // stays live behind an overlay, so the user can resize the whole chrome
      // (modal included — every surface reads the same uiZoom) while a dialog is
      // up. Every OTHER shortcut (map pan, tool keys, delete) still self-suppresses.
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '=' || e.key === '+') { e.preventDefault(); bumpUiZoom(0.1); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); bumpUiZoom(-0.1); }
    };

    window.addEventListener('keydown', onKeyZoom);
    return () => window.removeEventListener('keydown', onKeyZoom);
  }, []);
}
