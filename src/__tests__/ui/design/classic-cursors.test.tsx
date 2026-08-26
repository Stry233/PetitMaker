/**
 * The classic cursor set: the drawn SVG art the app resolves ids to, selected by the
 * `USE_CLASSIC_CURSORS` build constant.
 *
 * What has to hold: the SVG set resolves through the SAME seam the PNG set does, it carries its
 * OWN hotspots (they are a property of the drawing, not of the id), an id the SVG set never had
 * still gets a cursor, and `systemCursors` outranks the constant entirely.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CURSORS, CURSOR_IDS } from '../../../core/runtime/cursor-spec';
import { cursorCss, __clearCursorCssCache } from '../../../assets/cursors/cursor-css';
import {
  classicCursorArt, CLASSIC_CURSOR_SIZE, CLASSIC_HOTSPOTS,
} from '../../../assets/cursors/cursor-art-classic';
import { USE_CLASSIC_CURSORS } from '../../../assets/cursors/cursor-set';
import { publishCursorPreference } from '../../../ui/design/cursors/cursor-vars';

/** Every id that carries art in today's catalogue. `busy` is the OS's to draw in both sets. */
const DRAWN = CURSOR_IDS.filter((id) => CURSORS[id].hasArt);

/** The hotspot and the fallback keyword a resolved value ends with. */
function parse(css: string): { uri: string; hotspot: [number, number]; fallback: string } | null {
  const m = /^url\("([^"]+)"\)\s+(\d+)\s+(\d+),\s*([a-z-]+)$/.exec(css.trimEnd());
  return m === null ? null : { uri: m[1]!, hotspot: [Number(m[2]), Number(m[3])], fallback: m[4]! };
}

/** `cursor-css` rebuilt against a chosen value of the build constant. */
async function seamWith(classic: boolean): Promise<typeof import('../../../assets/cursors/cursor-css')> {
  vi.resetModules();
  vi.doMock('../../../assets/cursors/cursor-set', () => ({ USE_CLASSIC_CURSORS: classic }));
  return await import('../../../assets/cursors/cursor-css');
}

beforeEach(() => {
  publishCursorPreference(false);
  __clearCursorCssCache();
});

afterEach(() => {
  vi.doUnmock('../../../assets/cursors/cursor-set');
  vi.resetModules();
  publishCursorPreference(false);
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
    // A hotspot belongs to a DRAWING, so it travels with it. The two sets are authored at one tile
    // size now, so several numbers coincide, and that is a coincidence of two compositions rather
    // than a shared number: where the drawings genuinely differ, so do the tables. The classic
    // clickable is a POINTING HAND and acts from its fingertip; the pixel one is the plain arrow. The
    // classic marquee is a centred band; the pixel one is the arrow with a band beside it. The
    // classic refusal sign is drawn around a pointer tip; the pixel one is the sign alone.
    expect(CLASSIC_HOTSPOTS.clickable).toEqual([11, 3]);
    expect(CURSORS.clickable.hotspot).toEqual([2, 2]);
    expect(CLASSIC_HOTSPOTS.marquee).toEqual([16, 16]);
    expect(CURSORS.marquee.hotspot).toEqual([2, 2]);
    expect(CLASSIC_HOTSPOTS.blocked).toEqual([2, 2]);
    expect(CURSORS.blocked.hotspot).toEqual([16, 16]);
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
  it('is the alternative, not the set this build ships', () => {
    // The painted set ships; this one stays complete beside it, and the constant is the whole
    // difference between them.
    expect(USE_CLASSIC_CURSORS).toBe(false);
  });

  it('hands back the SVG art and its own hotspot when the constant is on', async () => {
    const seam = await seamWith(true);
    for (const id of DRAWN) {
      const got = parse(seam.cursorCss(id));
      expect(got, id).not.toBeNull();
      expect(got!.uri.startsWith('data:image/svg+xml,'), id).toBe(true);
      expect(got!.hotspot, id).toEqual([...CLASSIC_HOTSPOTS[id]!]);
      expect(got!.fallback, id).toBe(CURSORS[id].fallback);
    }
  });

  it('hands back the generated SVG art and ITS hotspot when the constant is off', () => {
    for (const id of DRAWN) {
      const got = parse(cursorCss(id));
      expect(got, id).not.toBeNull();
      expect(got!.uri, id).toContain(`${id}.svg`);
      expect(got!.hotspot, id).toEqual([...CURSORS[id].hotspot]);
    }
  });

  it('lets system cursors outrank the set', () => {
    publishCursorPreference(true);
    for (const id of CURSOR_IDS) {
      expect(cursorCss(id), id).toBe(CURSORS[id].fallback);
      expect(cursorCss(id, { forbidden: true }), id).toBe(CURSORS[id].fallback);
    }
  });

  it('falls through to the painted busy ring, which the classic set never drew', () => {
    expect(cursorCss('busy')).toContain('busy-0');
  });
});

describe('classic cursors: an id the drawn set never had', () => {
  it('falls back to the painted art and its hotspot rather than going imageless', async () => {
    // The two sets are drawn independently, so a cursor added after the SVG era has no classic
    // shape. With the drawn set selected it must still get a cursor.
    vi.resetModules();
    vi.doMock('../../../assets/cursors/cursor-set', () => ({ USE_CLASSIC_CURSORS: true }));
    vi.doMock('../../../assets/cursors/cursor-art-classic', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../../assets/cursors/cursor-art-classic')>();
      return {
        ...actual,
        classicCursorArt: (id: string, opts?: { forbidden?: boolean }) =>
          (id === 'mountain' ? null : actual.classicCursorArt(id as never, opts)),
      };
    });
    const fresh = await import('../../../assets/cursors/cursor-css');

    const missing = parse(fresh.cursorCss('mountain'))!;
    expect(missing.uri).toContain('mountain.svg');
    expect(missing.hotspot).toEqual([...CURSORS.mountain.hotspot]);

    // Its neighbour, which the drawn set does have, is unaffected.
    expect(parse(fresh.cursorCss('water'))!.uri.startsWith('data:image/svg+xml,')).toBe(true);

    vi.doUnmock('../../../assets/cursors/cursor-art-classic');
    vi.resetModules();
  });
});
