/**
 * The "Classic cursors" preference: the drawn SVG set the app shipped before the pixel art,
 * kept as an alternative rather than a replacement.
 *
 * What has to hold: the SVG set resolves through the SAME seam the PNG set does, it carries its
 * OWN hotspots (they are a property of the drawing, not of the id), an id the SVG set never had
 * still gets a cursor, and `systemCursors` outranks the choice entirely.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from '@testing-library/react';
import { CURSORS, CURSOR_IDS } from '../../core/runtime/cursor-spec';
import { cursorCss, __clearCursorCssCache } from '../../ui/cursors/cursor-css';
import {
  classicCursorArt, CLASSIC_CURSOR_SIZE, CLASSIC_HOTSPOTS,
} from '../../ui/cursors/cursor-art-classic';
import { publishCursorPreference } from '../../ui/cursors/cursor-vars';
import { useEditorStore, CLASSIC_CURSORS_STORAGE_KEY } from '../../state/store';

/** Every id that carries art in today's catalogue. `busy` is the OS's to draw in both sets. */
const DRAWN = CURSOR_IDS.filter((id) => CURSORS[id].hasArt);

/** The hotspot and the fallback keyword a resolved value ends with. */
function parse(css: string): { uri: string; hotspot: [number, number]; fallback: string } | null {
  const m = /^url\("([^"]+)"\)\s+(\d+)\s+(\d+),\s*([a-z-]+)$/.exec(css.trimEnd());
  return m === null ? null : { uri: m[1]!, hotspot: [Number(m[2]), Number(m[3])], fallback: m[4]! };
}

beforeEach(() => {
  publishCursorPreference(false, false);
  __clearCursorCssCache();
});

afterEach(() => {
  publishCursorPreference(false, false);
  useEditorStore.setState({ systemCursors: false, classicCursors: false });
  localStorage.removeItem(CLASSIC_CURSORS_STORAGE_KEY);
});

describe('classic cursor art', () => {
  it('draws every id the catalogue gives art to, and leaves the OS its own', () => {
    for (const id of DRAWN) {
      const art = classicCursorArt(id);
      expect(art, id).not.toBeNull();
      expect(art!.url.startsWith('data:image/svg+xml,'), id).toBe(true);
    }
    expect(classicCursorArt('busy')).toBeNull();
  });

  it('keeps the hotspots the OLD art was drawn around, not today\'s', () => {
    // The pointing cursors were drawn with a tip at their top-left corner; the pixel art puts the
    // block under the pointer instead. A hotspot belongs to a drawing, so it travels with it.
    expect(CLASSIC_HOTSPOTS.mountain).toEqual([2, 2]);
    expect(CURSORS.mountain.hotspot).toEqual([24, 24]);
    expect(CLASSIC_HOTSPOTS.clickable).toEqual([11, 3]);
    for (const id of DRAWN) {
      const [x, y] = classicCursorArt(id)!.hotspot;
      expect(Number.isInteger(x) && Number.isInteger(y), id).toBe(true);
      expect(x >= 0 && x < CLASSIC_CURSOR_SIZE, `${id} hotspot x`).toBe(true);
      expect(y >= 0 && y < CLASSIC_CURSOR_SIZE, `${id} hotspot y`).toBe(true);
    }
  });

  it('emits a URI a double-quoted url() can hold, at the size it was authored', () => {
    for (const id of DRAWN) {
      const { url } = classicCursorArt(id)!;
      // A `"` would close the url() early and leave the element with no cursor at all.
      expect(url, id).not.toContain('"');
      expect(decodeURIComponent(url), id).toContain(`viewBox='0 0 ${CLASSIC_CURSOR_SIZE} ${CLASSIC_CURSOR_SIZE}'`);
    }
  });

  it('composites the refusal badge, which the drawn set never carried in its art', () => {
    for (const id of ['mountain', 'water', 'road', 'eraser', 'place'] as const) {
      expect(classicCursorArt(id, { forbidden: true })!.url, id)
        .not.toBe(classicCursorArt(id)!.url);
    }
    // `blocked` IS the arrow plus the badge, so asking it to refuse must not stamp a second one.
    expect(classicCursorArt('blocked', { forbidden: true })!.url).toBe(classicCursorArt('blocked')!.url);
  });
});

