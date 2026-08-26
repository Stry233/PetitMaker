import { describe, it, expect, vi } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';
import { CURSORS, CURSOR_IDS, CURSOR_SIZE, FORBIDDABLE, type CursorId } from '../../core/runtime/cursor-spec';
import { cursorArt, busyFrame, BADGED_IDS, BUSY_FRAME_COUNT } from '../../assets/cursors/cursor-art';
import { decodePng } from '../../io/share/raster/png-raster';

vi.mock('../../assets/cursors/cursor-art', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../assets/cursors/cursor-art')>();
  // Wraps the real implementation, so the art tests in this file still exercise it; the spy is
  // only there for the memo test to count rebuilds.
  return { ...actual, cursorArt: vi.fn(actual.cursorArt) };
});

// `USE_CLASSIC_CURSORS` picks which of the two sets `cursorCss` resolves an id through. This file
// is the GENERATED set's, so it pins the constant rather than letting the shipped choice decide
// which art these assertions see; `classic-cursors.test.tsx` covers the other side.
vi.mock('../../assets/cursors/cursor-set', () => ({ USE_CLASSIC_CURSORS: false }));

/**
 * The art is one generated SVG per drawing: geometry for the line drawings, and the painted
 * masses embedded as their 2x renders (data-URI PNGs on a `viewBox 0 0 64 64`). These read the
 * SHIPPED files off disk; `cursorArt` resolves to a bundler URL that is a stub under vitest,
 * which is enough to assert WHICH file an id points at, but not what is in it.
 */
