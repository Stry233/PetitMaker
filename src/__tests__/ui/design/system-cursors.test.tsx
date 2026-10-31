// @vitest-environment jsdom
/**
 * The "System cursors" preference, end to end. An image cursor cannot honour the OS pointer size or
 * theme, so the preference reaches all three places a cursor is resolved: `cursorCss`, the four
 * custom properties on <html> that DOM surfaces read, and the canvas controller's written surface.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { CURSORS, CURSOR_IDS, DOM_CURSORS, type DomCursorId } from '../../../assets/cursors/cursor-spec';
import { cursorCss } from '../../../assets/cursors/cursor-css';
import { publishCursorPreference, useCursorVars } from '../../../ui/design/cursors/cursor-vars';
import {
  __resetCursorController, registerCursorSurface, setToolCursor,
} from '../../../view/interaction/cursor-controller';
import { useEditorStore } from '../../../state/store';
import { PREFS } from '../../../platform/storage/prefs';

/** The ids that have art, and so are the ones a url() is expected for. */
const DRAWN = CURSOR_IDS.filter((id) => CURSORS[id].hasArt);

/** Set the store's preference and publish it, as a flip in Settings does. */
const prefer = (on: boolean): void => { useEditorStore.setState({ systemCursors: on }); publishCursorPreference(); };

const domProp = (id: DomCursorId): string =>
  document.documentElement.style.getPropertyValue(DOM_CURSORS[id]);

beforeEach(() => {
  __resetCursorController();
  useEditorStore.setState({ systemCursors: false });
  prefer(false);
});

afterEach(() => {
  prefer(false);
  useEditorStore.setState({ systemCursors: false });
  localStorage.removeItem(PREFS.systemCursors.key);
});

describe('system cursors: the value producer', () => {
  it('hands back a bare keyword for EVERY id, badge included', () => {
    // Warm the memo first, so a cached url() would show.
    for (const id of DRAWN) cursorCss(id);

    for (const id of CURSOR_IDS) {
      expect(cursorCss(id, { system: true })).toBe(CURSORS[id].fallback);
      // A keyword cursor carries no forbidden badge, so the badge cannot bring an image back.
      expect(cursorCss(id, { forbidden: true, system: true })).toBe(CURSORS[id].fallback);
    }
  });

  it('gives the app its own set back when the preference goes off', () => {
    for (const id of DRAWN) cursorCss(id, { system: true });

    for (const id of DRAWN) {
      expect(cursorCss(id)).toContain('url(');
      // The keyword stays as the fallback after the image.
      expect(cursorCss(id).endsWith(CURSORS[id].fallback)).toBe(true);
    }
  });
});

describe('system cursors: the DOM', () => {
  it('publishes keywords into the four custom properties, and images back', () => {
    const ids = Object.keys(DOM_CURSORS) as DomCursorId[];

    prefer(true);
    for (const id of ids) expect(domProp(id)).toBe(CURSORS[id].fallback);

    prefer(false);
    // `help` has no drawing (the OS help arrow is the design), so its property stays the keyword
    // on either preference; everything else swaps back to its painted image.
    for (const id of ids.filter((i) => i !== 'help')) expect(domProp(id)).toContain('url(');
    expect(domProp('help')).toBe('help');
  });

  it('re-publishes when the store flips, without the component being told', () => {
    // The hook follows the store after mount, not only on it.
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
    expect(localStorage.getItem(PREFS.systemCursors.key)).toBe('1');
    act(() => { useEditorStore.getState().setSystemCursors(false); });
    expect(localStorage.getItem(PREFS.systemCursors.key)).toBe('0');
  });
});

describe('system cursors: the canvas', () => {
  it('repaints the surface even though nothing about the cursor STATE changed', () => {
    // The controller skips a write matching the last resolved value, and the preference changes what
    // an id resolves to without touching the cursor state.
    const el = document.createElement('div');
    registerCursorSurface(el);
    setToolCursor('mountain');
    expect(el.style.cursor).toContain('url(');

    prefer(true);
    expect(el.style.cursor).toBe(CURSORS.mountain.fallback);

    prefer(false);
    expect(el.style.cursor).toContain('url(');
    expect(el.style.cursor).toBe(cursorCss('mountain'));
  });

  it('keeps following the tool while the preference is on', () => {
    const el = document.createElement('div');
    registerCursorSurface(el);
    prefer(true);
    setToolCursor('water');
    expect(el.style.cursor).toBe(CURSORS.water.fallback);
    setToolCursor('place');
    expect(el.style.cursor).toBe(CURSORS.place.fallback);
  });
});
