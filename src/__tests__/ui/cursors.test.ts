import { describe, it, expect, vi } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';
import { CURSORS, CURSOR_IDS, CURSOR_SIZE, FORBIDDABLE, type CursorId } from '../../core/runtime/cursor-spec';
import { cursorArt, BADGED_IDS } from '../../assets/cursors/cursor-art';
import { decodePng } from '../../io/share/raster/png-raster';

vi.mock('../../assets/cursors/cursor-art', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../assets/cursors/cursor-art')>();
  // Wraps the real implementation, so the art tests in this file still exercise it; the spy is
  // only there for the memo test to count rebuilds.
  return { ...actual, cursorArt: vi.fn(actual.cursorArt) };
});

// `USE_CLASSIC_CURSORS` picks which of the two sets `cursorCss` resolves an id through. This file
// is the PIXEL set's, so it pins the constant rather than letting the shipped choice decide which
// art these assertions see; `classic-cursors.test.tsx` covers the other side.
vi.mock('../../assets/cursors/cursor-set', () => ({ USE_CLASSIC_CURSORS: false }));

/**
 * The art is raster now, so these read the SHIPPED PNGs off disk rather than inspecting a
 * generated string. `cursorArt` resolves to a bundler URL that is a stub under vitest, which is
 * enough to assert WHICH file an id points at, but not what is in it.
 */
const ART_DIR = 'src/assets/cursors';
const pixels = async (stem: string) => decodePng(new Uint8Array(readFileSync(`${ART_DIR}/${stem}.png`)));
/**
 * Coordinates of every pixel the artist drew. `minAlpha` chooses what counts: the default takes
 * the faintest fringe, which is right for "is anything drawn near here". Locating an APEX wants
 * SOLID instead — the art is rendered to its shipped size by area-averaging, so a shape carries a
 * soft edge a pixel outside itself, and the faint threshold would put every apex there.
 */
function drawn(img: { width: number; data: Uint8Array }, minAlpha = 8): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 3; i < img.data.length; i += 4) {
    if (img.data[i]! > minAlpha) out.push([((i - 3) / 4) % img.width, Math.floor((i - 3) / 4 / img.width)]);
  }
  return out;
}
const SOLID = 128;
const ART_IDS = CURSOR_IDS.filter((id) => CURSORS[id].hasArt);
/** One pixel of the 32px source art, in shipped-image pixels, so these hold at any scale. */
const PX = CURSOR_SIZE / 32;
const samePixels = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

// Keyword cursors a browser is guaranteed to understand: what the user gets if our image or
// hotspot is ever rejected.
const KEYWORDS = ['default', 'crosshair', 'grab', 'grabbing', 'move', 'copy', 'progress', 'not-allowed', 'pointer', 'all-scroll', 'text'];

describe('cursor catalogue', () => {
  it('describes every id exactly once', () => {
    expect(CURSOR_IDS.length).toBe(new Set(CURSOR_IDS).size);
    expect(Object.keys(CURSORS).sort()).toEqual([...CURSOR_IDS].sort());
  });

  it('puts every hotspot inside the image', () => {
    for (const id of CURSOR_IDS) {
      const [x, y] = CURSORS[id].hotspot;
      const size = CURSORS[id].size ?? CURSOR_SIZE;
      expect(Number.isInteger(x) && Number.isInteger(y), id).toBe(true);
      expect(x >= 0 && x < size, `${id} hotspot x`).toBe(true);
      expect(y >= 0 && y < size, `${id} hotspot y`).toBe(true);
    }
  });

  it('gives every id a real keyword fallback', () => {
    for (const id of CURSOR_IDS) expect(KEYWORDS, id).toContain(CURSORS[id].fallback);
  });

  it('marks busy as keyword-only, since a spinner cursor is the OS\'s job', () => {
    expect(CURSORS.busy.hasArt).toBe(false);
    expect(CURSORS.busy.fallback).toBe('progress');
    for (const id of CURSOR_IDS.filter((i) => i !== 'busy')) expect(CURSORS[id].hasArt, id).toBe(true);
  });

  it('only lets cursors whose tool can ANSWER carry the forbidden badge', () => {
    // Panning, orbiting, marquee and busy are always legal, and `select` means "nothing here to act
    // on", which is not a refusal. `move` and `edge-cut` cannot answer at hover time either: a
    // move's only refusable fact is the drop cell, unknown until the drag ends, and cut validity is
    // per-CORNER, so there is no single answer for the cell under the pointer. The DOM four are not
    // tool cursors at all, and `blocked` draws the badge itself.
    for (const id of ['hand-open', 'hand-closed', 'orbit', 'marquee', 'busy', 'select', 'move', 'edge-cut',
      'default', 'clickable', 'blocked', 'text'] as const) {
      expect(FORBIDDABLE.has(id), id).toBe(false);
    }
    for (const id of ['mountain', 'water', 'road', 'eraser', 'place'] as const) {
      expect(FORBIDDABLE.has(id), id).toBe(true);
    }
  });
});

