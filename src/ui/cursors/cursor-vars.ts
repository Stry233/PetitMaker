/**
 * Publishes the four DOM cursors to CSS, as custom properties on `<html>`, and publishes the
 * system-cursors preference to the two gates that cannot read the store themselves.
 *
 * The same shape as `useMotionEnabled`: ONE writer stamps the root element, and everything
 * downstream reads it through plain CSS, so no component subscribes and nothing re-renders when
 * the values change.
 *
 * The properties are the contract in `cursor-spec`'s DOM_CURSORS; `ui/styles`'s `cursors` tokens
 * and the global rules in `cursors.css` are the readers.
 */
import { useEffect } from 'react';
import { refreshCursor } from '../../canvas/interaction/cursor-controller';
import { useEditorStore } from '../../state/store';
import { cursorCss, setSystemCursors } from './cursor-css';
import { DOM_CURSORS, type CursorId, type DomCursorId } from './cursor-spec';

/** Write the properties. Idempotent, and safe to call before React mounts. */
export function applyCursorVars(root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement): void {
  if (!root) return;
  for (const id of Object.keys(DOM_CURSORS) as DomCursorId[]) {
    root.style.setProperty(DOM_CURSORS[id], cursorCss(id));
  }
}

/**
 * Hand the preference to every gate that resolves a cursor, in the order they read it.
 *
 * All three gates are dedupe-blind on their own: `cursorCss` answers from a module flag, the custom
 * properties are written once, and the canvas controller skips a write whose resolved value matches
 * what it last wrote. Flipping the preference changes what every id resolves to WITHOUT changing any
 * of their inputs, so each has to be told.
 */
export function publishCursorPreference(system: boolean): void {
  setSystemCursors(system);
  applyCursorVars();
  refreshCursor();
}

/**
 * Mount once near the app root. `main` also publishes before the first render, so the first paint is
 * already correct; this covers a React tree mounted without that entry point (tests, isolated
 * harnesses) and republishes when the user flips the preference.
 */
export function useCursorVars(): void {
  const systemCursors = useEditorStore((s) => s.systemCursors);
  useEffect(() => { publishCursorPreference(systemCursors); }, [systemCursors]);
}

/**
 * `cursorCss` for a component that renders a cursor value into its own inline style.
 *
 * The module flag is not enough here: the store change re-renders these components BEFORE the effect
 * above republishes, so a plain `cursorCss` call would return the previous preference's value and
 * then never be asked again.
 */
export function useCursorCss(id: CursorId, opts: { forbidden?: boolean } = {}): string {
  const system = useEditorStore((s) => s.systemCursors);
  return cursorCss(id, { ...opts, system });
}
