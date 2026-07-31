/**
 * The "System cursors" preference, end to end.
 *
 * A custom CSS cursor is an image, so it cannot honour the pointer size or theme a user set in
 * their operating system. Flipping the preference must reach all three places a cursor is
 * resolved, and flipping it back must restore the app's own set.
 *
 * The three: `cursorCss` (which the canvas and a handful of components call), the four custom
 * properties on <html> (which every DOM surface reads through `cursors.css` and the `cursors`
 * tokens), and the canvas controller's already-written surface.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { CURSORS, CURSOR_IDS, DOM_CURSORS, type DomCursorId } from '../../core/runtime/cursor-spec';
import { cursorCss } from '../../ui/cursors/cursor-css';
import { publishCursorPreference, useCursorVars } from '../../ui/cursors/cursor-vars';
import {
  __resetCursorController, registerCursorSurface, setToolCursor,
} from '../../canvas/interaction/cursor-controller';
import { useEditorStore, SYSTEM_CURSORS_STORAGE_KEY } from '../../state/store';

/** The ids that HAVE art, and so are the ones a url() is expected for. */
const DRAWN = CURSOR_IDS.filter((id) => CURSORS[id].hasArt);

const domProp = (id: DomCursorId): string =>
  document.documentElement.style.getPropertyValue(DOM_CURSORS[id]);

beforeEach(() => {
  __resetCursorController();
  useEditorStore.setState({ systemCursors: false });
  publishCursorPreference(false);
});

afterEach(() => {
  publishCursorPreference(false);
  useEditorStore.setState({ systemCursors: false });
  localStorage.removeItem(SYSTEM_CURSORS_STORAGE_KEY);
});

describe('system cursors: the value producer', () => {
  it('hands back a bare keyword for EVERY id, badge included', () => {
    // Resolve first, so the memo is warm: a cached url() must not be able to answer for a
    // preference it was not built under.
    for (const id of DRAWN) cursorCss(id);

    publishCursorPreference(true);
    for (const id of CURSOR_IDS) {
      expect(cursorCss(id)).toBe(CURSORS[id].fallback);
      // A keyword cursor cannot carry the forbidden badge, so the badge cannot resurrect an image.
      expect(cursorCss(id, { forbidden: true })).toBe(CURSORS[id].fallback);
      expect(cursorCss(id)).not.toContain('url(');
    }
  });

  it('gives the app its own set back when the preference goes off', () => {
    publishCursorPreference(true);
    for (const id of DRAWN) cursorCss(id);

    publishCursorPreference(false);
    for (const id of DRAWN) {
      expect(cursorCss(id)).toContain('url("data:image/svg+xml,');
      // The keyword is still there, as the mandatory fallback after the image.
      expect(cursorCss(id).endsWith(CURSORS[id].fallback)).toBe(true);
    }
  });
});

describe('system cursors: the DOM', () => {
  it('publishes keywords into the four custom properties, and images back', () => {
    const ids = Object.keys(DOM_CURSORS) as DomCursorId[];

    publishCursorPreference(true);
    for (const id of ids) expect(domProp(id)).toBe(CURSORS[id].fallback);

    publishCursorPreference(false);
    for (const id of ids) expect(domProp(id)).toContain('url(');
  });

  it('re-publishes when the store flips, without the component being told', () => {
    // The gate: the effect used to have `[]` deps, so nothing after the first mount could change
    // what <html> carried.
    function Host() { useCursorVars(); return null; }
    render(<Host />);
    expect(domProp('clickable')).toContain('url(');

    act(() => { useEditorStore.getState().setSystemCursors(true); });
    expect(domProp('clickable')).toBe(CURSORS.clickable.fallback);

    act(() => { useEditorStore.getState().setSystemCursors(false); });
    expect(domProp('clickable')).toContain('url(');
  });

  it('persists the choice, so a user who needs it does not re-choose every session', () => {
    act(() => { useEditorStore.getState().setSystemCursors(true); });
    expect(localStorage.getItem(SYSTEM_CURSORS_STORAGE_KEY)).toBe('1');
    act(() => { useEditorStore.getState().setSystemCursors(false); });
    expect(localStorage.getItem(SYSTEM_CURSORS_STORAGE_KEY)).toBe('0');
  });
});

describe('system cursors: the canvas', () => {
  it('repaints the surface even though nothing about the cursor STATE changed', () => {
    // The gate: the controller skips a write whose resolved value matches the last one, and the
    // preference changes what every id resolves to without touching any of its inputs.
    const el = document.createElement('div');
    registerCursorSurface(el);
    setToolCursor('mountain');
    expect(el.style.cursor).toContain('url(');

    publishCursorPreference(true);
    expect(el.style.cursor).toBe(CURSORS.mountain.fallback);

    publishCursorPreference(false);
    expect(el.style.cursor).toContain('url(');
    expect(el.style.cursor).toBe(cursorCss('mountain'));
  });

  it('keeps following the tool while the preference is on', () => {
    const el = document.createElement('div');
    registerCursorSurface(el);
    publishCursorPreference(true);
    setToolCursor('water');
    expect(el.style.cursor).toBe(CURSORS.water.fallback);
    setToolCursor('place');
    expect(el.style.cursor).toBe(CURSORS.place.fallback);
  });
});
