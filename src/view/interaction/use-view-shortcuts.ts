import { useCallback, useEffect, type RefObject } from 'react';
import type { ActiveView } from '../../tools/pointer/runtime';
import { getActiveView } from '../active-view';
import { anyOverlayOpen } from '../../platform/channels/overlay-state';
import { isCommandHeld } from '../../state/keymap/held';
import { bindingIndex, effectiveCombo, type Overrides } from '../../state/keymap/resolve';
import { heldToken, normalizeCombo } from '../../platform/input/combo';
import { useKeybinds } from '../../state/keymap/store';
import { ALIASES } from '../../state/keymap/registry';
import { isTextEntry } from '../../platform/input/text-entry';
import { eventKeyToken } from '../../platform/input/key-token';

type Dir = 'up' | 'down' | 'left' | 'right';
/** Each held-pan command and the direction it walks; the reverse lookup derives from it. */
const PAN_CMD: Record<Dir, string> = {
  up: 'camera.pan_up', down: 'camera.pan_down', left: 'camera.pan_left', right: 'camera.pan_right',
};
const PAN_DIR: ReadonlyMap<string, Dir> = new Map(Object.entries(PAN_CMD).map(([dir, cmd]) => [cmd, dir as Dir]));

/** key token → pan direction. Arrow keys come from the registry `ALIASES` (the single source — no
 *  hardcoded arrow list, so the keyboard page and this loop can't disagree); WASD (or any rebound pan
 *  key) comes from the pan commands' effective bindings. Arrows pan by default but the user can
 *  Override one by binding a non-pan command to it — then it stops panning. The key is the combo's
 *  last segment, so a bare-letter rebind pans on that letter (modifiers ignored for held pan). */
function panKeyMap(overrides: Overrides): Map<string, Dir> {
  const idx = bindingIndex(overrides);
  const m = new Map<string, Dir>();
  for (const a of ALIASES) {
    const dir = PAN_DIR.get(a.commandId);
    if (!dir) continue;
    const tok = heldToken(normalizeCombo(a.combo));
    const bound = idx.get(tok);
    if (!bound || PAN_DIR.has(bound)) m.set(tok, dir); // free, or itself a pan binding
  }
  // WASD (and any rebound pan keys) — added last so they set the authoritative direction.
  for (const dir of Object.keys(PAN_CMD) as Dir[]) {
    const combo = effectiveCombo(overrides, PAN_CMD[dir]);
    if (combo) m.set(heldToken(combo), dir);
  }
  return m;
}

/** Screen px per millisecond a held pan key walks: 8 px a frame at 60 Hz. */
const PAN_SPEED = 8 / (1000 / 60);
/** The step a hold's first frame takes, and the longest step a stalled frame may take, in ms. */
const FIRST_STEP_MS = 1000 / 60;
const MAX_STEP_MS = 100;

/** Tap a pan key twice inside this and the second press is a run, held for as long as it is down —
 *  the double-tap-to-sprint every game uses. Long enough to be reachable, short enough that two
 *  deliberate nudges do not become one sprint. */
const DOUBLE_TAP_MS = 260;
/** Speed multipliers. Sprint is what a double tap buys; creep is the precision modifier. */
export const RUN_FACTOR = 2.6;
export const CREEP_FACTOR = 0.3;

/**
 * The speed a held pan runs at, given what the hand is doing.
 *
 * Creep wins over run: the modifier is a deliberate act taken during the sprint, so it has to be
 * able to take it back — otherwise a double tap locks the camera fast until every key is released.
 */
function panFactor(running: boolean, creeping: boolean): number {
  if (creeping) return CREEP_FACTOR;
  return running ? RUN_FACTOR : 1;
}

/**
 * Held pan keys walk a camera at a speed in pixels per millisecond, so the frame rate does not
 * change how far a hold travels. The rAF loop runs only while a key is held and stops one frame
 * after the last release; keys are ignored while an input, textarea or select is focused. The key
 * map is read live from the keybind store (the pan commands plus the arrows unless claimed), and
 * every keyboard-panning surface goes through here so a rebind reaches all of them.
 *
 * Double-tap a direction to run while it stays down; hold the constrain modifier (Shift) to creep.
 * Not Ctrl, since Ctrl+W closes the tab in Chromium and a page cannot intercept it.
 */
export function useHeldPan(pan: (dx: number, dy: number) => void, enabled: () => boolean) {
  useEffect(() => {
    let map = panKeyMap(useKeybinds.getState().overrides);
    const unsub = useKeybinds.subscribe((s) => { map = panKeyMap(s.overrides); });
    const keysDown = new Set<string>();
    /** Keys currently held as a run, and when each was last released, for the double-tap test. */
    const running = new Set<string>();
    const lastUp = new Map<string, number>();
    let frame = 0;
    /** The previous frame's timestamp; null on a hold's first frame. */
    let lastFrame: number | null = null;
    const tick = (now: number) => {
      const elapsed = lastFrame === null ? FIRST_STEP_MS : Math.min(MAX_STEP_MS, Math.max(0, now - lastFrame));
      lastFrame = now;
      if (keysDown.size > 0) {
        // One factor for the whole step, not per key: a diagonal held with one key sprinting and
        // one not would otherwise curve away from the diagonal.
        const speed = PAN_SPEED * elapsed * panFactor(running.size > 0, isCommandHeld('tool.constrain'));
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
      if (frame === 0) lastFrame = null;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!enabled()) return;
      const key = eventKeyToken(e);
      if (!map.has(key)) return;
      if (isTextEntry(e.target)) return;
      // Auto-repeat is the same press held down, not a second tap.
      if (!e.repeat && !keysDown.has(key)) {
        const since = performance.now() - (lastUp.get(key) ?? -Infinity);
        if (since <= DOUBLE_TAP_MS) running.add(key);
      }
      keysDown.add(key);
      if (frame === 0) frame = requestAnimationFrame(tick);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const key = eventKeyToken(e);
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

/** The editor's held pan: through the active view's camera, else the camera of the view in
 *  `fallbackRef`; suppressed while a modal owns the foreground (the map behind it is a blurred
 *  backdrop, and the keys belong to the popup). */
export function useWasdPan(fallbackRef: RefObject<{ asEditorView(): ActiveView } | null>) {
  const pan = useCallback((dx: number, dy: number) => {
    (getActiveView() ?? fallbackRef.current?.asEditorView())?.camera.pan(dx, dy);
  }, [fallbackRef]);
  useHeldPan(pan, notOverlaid);
}

const notOverlaid = () => !anyOverlayOpen();