describe('classic cursors: the resolution seam', () => {
  it('hands back the SVG art and its own hotspot when the preference is on', () => {
    publishCursorPreference(false, true);
    const got = parse(cursorCss('mountain'));
    expect(got).not.toBeNull();
    expect(got!.uri.startsWith('data:image/svg+xml,')).toBe(true);
    expect(got!.hotspot).toEqual([...CLASSIC_HOTSPOTS.mountain!]);
    expect(got!.fallback).toBe(CURSORS.mountain.fallback);
  });

  it('leaves the pixel set exactly as it was when the preference is off', () => {
    publishCursorPreference(false, false);
    for (const id of DRAWN) {
      const got = parse(cursorCss(id));
      expect(got, id).not.toBeNull();
      expect(got!.uri, id).toContain(`${id}.png`);
      expect(got!.hotspot, id).toEqual([...CURSORS[id].hotspot]);
    }
  });

  it('lets system cursors outrank the choice', () => {
    publishCursorPreference(true, true);
    for (const id of CURSOR_IDS) {
      expect(cursorCss(id), id).toBe(CURSORS[id].fallback);
      expect(cursorCss(id, { forbidden: true }), id).toBe(CURSORS[id].fallback);
    }
  });

  it('memoises each set separately, so a flip cannot return the other one\'s value', () => {
    publishCursorPreference(false, false);
    const pixel = cursorCss('water');
    publishCursorPreference(false, true);
    const svg = cursorCss('water');
    expect(svg).not.toBe(pixel);
    publishCursorPreference(false, false);
    expect(cursorCss('water')).toBe(pixel);
  });

  it('still answers for a keyword-only cursor', () => {
    publishCursorPreference(false, true);
    expect(cursorCss('busy')).toBe('progress');
  });
});

describe('classic cursors: an id the drawn set never had', () => {
  it('falls back to the pixel art and its hotspot rather than going imageless', async () => {
    // The two sets are drawn independently, so a cursor added after the SVG era has no classic
    // shape. It must still get a cursor.
    vi.resetModules();
    vi.doMock('../../ui/cursors/cursor-art-classic', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../ui/cursors/cursor-art-classic')>();
      return {
        ...actual,
        classicCursorArt: (id: string, opts?: { forbidden?: boolean }) =>
          (id === 'mountain' ? null : actual.classicCursorArt(id as never, opts)),
      };
    });
    const fresh = await import('../../ui/cursors/cursor-css');
    fresh.setClassicCursors(true);

    const missing = parse(fresh.cursorCss('mountain'))!;
    expect(missing.uri).toContain('mountain.png');
    expect(missing.hotspot).toEqual([...CURSORS.mountain.hotspot]);

    // Its neighbour, which the drawn set does have, is unaffected.
    expect(parse(fresh.cursorCss('water'))!.uri.startsWith('data:image/svg+xml,')).toBe(true);

    vi.doUnmock('../../ui/cursors/cursor-art-classic');
    vi.resetModules();
  });
});

describe('classic cursors: the store', () => {
  it('defaults on, and only an explicit opt-out turns it off', async () => {
    const { detectClassicCursors } = await import('../../state/store');
    localStorage.removeItem(CLASSIC_CURSORS_STORAGE_KEY);
    expect(detectClassicCursors()).toBe(true);
    localStorage.setItem(CLASSIC_CURSORS_STORAGE_KEY, '0');
    expect(detectClassicCursors()).toBe(false);
    localStorage.setItem(CLASSIC_CURSORS_STORAGE_KEY, '1');
    expect(detectClassicCursors()).toBe(true);
  });

  it('persists the choice, so a user who prefers it does not re-choose every session', () => {
    act(() => { useEditorStore.getState().setClassicCursors(true); });
    expect(localStorage.getItem(CLASSIC_CURSORS_STORAGE_KEY)).toBe('1');
    expect(useEditorStore.getState().classicCursors).toBe(true);
    act(() => { useEditorStore.getState().setClassicCursors(false); });
    expect(localStorage.getItem(CLASSIC_CURSORS_STORAGE_KEY)).toBe('0');
  });
});
