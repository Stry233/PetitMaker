/**
 * Publishes the four DOM cursors to CSS, as custom properties on `<html>`, at the system-cursors
 * preference the store holds, and has the canvas controller re-resolve when it flips.
 *
 * The same shape as `useMotionEnabled`: One writer stamps the root element, and everything
 * downstream reads it through plain CSS, so no component subscribes and nothing re-renders when
 * the values change. The values are zoom-independent by construction — the cursors are SVGs drawn
 * at their intrinsic size, and no engine scales a cursor's drawn size by CSS zoom (verified by
 * probe on every engine) — so nothing here tracks the chrome or frame zoom.
 *
 * The properties are the contract in `cursor-spec`'s DOM_CURSORS; `ui/design/styles`'s `cursors` tokens
 * and the global rules in `cursors.css` are the readers.
 */
import { useEffect } from 'react';
import { refreshCursor } from '../../../view/interaction/cursor-controller';
import { useEditorStore } from '../../../state/store';
import { cursorCss } from '../../../assets/cursors/cursor-css';
import { DOM_CURSORS, type CursorId, type DomCursorId } from '../../../assets/cursors/cursor-spec';

/** Write the properties. Idempotent, and safe to call before React mounts. */
function applyCursorVars(system: boolean, root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement): void {
  if (!root) return;
  for (const id of Object.keys(DOM_CURSORS) as DomCursorId[]) {
    root.style.setProperty(DOM_CURSORS[id], cursorCss(id, { system }));
  }
}

/**
 * Re-resolve every cursor written ahead of a pointer event at preference `system` (default: the
 * store's, which the canvas controller reads): the custom properties, written once, and the canvas
 * controller, which skips a write whose resolved value matches what it last wrote. A flip changes
 * what every id resolves to without changing their inputs, so each has to be told.
 */
export function publishCursorPreference(system: boolean = useEditorStore.getState().systemCursors): void {
  applyCursorVars(system);
  refreshCursor();
}

/**
 * Mount once near the app root. `main` also publishes before the first render, so the first paint is
 * already correct; this covers a React tree mounted without that entry point (tests, isolated
 * harnesses) and republishes when the user flips the preference.
 */
export function useCursorVars(): void {
  const systemCursors = useEditorStore((s) => s.systemCursors);
  useEffect(() => {
    publishCursorPreference();
  }, [systemCursors]);
}

/**
 * `cursorCss` for a component that renders a cursor value into its own inline style.
 *
 * The component subscribes to the preference itself, so the store change that re-renders it hands
 * the fresh value straight in.
 */
export function useCursorCss(id: CursorId, opts: { forbidden?: boolean } = {}): string {
  const system = useEditorStore((s) => s.systemCursors);
  return cursorCss(id, { ...opts, system });
}