describe('cursor art', () => {
  it('points every id that claims art at its own file, and keyword-only ids at nothing', () => {
    for (const id of CURSOR_IDS) {
      const url = cursorArt(id);
      if (!CURSORS[id].hasArt) { expect(url, id).toBeNull(); continue; }
      expect(url, id).toContain(`${id}.png`);
    }
  });

  it('ships every referenced image at its catalogue size, with something drawn on it', async () => {
    for (const id of ART_IDS) {
      const img = await pixels(id);
      const want = CURSORS[id].size ?? CURSOR_SIZE;
      expect([img.width, img.height], id).toEqual([want, want]);
      expect(drawn(img).length, `${id} is blank`).toBeGreaterThan(20);
    }
  });

  it('draws a badged variant for exactly the cursors that can refuse', () => {
    // The badge is hand-placed per silhouette rather than composited, so a cursor entering
    // FORBIDDABLE without new art would silently show its plain self when refusing.
    expect([...BADGED_IDS].sort()).toEqual([...FORBIDDABLE].sort());
  });

  it('uses the badged file only when asked, and it differs from the plain one', async () => {
    for (const id of FORBIDDABLE) {
      expect(cursorArt(id), id).toContain(`${id}.png`);
      expect(cursorArt(id, { forbidden: true }), id).toContain(`${id}-forbidden.png`);
      const [plain, barred] = [await pixels(id), await pixels(`${id}-forbidden`)];
      expect(samePixels(plain.data, barred.data), `${id} badged == plain`).toBe(false);
    }
    // A keyword-only cursor has nothing to badge.
    expect(cursorArt('busy', { forbidden: true })).toBeNull();
  });

  it('never reaches for a second badge on art that already refuses', () => {
    // `blocked` IS the arrow-plus-badge, so asking it for `forbidden` must be a no-op rather
    // than looking up a doubly-badged file that does not exist.
    expect(cursorArt('blocked', { forbidden: true })).toBe(cursorArt('blocked'));
    expect(BADGED_IDS.has('blocked')).toBe(false);
  });

  it('puts every hotspot on the art it belongs to', async () => {
    // The hotspot is the pixel the drawing acts from, so it has to be ON the drawing. `move` is
    // the one deliberate exception: a four-way arrow is hollow at its centre, which is exactly
    // where it acts from, so nearby is the most that can be asked.
    for (const id of ART_IDS) {
      const [hx, hy] = CURSORS[id].hotspot;
      const pts = drawn(await pixels(id));
      const nearest = Math.min(...pts.map(([x, y]) => Math.abs(x - hx) + Math.abs(y - hy)));
      expect(nearest, `${id} hotspot (${hx},${hy}) is ${nearest}px from anything drawn`).toBeLessThanOrEqual(3 * PX);
    }
  });

  it('points the badged selection arrows at the same pixel as the plain one', async () => {
    // These three are ONE cursor with a mark added, and the app swaps between them as a modifier
    // goes down under a STANDING pointer. The PSD drew the badged two with the arrow 4px lower and
    // clipped where the mark crossed it, so the tip moved and the shape changed mid-gesture; the
    // extractor composes them from `select`'s own arrow instead. Same hotspot, same apex, and the
    // apex IS the hotspot.
    const apex = async (id: CursorId): Promise<[number, number]> => {
      const pts = drawn(await pixels(id), SOLID);
      const top = Math.min(...pts.map(([, y]) => y));
      return [Math.min(...pts.filter(([, y]) => y === top).map(([x]) => x)), top];
    };
    const family: CursorId[] = ['select', 'select-add', 'select-remove', 'marquee'];
    for (const id of family) {
      expect(CURSORS[id].hotspot, id).toEqual([...CURSORS.select.hotspot]);
    }
    // `select` carries nothing above its arrow, so its topmost solid pixel IS the tip.
    expect(await apex('select')).toEqual([...CURSORS.select.hotspot]);
    // Every other arrow cursor acts from its OWN tip, wherever its composition puts it — pinned
    // by the "hotspot on the art" test above rather than by a shared number.
    expect(await apex('default')).toEqual([...CURSORS.default.hotspot]);
  });

  it('tells the user what a Ctrl+click will do', async () => {
    // Without distinct art, holding Ctrl looks identical to not holding it.
    expect(cursorArt('select-add')).not.toBe(cursorArt('select-remove'));
    expect(FORBIDDABLE.has('select-add')).toBe(false);
    expect(FORBIDDABLE.has('select-remove')).toBe(false);
    const [add, remove] = [await pixels('select-add'), await pixels('select-remove')];
    expect(samePixels(add.data, remove.data)).toBe(false);
  });
});

