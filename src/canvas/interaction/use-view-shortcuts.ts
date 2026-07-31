import { useEffect, type RefObject } from 'react';
import type { MapRenderer } from '../map2d/map-renderer';
import { getActiveView } from '../active-view';
import { useEditorStore } from '../../state/store';
import { clampUiZoom } from '../map2d/zoom-accum';
import { anyOverlayOpen } from '../../core/runtime/overlay-state';
import { bindingIndex, effectiveCombo, normalizeCombo, useKeybinds, type Overrides } from '../../ui/keybindings/store';
import { ALIASES } from '../../ui/keybindings/commands';

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

/** WASD / arrow-key continuous pan. The rAF loop runs ONLY while a pan key is
 *  held (armed on keydown, self-stops one frame after the last release), so an
 *  idle editor schedules no per-frame callback. Pan keys are ignored while an
 *  input/textarea/select is focused. The WASD half reads the user's rebindable
 *  pan keys from the keybind store (live); the arrows pan unless the user binds something else to
 *  them. */
export function useWasdPan(rendererRef: RefObject<MapRenderer | null>) {
  useEffect(() => {
    const PAN_SPEED = 8;
    let map = panKeyMap(useKeybinds.getState().overrides);
    const unsub = useKeybinds.subscribe((s) => { map = panKeyMap(s.overrides); });
    const keysDown = new Set<string>();
    let wasdFrame = 0;
    const wasdTick = () => {
      const renderer = rendererRef.current;
      if (renderer && keysDown.size > 0) {
        let dx = 0;
        let dy = 0;
        for (const key of keysDown) {
          const dir = map.get(key);
          if (dir === 'up') dy -= PAN_SPEED;
          else if (dir === 'down') dy += PAN_SPEED;
          else if (dir === 'left') dx -= PAN_SPEED;
          else if (dir === 'right') dx += PAN_SPEED;
        }
        if (dx !== 0 || dy !== 0) {
          // Route through the active view: the 3D scene ground-pans (it also has
          // its own WASD handling, gated off while the pointer machine owns input).
          const v = getActiveView();
          if (v) v.camera.pan(dx, dy);
          else {
            renderer.viewport.pan(dx, dy);
            renderer.applyViewportTransform();
          }
        }
      }
      wasdFrame = keysDown.size > 0 ? requestAnimationFrame(wasdTick) : 0;
    };
    const startWasd = () => { if (wasdFrame === 0) wasdFrame = requestAnimationFrame(wasdTick); };

    const onKeyDown = (e: KeyboardEvent) => {
      // The 3D preview owns WASD while it's open — don't also pan the hidden 2D map.
      if (useEditorStore.getState().modals.preview3d) return;
      // A blocking modal is foregrounded over a blurred map — keys belong to the popup, not the map.
      if (anyOverlayOpen()) return;
      const key = e.key.toLowerCase();
      if (map.has(key)) {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
        keysDown.add(key);
        startWasd();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysDown.delete(e.key.toLowerCase());
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      unsub();
      cancelAnimationFrame(wasdFrame);
    };
  }, [rendererRef]);
}

/** Ctrl/Cmd + (= / + / - / _) scales the UI (panels), VS Code-style — the map
 *  is untouched. Writes the store's uiZoom TARGET directly (the single
 *  persistence path shared with the Settings slider) — one write per press,
 *  no per-frame localStorage churn.
 *
 *  The easing lives at the APPLICATION layer (`ui/menu/ui-zoom-anim.ts`),
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
