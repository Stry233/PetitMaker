// src/__tests__/io/export/compose.test.ts
import { describe, it, expect } from 'vitest';
import { GRID_COLS } from '../../../io/share/glyph/geometry';
import { computeComposition, fitAspect, RESOLUTION_WIDTHS, BASE_WIDTH, PAD, type ExportOptions, type Rect } from '../../../io/export/compose';

const base: ExportOptions = { title: '', description: '', preset: 'plain', importable: false, showBadge: false, layerPreview: false, card3d: false, grid: true, annotations: true, footer: false, footerTemplate: '{date}{fill} · {dims}', resolution: 'standard' };
function overlaps(a: Rect, b: Rect) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }

describe('computeComposition', () => {
  it('bare options → just a map band, no header/layerCol/card/footer', () => {
    const c = computeComposition(base, 1.2, [], { layerCount: 1 });
    expect(c.header).toBeUndefined();
    expect(c.layerCol).toBeUndefined();
    expect(c.card3d).toBeUndefined();
    expect(c.footer).toBeUndefined();
    expect(c.map.w).toBeGreaterThan(0);
  });
  it('bare export IS the map plus the maker band: no card margins', () => {
    const c = computeComposition({ ...base, grid: false }, 1.2, [], { layerCount: 1 });
    expect(c.bare).toBe(true);
    expect(c.map.x).toBe(0);
    expect(c.map.y).toBe(0);
    expect(c.map.w).toBe(c.width);
    expect(Math.abs(c.map.h - c.width / 1.2)).toBeLessThanOrEqual(1);
    // The maker band spans the full width right under the map and closes the canvas.
    expect(c.brand.x).toBe(0);
    expect(c.brand.w).toBe(c.width);
    expect(c.brand.y).toBe(c.map.h);
    expect(c.height).toBe(c.brand.y + c.brand.h);
  });
  it('bare with the grid on keeps only the legend gutters', () => {
    const c = computeComposition(base, 1.2, [], { layerCount: 1 });
    expect(c.bare).toBe(true);
    expect(c.map.w).toBe(c.width);
    // Taller than the gridless bare map band: the legend's own gutters, nothing else.
    expect(c.map.h).toBeGreaterThan(Math.round(c.width / 1.2));
  });
  it('the maker band stands LAST on every export, code band included', () => {
    for (const extra of [{}, { footer: true }, { importable: true, footer: true }] as const) {
      const c = computeComposition({ ...base, ...extra }, 1.2, [], { layerCount: 1 });
      for (const band of [c.map, c.header, c.card3d, c.codeBand, c.footer]) {
        if (band) expect(c.brand.y).toBeGreaterThanOrEqual(band.y + band.h);
      }
      expect(c.brand.y + c.brand.h).toBeLessThanOrEqual(c.height);
    }
  });
  it('any extra band brings the card chrome back', () => {
    for (const extra of [{ footer: true }, { layerPreview: true }, { card3d: true }, { importable: true }, { title: 'Hexia' }] as const) {
      const c = computeComposition({ ...base, ...extra }, 1.2, [], { layerCount: 1 });
      expect(c.bare).toBeUndefined();
      expect(c.map.x).toBeGreaterThan(0);
    }
  });
  it('without the layer strip the band follows the map aspect: no wide side margins', () => {
    // The footer keeps the composition non-bare while the map retains its 1.2 aspect.
    const c = computeComposition({ ...base, footer: true, grid: false }, 1.2, [], { layerCount: 1 });
    const innerW = c.map.w;
    expect(Math.abs(c.map.h - innerW / 1.2)).toBeLessThanOrEqual(2);
  });
  it('nothing overlaps the map band', () => {
    const o: ExportOptions = { ...base, title: 'Hexia', description: 'desc', showBadge: true, layerPreview: true, card3d: true, footer: true };
    const c = computeComposition(o, 1.2, [{ label: 'prov.badge_ai', color: '#8E7BD6' }], { layerCount: 5 });
    for (const band of [c.header, c.card3d, c.footer] as (Rect | undefined)[]) if (band) expect(overlaps(c.map, band)).toBe(false);
    // layerCol is to the RIGHT of map — not overlapping
    if (c.layerCol) expect(overlaps(c.map, c.layerCol)).toBe(false);
  });
  it('layer-preview / 3D / footer options each add their element', () => {
    expect(computeComposition({ ...base, layerPreview: true }, 1.2, [], { layerCount: 3 }).layerCol).toBeDefined();
    expect(computeComposition({ ...base, card3d: true }, 1.2, [], { layerCount: 1 }).card3d).toBeDefined();
    expect(computeComposition({ ...base, footer: true }, 1.2, [], { layerCount: 1 }).footer).toBeDefined();
  });
  it('empty title+description+badge → no header band (no reserved gap)', () => {
    const c = computeComposition({ ...base, title: '', description: '', showBadge: false }, 1.2, [], { layerCount: 1 });
    expect(c.header).toBeUndefined();
  });
  it('resolution drives output width', () => {
    const lo = computeComposition({ ...base, resolution: 'compact' }, 1.2, [], { layerCount: 1 });
    const hi = computeComposition({ ...base, resolution: 'high' }, 1.2, [], { layerCount: 1 });
    expect(hi.width).toBe(RESOLUTION_WIDTHS.high);
    expect(lo.width).toBe(RESOLUTION_WIDTHS.compact);
    expect(hi.width).toBeGreaterThan(lo.width);
  });
  it('scale = width / BASE_WIDTH', () => {
    const c = computeComposition({ ...base, resolution: 'standard' }, 1.2, [], { layerCount: 1 });
    expect(c.scale).toBeCloseTo(RESOLUTION_WIDTHS.standard / BASE_WIDTH, 5);
  });
  it('the map is a healthy fraction of the composition height (~40-60%)', () => {
    const o: ExportOptions = { ...base, title: 'Hexia', description: 'desc', showBadge: true, layerPreview: true, card3d: true, footer: true };
    const c = computeComposition(o, 1.2, [{ label: 'prov.badge_ai', color: '#8E7BD6' }], { layerCount: 5 });
    expect(c.map.h / c.height).toBeGreaterThan(0.30);
    expect(c.map.h / c.height).toBeLessThan(0.70);
  });
  it('layer column (label strip + thumbnails) is to the right of the map and spans its height', () => {
    const o: ExportOptions = { ...base, layerPreview: true };
    const c = computeComposition(o, 1.2, [], { layerCount: 4 });
    expect(c.layerCol).toBeDefined();
    expect(c.layerLabel).toBeDefined();
    // Both sit to the right of the map.
    expect(c.layerLabel!.x).toBeGreaterThan(c.map.x + c.map.w - 1);
    expect(c.layerCol!.x).toBeGreaterThan(c.map.x + c.map.w - 1);
    // label strip on top of the thumbnails, aligned to the map top.
    expect(c.layerLabel!.y).toBe(c.map.y);
    expect(c.layerCol!.y).toBeGreaterThan(c.layerLabel!.y);
    // label + thumbnails together span the full map height, and share its bottom.
    expect(c.layerLabel!.h + c.layerCol!.h).toBe(c.map.h);
    expect(c.layerCol!.y + c.layerCol!.h).toBe(c.map.y + c.map.h);
  });
  it('share-code band reserves an in-bounds band above the footer (only when importable)', () => {
    const off = computeComposition({ ...base, footer: true, resolution: 'high' }, 1.2, [], { layerCount: 1 });
    expect(off.codeBand).toBeUndefined(); // base is not importable → no band

    const on: ExportOptions = { ...base, importable: true, footer: true, resolution: 'high' };
    const c = computeComposition(on, 1.2, [], { layerCount: 1 });
    expect(c.codeBand).toBeDefined();
    // In-bounds horizontally, and sits between the map and the footer.
    expect(c.codeBand!.x).toBeGreaterThanOrEqual(0);
    expect(c.codeBand!.x + c.codeBand!.w).toBeLessThanOrEqual(c.width);
    expect(c.codeBand!.y).toBeGreaterThan(c.map.y + c.map.h - 1);
    expect(c.footer!.y).toBeGreaterThanOrEqual(c.codeBand!.y + c.codeBand!.h - 1);
    expect(overlaps(c.map, c.codeBand!)).toBe(false);
  });
  it('the PetitGlyph band sits at the page margin, on whole module pixels', () => {
    const c = computeComposition({ ...base, importable: true, resolution: 'high' }, 1.2, [], { layerCount: 1 });
    expect(c.codeBand).toBeDefined();
    // High is 2400 wide; at PAD*S = 84 either side the band gets 2232, which holds GRID_COLS
    // modules of 18px exactly — so the margin is the page's, and no module is resampled.
    const mb = c.codeBand!.w / GRID_COLS;
    expect(Number.isInteger(mb) && mb % 6 === 0, `module base ${mb}`).toBe(true);
    expect(c.codeBand!.x).toBe(Math.round((c.width - c.codeBand!.w) / 2));
    expect(c.codeBand!.x).toBeGreaterThanOrEqual(Math.round(PAD * (c.width / 800)) - 1);
    expect(c.codeBandUnavailable).toBeUndefined();
  });
  it('a composition too small for any module base reports codeBandUnavailable, no band', () => {
    const c = computeComposition({ ...base, importable: true, resolution: 'compact' }, 1.2, [], { layerCount: 1 });
    expect(c.codeBand).toBeUndefined();
    expect(c.codeBandUnavailable).toBe(true);
  });
  it('original (Native) mode: full-resolution width but the SAME layout ratio as presets', () => {
    const o: ExportOptions = { ...base, footer: true, resolution: 'original' };
    const mapPx = { w: 8000, h: 6000 };
    const c = computeComposition(o, mapPx.w / mapPx.h, [], { layerCount: 1, mapPx });
    // Native width follows the map's native pixel width (so the image is full-resolution).
    expect(c.width).toBe(mapPx.w);
    // The map is a proportional band (letterboxed), NOT the whole image — same ratio as presets.
    const preset = computeComposition({ ...o, resolution: 'high' }, mapPx.w / mapPx.h, [], { layerCount: 1, mapPx });
    expect(c.map.h / c.height).toBeCloseTo(preset.map.h / preset.height, 2);
    expect(c.map.w / c.width).toBeCloseTo(preset.map.w / preset.width, 2);
  });
  it('original (Native) mode: floors at High width for small maps', () => {
    const o: ExportOptions = { ...base, resolution: 'original' };
    const c = computeComposition(o, 1.2, [], { layerCount: 1, mapPx: { w: 1000, h: 800 } });
    expect(c.width).toBe(RESOLUTION_WIDTHS.high);
  });
  it('original mode: a map beyond canvas limits is scaled down and fits', () => {
    const o: ExportOptions = { ...base, resolution: 'original' };
    const mapPx = { w: 20000, h: 20000 };
    const c = computeComposition(o, 1, [], { layerCount: 1, mapPx });
    expect(c.map.w).toBeLessThan(mapPx.w);
    expect(c.width).toBeLessThanOrEqual(16384);
    expect(c.height).toBeLessThanOrEqual(16384);
  });
});

describe('fitAspect (letterbox, never stretch)', () => {
  const rect: Rect = { x: 10, y: 20, w: 200, h: 100 };
  it('wider source → fit to width, centered vertically (pillar/letterbox top+bottom)', () => {
    const f = fitAspect(rect, 4);
    expect(f.w).toBe(rect.w);
    expect(f.h).toBeLessThan(rect.h);
    expect(f.x).toBe(rect.x);
    expect(f.y).toBeGreaterThan(rect.y);
    expect(f.w / f.h).toBeCloseTo(4, 5);
  });
  it('taller source → fit to height, centered horizontally', () => {
    const f = fitAspect(rect, 1);
    expect(f.h).toBe(rect.h);
    expect(f.w).toBeLessThan(rect.w);
    expect(f.y).toBe(rect.y);
    expect(f.x).toBeGreaterThan(rect.x);
    expect(f.w / f.h).toBeCloseTo(1, 5);
  });
  it('matching aspect → fills the rect exactly', () => {
    const f = fitAspect(rect, 2);
    expect(f).toEqual(rect);
  });
});