describe('cursor CSS', () => {
  it('is an image URL, a hotspot, and a keyword fallback', async () => {
    const { cursorCss } = await import('../../assets/cursors/cursor-css');
    const css = cursorCss('mountain');
    expect(css.startsWith('url("')).toBe(true);
    const [, hx, hy, fallback] = /"\)\s+(\d+)\s+(\d+),\s*([a-z-]+)$/.exec(css)!;
    expect([Number(hx), Number(hy)]).toEqual([...CURSORS.mountain.hotspot]);
    expect(fallback).toBe(CURSORS.mountain.fallback);
  });

  it('never emits a bare url(), for every id', async () => {
    const { cursorCss } = await import('../../assets/cursors/cursor-css');
    for (const id of CURSOR_IDS) {
      const css = cursorCss(id).trimEnd();
      if (CURSORS[id].hasArt) {
        // A closed url(), then the hotspot, then the mandatory keyword. An unclosed url()
        // makes the whole declaration invalid and the element gets no cursor at all.
        expect(css, id).toMatch(/^url\("[^"]+"\)\s+\d+\s+\d+,\s*[a-z-]+$/);
      } else {
        // Keyword-only: the value IS the fallback, exactly.
        expect(css, id).toBe(CURSORS[id].fallback);
      }
    }
  });

  it('returns the keyword alone for a keyword-only cursor', async () => {
    const { cursorCss } = await import('../../assets/cursors/cursor-css');
    expect(cursorCss('busy')).toBe('progress');
  });

  it('emits a URL the double-quoted url() can actually hold', async () => {
    // A `"` would close the url() early and invalidate the whole declaration, leaving the
    // element with no cursor at all; the bundler decides this string, so it is worth asserting.
    const { cursorCss } = await import('../../assets/cursors/cursor-css');
    for (const id of CURSOR_IDS) {
      const uri = /url\("([^"]*)"\)/.exec(cursorCss(id, { forbidden: true }))?.[1];
      if (uri === undefined) continue;
      expect(uri, id).not.toContain('"');
      expect(uri.length, id).toBeGreaterThan(0);
    }
  });

  it('memoises, so a pointer-move cannot rebuild a value', async () => {
    const { cursorCss, __clearCursorCssCache } = await import('../../assets/cursors/cursor-css');
    const { cursorArt } = await import('../../assets/cursors/cursor-art');
    const spy = vi.mocked(cursorArt);
    __clearCursorCssCache();
    spy.mockClear();
    cursorCss('water');
    cursorCss('water');
    expect(spy).toHaveBeenCalledTimes(1); // the second call came from the cache
    cursorCss('water', { forbidden: true });
    expect(spy).toHaveBeenCalledTimes(2); // a different key is a different entry
  });
});