const ART_DIR = 'src/assets/cursors';
const svgOf = (stem: string) => readFileSync(`${ART_DIR}/${stem}.svg`, 'utf8');
/** Every raster the file embeds, decoded. The painted drawings carry exactly one each. */
const embedded = async (svg: string) => {
  const out = [];
  for (const [, b64] of svg.matchAll(/href="data:image\/png;base64,([^"]+)"/g)) {
    out.push(await decodePng(Uint8Array.from(atob(b64!), (c) => c.charCodeAt(0))));
  }
  return out;
};
/**
 * Coordinates of every pixel the artist drew in an embedded render. `minAlpha` chooses what
 * counts: the default takes the faintest fringe, which is right for "is anything drawn near
 * here". Locating ink wants SOLID instead — the painted art carries a soft edge a pixel or two
 * outside itself.
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
/** The ids whose whole drawing is an embedded 2x render (the painted masses). */
const PAINTED: readonly CursorId[] = ['move', 'hand-open', 'hand-closed', 'orbit', 'blocked'];
/** How far a hotspot may sit from anything drawn, in the embedded render's 2x pixels. */
const NEAR = 8;

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

  it('falls the move tool back to grab, never to the move keyword', () => {
    // macOS renders the `move` KEYWORD as the closed hand, so under system cursors the tool read
    // as a grip that never releases; grab opens at idle and the controller's system-mode pan
    // closes it (`grabbing`) exactly while the view is being dragged.
    expect(CURSORS.move.fallback).toBe('grab');
    expect(CURSORS['hand-closed'].fallback).toBe('grabbing');
  });

  it('marks busy as frame-only: no single file, an animated ring, the OS keyword as fallback', () => {
    // `hasArt: false` means "no busy.svg of its own" — the art is the frame ring the controller
    // cycles, since a static custom cursor reads as stuck while a long operation runs.
    expect(CURSORS.busy.hasArt).toBe(false);
    expect(CURSORS.busy.fallback).toBe('progress');
    for (const id of CURSOR_IDS.filter((i) => i !== 'busy')) expect(CURSORS[id].hasArt, id).toBe(true);
  });

  it('only lets cursors whose tool can ANSWER carry the forbidden badge', () => {
    // Panning, orbiting, marquee and busy are always legal, and `select` means "nothing here to act
    // on", which is not a refusal. `move` and `edge-cut` cannot answer at hover time either: a
    // move's only refusable fact is the drop cell, unknown until the drag ends, and cut validity is
    // per-CORNER, so there is no single answer for the cell under the pointer. The DOM four are not
    // tool cursors at all, and `blocked` IS the refusal sign.
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
      expect(url, id).toContain(`${id}.svg`);
    }
  });

  it('declares the tile on every file, over the 2x canvas the offsets are stated in', () => {
    // The intrinsic 32 IS the drawn size (an engine rasterises an SVG cursor at the screen's own
    // scale), and both engines drop a custom cursor LARGER than 32 CSS px near the viewport edges
    // (the anti-spoofing rule), so the declared size is load-bearing on both counts.
    for (const id of ART_IDS) {
      const svg = svgOf(id);
      expect(svg, id).toContain(`width="${CURSOR_SIZE}" height="${CURSOR_SIZE}"`);
      expect(svg, id).toContain(`viewBox="0 0 ${CURSOR_SIZE * 2} ${CURSOR_SIZE * 2}"`);
    }
    expect(CURSOR_SIZE).toBeLessThanOrEqual(32);
  });

  it('collapses every tool-identity cursor onto the one arrow', () => {
    // A cursor whose only message is "this tool is armed" has nothing left to say: the preview cell
    // under the pointer carries the tool's own picture. So these are ONE drawing, byte for byte, and
    // switching tools leaves the pointer looking and pointing exactly where it was.
    const arrow = svgOf('select');
    for (const id of ['default', 'clickable', 'mountain', 'water', 'road', 'place', 'eraser', 'edge-cut'] as const) {
      expect(svgOf(id) === arrow, `${id} is not the arrow`).toBe(true);
      expect(CURSORS[id].hotspot, id).toEqual([...CURSORS.select.hotspot]);
    }
    // The state cursors are NOT in it: each says something the preview cell does not.
    for (const id of ['hand-open', 'hand-closed', 'move', 'marquee', 'text', 'orbit', 'blocked'] as const) {
      expect(svgOf(id) === arrow, `${id} lost its own drawing`).toBe(false);
    }
  });

  it('draws the arrow as geometry: paths and a gloss line, no raster at all', () => {
    const svg = svgOf('select');
    expect(svg).not.toContain('<image');
    expect((svg.match(/<path /g) ?? []).length).toBe(2);
    expect(svg).toContain('stroke-linejoin="round"');
    expect(svg).toContain('<line ');
  });

  it('ships the busy ring as distinct frames, each the arrow with the spinner advanced', () => {
    expect(BUSY_FRAME_COUNT).toBeGreaterThanOrEqual(4);
    const arrowBody = svgOf('select').replace(/^<svg[^>]*>/, '').replace('</svg>', '');
    const frames = Array.from({ length: BUSY_FRAME_COUNT }, (_, n) => svgOf(`busy-${n}`));
    expect(new Set(frames).size, 'every frame differs').toBe(frames.length);
    for (const [n, frame] of frames.entries()) {
      expect(frame, `frame ${n} carries the arrow`).toContain(arrowBody);
      expect((frame.match(/<circle /g) ?? []).length, `frame ${n} ring`).toBe(BUSY_FRAME_COUNT);
    }
    // The resolver wraps: any frame number lands on a shipped file.
    expect(busyFrame(0)).toContain('busy-0');
    expect(busyFrame(BUSY_FRAME_COUNT + 1)).toContain('busy-1');
  });

  it('draws the I-beam from rectangles alone, so no raster scale softens its stem', () => {
    const svg = svgOf('text');
    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('<path');
    // The dark glyph's rectangles: bbox height is the ink height (22) on the 2x canvas, and it no
    // longer towers over the arrow (whose box is 26): an upright reads taller than anything else
    // of its height.
    const inks = [...svg.matchAll(/<rect x="(-?\d+)" y="(-?\d+)" width="(\d+)" height="(\d+)" fill="#634b49"/g)]
      .map((m) => m.slice(1, 5).map(Number) as [number, number, number, number]);
    expect(inks.length).toBe(3);
    const top = Math.min(...inks.map(([, y]) => y));
    const bottom = Math.max(...inks.map(([, y, , h]) => y + h));
    expect(bottom - top).toBe(22 * 2);
    expect(bottom - top).toBeLessThanOrEqual(26 * 2);
  });

  it('embeds exactly one painted render in each painted cursor, with something drawn on it', async () => {
    for (const id of PAINTED) {
      const imgs = await embedded(svgOf(id));
      expect(imgs.length, id).toBe(1);
      expect(drawn(imgs[0]!).length, `${id} is blank`).toBeGreaterThan(80);
      expect([imgs[0]!.width, imgs[0]!.height], id).toEqual([CURSOR_SIZE * 2, CURSOR_SIZE * 2]);
    }
  });

  it('draws the hand at one size whether it is open or closed', async () => {
    // The two ALTERNATE inside a single drag, so they are normalised together: sized apart, the
    // wider open hand was scaled down further and the hand jumped a fifth larger as the grip took
    // hold. Same ink height, same top edge, and the same hotspot.
    const box = async (id: CursorId) => {
      const pts = drawn((await embedded(svgOf(id)))[0]!, SOLID);
      return { top: Math.min(...pts.map(([, y]) => y)), bottom: Math.max(...pts.map(([, y]) => y)) };
    };
    const [open, closed] = [await box('hand-open'), await box('hand-closed')];
    // Within one 2x pixel: the pair shares one evened 1x box, and where the first SOLID row lands
    // inside the render's soft edge is the resample's to decide.
    expect(Math.abs(closed.top - open.top)).toBeLessThanOrEqual(1);
    expect(Math.abs((closed.bottom - closed.top) - (open.bottom - open.top))).toBeLessThanOrEqual(2);
    expect(CURSORS['hand-closed'].hotspot).toEqual([...CURSORS['hand-open'].hotspot]);
  });

  it('keeps every painted drawing near one optical size', async () => {
    // Each drawing's INK is normalised to a common long side by the extractor (30 of the 32 tile,
    // 26 for the refusal sign, which is a SIGN rather than a picture) — read here off the
    // embedded 2x renders.
    const band: Partial<Record<CursorId, [number, number]>> = {
      blocked: [48, 56],
    };
    for (const id of ['move', 'hand-open', 'blocked', 'orbit'] as const) {
      const pts = drawn((await embedded(svgOf(id)))[0]!, SOLID);
      const w = Math.max(...pts.map(([x]) => x)) - Math.min(...pts.map(([x]) => x)) + 1;
      const h = Math.max(...pts.map(([, y]) => y)) - Math.min(...pts.map(([, y]) => y)) + 1;
      const [lo, hi] = band[id] ?? [56, 62];
      expect(Math.max(w, h), `${id} long side`).toBeGreaterThanOrEqual(lo);
      expect(Math.max(w, h), `${id} long side`).toBeLessThanOrEqual(hi);
    }
  });

  it('puts every painted hotspot on the art it belongs to', async () => {
    // The hotspot is the pixel the drawing acts from, so it has to be ON the drawing; hotspots are
    // in tile pixels and the embedded render is the 2x canvas. `move` is the one deliberate
    // exception, held by the test below.
    for (const id of PAINTED.filter((i) => i !== 'move')) {
      const [hx, hy] = CURSORS[id].hotspot.map((v) => v * 2);
      const pts = drawn((await embedded(svgOf(id)))[0]!);
      const nearest = Math.min(...pts.map(([x, y]) => Math.abs(x - hx!) + Math.abs(y - hy!)));
      expect(nearest, `${id} hotspot is ${nearest}px from anything drawn`).toBeLessThanOrEqual(NEAR);
    }
  });

  it('keeps move\'s hotspot inside the hollow its four arrows leave', async () => {
    // Four arrows pointing AT the point they act from, so the centre is inside the drawing and
    // painted by none of it. What can be asked is that the hotspot is the middle, and that the
    // drawing surrounds it on all four sides.
    const [hx, hy] = CURSORS.move.hotspot;
    expect([hx, hy]).toEqual([CURSOR_SIZE / 2, CURSOR_SIZE / 2]);
    const img = (await embedded(svgOf('move')))[0]!;
    const pts = drawn(img, SOLID);
    const [cx, cy] = [hx * 2, hy * 2];
    for (const [name, has] of [
      ['above', pts.some(([x, y]) => y < cy && Math.abs(x - cx) < 8)],
      ['below', pts.some(([x, y]) => y > cy && Math.abs(x - cx) < 8)],
      ['left', pts.some(([x, y]) => x < cx && Math.abs(y - cy) < 8)],
      ['right', pts.some(([x, y]) => x > cx && Math.abs(y - cy) < 8)],
    ] as const) {
      expect(has, `move draws nothing ${name} of its hotspot`).toBe(true);
    }
  });

  it('draws a badged variant for exactly the cursors that can refuse', () => {
    // The badge is composited at an offset chosen per silhouette, so a cursor entering FORBIDDABLE
    // without an entry in the extractor's table would silently show its plain self when refusing.
    expect([...BADGED_IDS].sort()).toEqual([...FORBIDDABLE].sort());
  });

  it('uses the badged file only when asked, and it adds the sign beside the untouched drawing', async () => {
    for (const id of FORBIDDABLE) {
      expect(cursorArt(id), id).toContain(`${id}.svg`);
      expect(cursorArt(id, { forbidden: true }), id).toContain(`${id}-forbidden.svg`);
      const [plain, badged] = [svgOf(id), svgOf(`${id}-forbidden`)];
      expect(badged, id).not.toBe(plain);
      // The badge is the sign IMAGE placed against the arrow's right shoulder (18,0 at 1x); the
      // drawing itself is untouched, so the plain art appears verbatim inside the badged file.
      expect(badged, id).toContain('<image x="36" y="0"');
      const arrowBody = plain.replace(/^<svg[^>]*>/, '').replace('</svg>', '');
      expect(badged, `${id}'s badge covers its own art`).toContain(arrowBody);
      const sign = (await embedded(badged))[0]!;
      expect(drawn(sign, SOLID).length, `${id}'s badge is too small to read`).toBeGreaterThan(60);
    }
    // A keyword-only cursor has nothing to badge.
    expect(cursorArt('busy', { forbidden: true })).toBeNull();
  });

  it('never reaches for a second badge on art that already refuses', () => {
    // `blocked` IS the refusal sign, so asking it for `forbidden` must be a no-op rather than
    // looking up a doubly-badged file that does not exist.
    expect(cursorArt('blocked', { forbidden: true })).toBe(cursorArt('blocked'));
    expect(BADGED_IDS.has('blocked')).toBe(false);
  });

  it('tells the user what a Ctrl+click will do, in the arrow\'s own geometry', () => {
    // Without distinct art, holding Ctrl looks identical to not holding it. The marks are rounded
    // lines like the arrow's gloss, drawn UNDER the arrow so a contended pixel goes to the tip.
    const [add, remove] = [svgOf('select-add'), svgOf('select-remove')];
    expect(add).not.toBe(remove);
    for (const [name, svg, lines] of [['add', add, 4], ['remove', remove, 2]] as const) {
      expect(svg, name).not.toContain('<image');
      expect((svg.match(/<line /g) ?? []).length, name).toBe(lines + 1); // + the arrow's gloss
      expect(svg.indexOf('<g transform="translate'), `${name}'s mark is over the arrow`)
        .toBeLessThan(svg.indexOf('matrix'));
    }
    expect(FORBIDDABLE.has('select-add')).toBe(false);
    expect(FORBIDDABLE.has('select-remove')).toBe(false);
  });

  it('drags the band under the marquee\'s arrow', async () => {
    const svg = svgOf('marquee');
    const band = await embedded(svg);
    expect(band.length).toBe(1);
    // Below and right of the arrow (12,12 at 1x), and painted first so the arrow wins a contended
    // pixel.
    expect(svg).toContain('<image x="24" y="24"');
    expect(svg.indexOf('<image'), 'the band is over the arrow').toBeLessThan(svg.indexOf('matrix'));
    for (const id of ['select', 'select-add', 'select-remove', 'marquee'] as const) {
      expect(CURSORS[id].hotspot, id).toEqual([...CURSORS.select.hotspot]);
    }
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
      // A closed url(), then the hotspot, then the mandatory keyword. An unclosed url()
      // makes the whole declaration invalid and the element gets no cursor at all. `busy` is in
      // it too: no file of its own, but the ring's frames answer through the same shape.
      expect(cursorCss(id).trimEnd(), id).toMatch(/^url\("[^"]+"\)\s+\d+\s+\d+,\s*[a-z-]+$/);
    }
  });

  it('wraps the url as image-set 1x where the engine reads it in cursor', async () => {
    // Blink and WebKit draw a cursor at natural size DIVIDED by the image-set density and
    // rasterise an SVG at the device scale on their own, so 1x is the one density that leaves the
    // intrinsic 32 drawn at 32 CSS px on every screen. The prefixed spelling is asked for only
    // where the plain one is refused.
    const { cursorCss, __clearCursorCssCache } = await import('../../assets/cursors/cursor-css');
    const supports = vi.fn((_p: string, v: string) => v.startsWith('image-set('));
    vi.stubGlobal('CSS', { supports });
    __clearCursorCssCache();
    expect(cursorCss('mountain')).toMatch(/^image-set\(url\("[^"]+mountain\.svg"\) 1x\) 2 2, crosshair$/);
    expect(supports.mock.calls.map(([p, v]) => (v.includes('image-set') ? v.slice(0, v.indexOf('(')) : p)))
      .toEqual(['image-set', '-moz-appearance']);
    expect(cursorCss('busy')).toMatch(/^image-set\(url\("[^"]+busy-0\.svg"\) 1x\) 2 2, progress$/);

    vi.stubGlobal('CSS', { supports: (_p: string, v: string) => v.startsWith('-webkit-image-set(') });
    __clearCursorCssCache();
    expect(cursorCss('mountain')).toMatch(/^-webkit-image-set\(url\("[^"]+"\) 1x\) 2 2, crosshair$/);
    vi.unstubAllGlobals();
    __clearCursorCssCache();
  });

  it('raises the density to 2x on Gecko alone, where it is a rasterisation hint and not a size', async () => {
    // Gecko sizes a vector cursor at its intrinsic width whatever the density, and rasterises at
    // the declared density: a 1x goes soft wherever the hovered element stands under CSS zoom,
    // which the app's chrome always does (probed: Firefox 152 at dpr 2). Gecko is the one
    // engine that parses the -moz-appearance alias, which is how the seam tells it apart.
    const { cursorCss, __clearCursorCssCache } = await import('../../assets/cursors/cursor-css');
    vi.stubGlobal('CSS', {
      supports: (p: string, v: string) => v.startsWith('image-set(') || p === '-moz-appearance',
    });
    __clearCursorCssCache();
    expect(cursorCss('mountain')).toMatch(/^image-set\(url\("[^"]+mountain\.svg"\) 2x\) 2 2, crosshair$/);
    // The busy ring swaps frames inside the same wrapper, so the animation survives the density.
    expect(cursorCss('busy', { frame: 2 })).toMatch(/^image-set\(url\("[^"]+busy-2\.svg"\) 2x\) 2 2, progress$/);
    vi.unstubAllGlobals();
    __clearCursorCssCache();
  });

  it('resolves busy to its ring, one frame per ask, wrapping past the last', async () => {
    const { cursorCss, __clearCursorCssCache } = await import('../../assets/cursors/cursor-css');
    __clearCursorCssCache();
    expect(cursorCss('busy')).toContain('busy-0');
    expect(cursorCss('busy', { frame: 3 })).toContain('busy-3');
    expect(cursorCss('busy', { frame: BUSY_FRAME_COUNT })).toContain('busy-0');
    // The system preference outranks the ring like everything else.
    expect(cursorCss('busy', { system: true, frame: 3 })).toBe('progress');
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
    const { cursorArt: spiedArt } = await import('../../assets/cursors/cursor-art');
    const spy = vi.mocked(spiedArt);
    __clearCursorCssCache();
    spy.mockClear();
    cursorCss('water');
    cursorCss('water');
    expect(spy).toHaveBeenCalledTimes(1); // the second call came from the cache
    cursorCss('water', { forbidden: true });
    expect(spy).toHaveBeenCalledTimes(2); // a different key is a different entry
  });
});
