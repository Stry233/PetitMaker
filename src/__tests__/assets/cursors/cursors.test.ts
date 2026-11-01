import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { CURSORS, CURSOR_IDS, CURSOR_SIZE, FORBIDDABLE, type CursorId } from '../../../assets/cursors/cursor-spec';
import { cursorArt, busyFrame, BADGED_IDS, BUSY_FRAME_COUNT } from '../../../assets/cursors/cursor-art';
import { decodePng } from '../../../io/share/raster/png-raster';

/**
 * One generated SVG per drawing; painted ones embed their 2x render as a data-URI PNG. The files
 * are read off disk because `cursorArt` resolves to a bundler stub under vitest.
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
 * Pixels of a render with alpha above `minAlpha`. The default takes the faint fringe; locating ink
 * wants `SOLID`, since painted art has a soft edge a pixel or two wide.
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

// Keywords every browser understands, shown when the image or hotspot is rejected.
const KEYWORDS = ['default', 'crosshair', 'grab', 'grabbing', 'move', 'copy', 'progress', 'not-allowed', 'pointer', 'all-scroll', 'text', 'help'];

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
    // macOS draws the `move` keyword as a closed hand; `grab` is open at idle and system-mode pan
    // shows `grabbing` only while dragging.
    expect(CURSORS.move.fallback).toBe('grab');
    expect(CURSORS['hand-closed'].fallback).toBe('grabbing');
  });

  it('marks busy as frame-only: no single file, an animated ring, the OS keyword as fallback', () => {
    // Busy has no file of its own: the controller cycles a frame ring, since a static cursor reads
    // as stuck.
    expect(CURSORS.busy.hasArt).toBe(false);
    expect(CURSORS.busy.fallback).toBe('progress');
    // `help` has no drawing; the OS help arrow stands in until the cursor PSD gains a question mark.
    expect(CURSORS.help.hasArt).toBe(false);
    expect(CURSORS.help.fallback).toBe('help');
    for (const id of CURSOR_IDS.filter((i) => i !== 'busy' && i !== 'help')) expect(CURSORS[id].hasArt, id).toBe(true);
  });

  it('only lets cursors whose tool can ANSWER carry the forbidden badge', () => {
    // Pan, orbit, marquee and busy are always legal; `select` refuses nothing; a move's drop cell is
    // unknown until the drag ends and cut validity is per corner; the DOM four are not tool cursors;
    // `blocked` is the sign itself.
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
    // The intrinsic size is the drawn size, and engines drop a custom cursor over 32 CSS px near
    // the viewport edges.
    for (const id of ART_IDS) {
      const svg = svgOf(id);
      expect(svg, id).toContain(`width="${CURSOR_SIZE}" height="${CURSOR_SIZE}"`);
      expect(svg, id).toContain(`viewBox="0 0 ${CURSOR_SIZE * 2} ${CURSOR_SIZE * 2}"`);
    }
    expect(CURSOR_SIZE).toBeLessThanOrEqual(32);
  });

  it('collapses every tool-identity cursor onto the one arrow', () => {
    // The preview cell under the pointer shows the armed tool, so tool cursors share one drawing and
    // hotspot.
    const arrow = svgOf('select');
    for (const id of ['default', 'clickable', 'mountain', 'water', 'road', 'place', 'eraser', 'edge-cut'] as const) {
      expect(svgOf(id) === arrow, `${id} is not the arrow`).toBe(true);
      expect(CURSORS[id].hotspot, id).toEqual([...CURSORS.select.hotspot]);
    }
    // The state cursors are not in it: each says something the preview cell does not.
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
    // The dark glyph is 22 tall at 1x, under the arrow's 26, because an upright reads taller.
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
    // The two alternate within one drag, so they share ink height, top edge and hotspot.
    const box = async (id: CursorId) => {
      const pts = drawn((await embedded(svgOf(id)))[0]!, SOLID);
      return { top: Math.min(...pts.map(([, y]) => y)), bottom: Math.max(...pts.map(([, y]) => y)) };
    };
    const [open, closed] = [await box('hand-open'), await box('hand-closed')];
    // Within one 2x pixel: where the first `SOLID` row falls in the soft edge depends on the resample.
    expect(Math.abs(closed.top - open.top)).toBeLessThanOrEqual(1);
    expect(Math.abs((closed.bottom - closed.top) - (open.bottom - open.top))).toBeLessThanOrEqual(2);
    expect(CURSORS['hand-closed'].hotspot).toEqual([...CURSORS['hand-open'].hotspot]);
  });

  it('keeps every painted drawing near one optical size', async () => {
    // The extractor sets each long side to 30 of the 32 tile (26 for the refusal sign); bands are
    // in 2x pixels.
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
    // Hotspots are in tile pixels, the render is 2x. `move` is covered by the next test.
    for (const id of PAINTED.filter((i) => i !== 'move')) {
      const [hx, hy] = CURSORS[id].hotspot.map((v) => v * 2);
      const pts = drawn((await embedded(svgOf(id)))[0]!);
      const nearest = Math.min(...pts.map(([x, y]) => Math.abs(x - hx!) + Math.abs(y - hy!)));
      expect(nearest, `${id} hotspot is ${nearest}px from anything drawn`).toBeLessThanOrEqual(NEAR);
    }
  });

  it('keeps move\'s hotspot inside the hollow its four arrows leave', async () => {
    // The four arrows leave the centre unpainted, so the hotspot is the middle with ink on all sides.
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
    // The extractor places the badge per silhouette; a `FORBIDDABLE` id missing from its table
    // would refuse with its plain art.
    expect([...BADGED_IDS].sort()).toEqual([...FORBIDDABLE].sort());
  });

  it('uses the badged file only when asked, and it adds the sign beside the untouched drawing', async () => {
    for (const id of FORBIDDABLE) {
      expect(cursorArt(id), id).toContain(`${id}.svg`);
      expect(cursorArt(id, { forbidden: true }), id).toContain(`${id}-forbidden.svg`);
      const [plain, badged] = [svgOf(id), svgOf(`${id}-forbidden`)];
      expect(badged, id).not.toBe(plain);
      // The sign sits at the arrow's right shoulder (18,0 at 1x) beside the plain art, verbatim.
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
    // `blocked` is the sign itself, so `forbidden` changes nothing.
    expect(cursorArt('blocked', { forbidden: true })).toBe(cursorArt('blocked'));
    expect(BADGED_IDS.has('blocked')).toBe(false);
  });

  it('tells the user what a Ctrl+click will do, in the arrow\'s own geometry', () => {
    // The marks are rounded lines like the arrow's gloss, drawn first so the tip wins a shared pixel.
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
    // Below and right of the arrow (12,12 at 1x), drawn first so the arrow wins a shared pixel.
    expect(svg).toContain('<image x="24" y="24"');
    expect(svg.indexOf('<image'), 'the band is over the arrow').toBeLessThan(svg.indexOf('matrix'));
    for (const id of ['select', 'select-add', 'select-remove', 'marquee'] as const) {
      expect(CURSORS[id].hotspot, id).toEqual([...CURSORS.select.hotspot]);
    }
  });
});

describe('cursor CSS', () => {
  it('is an image URL, a hotspot, and a keyword fallback', async () => {
    const { cursorCss } = await import('../../../assets/cursors/cursor-css');
    const css = cursorCss('mountain');
    expect(css.startsWith('url("')).toBe(true);
    const [, hx, hy, fallback] = /"\)\s+(\d+)\s+(\d+),\s*([a-z-]+)$/.exec(css)!;
    expect([Number(hx), Number(hy)]).toEqual([...CURSORS.mountain.hotspot]);
    expect(fallback).toBe(CURSORS.mountain.fallback);
  });

  it('never emits a bare url(), for every id', async () => {
    const { cursorCss } = await import('../../../assets/cursors/cursor-css');
    for (const id of CURSOR_IDS) {
      // An unclosed url() voids the declaration. `busy` answers with a ring frame; `help` has no
      // drawing and resolves to its keyword.
      if (id === 'help') { expect(cursorCss(id)).toBe('help'); continue; }
      expect(cursorCss(id).trimEnd(), id).toMatch(/^url\("[^"]+"\)\s+\d+\s+\d+,\s*[a-z-]+$/);
    }
  });

  it('wraps the url as image-set 1x where the engine reads it in cursor', async () => {
    // Blink and WebKit divide the drawn size by the image-set density and rasterise an SVG at device
    // scale themselves, so only 1x draws the intrinsic size. The prefixed spelling is a fallback.
    const { cursorCss, __resetCursorCssCache } = await import('../../../assets/cursors/cursor-css');
    const supports = vi.fn((_p: string, v: string) => v.startsWith('image-set('));
    vi.stubGlobal('CSS', { supports });
    __resetCursorCssCache();
    expect(cursorCss('mountain')).toMatch(/^image-set\(url\("[^"]+mountain\.svg"\) 1x\) 2 2, crosshair$/);
    expect(supports.mock.calls.map(([p, v]) => (v.includes('image-set') ? v.slice(0, v.indexOf('(')) : p)))
      .toEqual(['image-set', '-moz-appearance']);
    expect(cursorCss('busy')).toMatch(/^image-set\(url\("[^"]+busy-0\.svg"\) 1x\) 2 2, progress$/);

    vi.stubGlobal('CSS', { supports: (_p: string, v: string) => v.startsWith('-webkit-image-set(') });
    __resetCursorCssCache();
    expect(cursorCss('mountain')).toMatch(/^-webkit-image-set\(url\("[^"]+"\) 1x\) 2 2, crosshair$/);
    vi.unstubAllGlobals();
    __resetCursorCssCache();
  });

  it('raises the density to 2x on Gecko alone, where it is a rasterisation hint and not a size', async () => {
    // Gecko sizes a vector cursor intrinsically but rasterises at the declared density, so 1x blurs
    // under the chrome's CSS zoom (Firefox 152 at dpr 2). Only Gecko parses `-moz-appearance`.
    const { cursorCss, __resetCursorCssCache } = await import('../../../assets/cursors/cursor-css');
    vi.stubGlobal('CSS', {
      supports: (p: string, v: string) => v.startsWith('image-set(') || p === '-moz-appearance',
    });
    __resetCursorCssCache();
    expect(cursorCss('mountain')).toMatch(/^image-set\(url\("[^"]+mountain\.svg"\) 2x\) 2 2, crosshair$/);
    // The busy ring swaps frames inside the same wrapper, so the animation survives the density.
    expect(cursorCss('busy', { frame: 2 })).toMatch(/^image-set\(url\("[^"]+busy-2\.svg"\) 2x\) 2 2, progress$/);
    vi.unstubAllGlobals();
    __resetCursorCssCache();
  });

  it('resolves busy to its ring, one frame per ask, wrapping past the last', async () => {
    const { cursorCss, __resetCursorCssCache } = await import('../../../assets/cursors/cursor-css');
    __resetCursorCssCache();
    expect(cursorCss('busy')).toContain('busy-0');
    expect(cursorCss('busy', { frame: 3 })).toContain('busy-3');
    expect(cursorCss('busy', { frame: BUSY_FRAME_COUNT })).toContain('busy-0');
    // The system preference outranks the ring like everything else.
    expect(cursorCss('busy', { system: true, frame: 3 })).toBe('progress');
  });

  it('emits a URL the double-quoted url() can actually hold', async () => {
    // The bundler chooses this string, and a `"` in it would close the url() early.
    const { cursorCss } = await import('../../../assets/cursors/cursor-css');
    for (const id of CURSOR_IDS) {
      const uri = /url\("([^"]*)"\)/.exec(cursorCss(id, { forbidden: true }))?.[1];
      if (uri === undefined) continue;
      expect(uri, id).not.toContain('"');
      expect(uri.length, id).toBeGreaterThan(0);
    }
  });
});
