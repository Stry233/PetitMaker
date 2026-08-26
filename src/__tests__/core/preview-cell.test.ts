import { describe, it, expect } from 'vitest';
import {
  boundsOfCells, boundsOfSpans, hatchBars, isPreviewCell, isSolidRect, previewDots, previewIconRect,
  previewPalette, HATCH_BAR, HATCH_STEP, PREVIEW_CELL_ART, PREVIEW_ICON_ART, PREVIEW_PALETTES,
  type CellBounds,
} from '../../core/runtime/preview-cell';

const CELLS_3X3 = Array.from({ length: 9 }, (_, i) => ({ x: 10 + (i % 3), y: 20 + Math.floor(i / 3) }));

describe('preview cell — the paint', () => {
  it('tells a card from a plain tint', () => {
    expect(isPreviewCell(0x59c85f)).toBe(false);
    expect(isPreviewCell({ icon: 'ground', valid: true })).toBe(true);
  });

  it('picks the palette by validity', () => {
    expect(previewPalette({ icon: 'ground', valid: true })).toBe(PREVIEW_PALETTES.valid);
    expect(previewPalette({ icon: 'ground', valid: false })).toBe(PREVIEW_PALETTES.invalid);
  });

  it('carries a translucent background and solid marks', () => {
    for (const palette of [PREVIEW_PALETTES.valid, PREVIEW_PALETTES.invalid]) {
      expect(palette.bgAlpha).toBeGreaterThan(0);
      expect(palette.bgAlpha).toBeLessThan(1);
      expect(palette.bg).not.toBe(palette.line);
    }
  });

  it('gives the refused state its own hue and its stripes, and the accepted state neither', () => {
    // green vs red, judged on the channels rather than on a literal
    const [vr, vg] = [PREVIEW_PALETTES.valid.bg >> 16, (PREVIEW_PALETTES.valid.bg >> 8) & 0xff];
    const [ir, ig] = [PREVIEW_PALETTES.invalid.bg >> 16, (PREVIEW_PALETTES.invalid.bg >> 8) & 0xff];
    expect(vg).toBeGreaterThan(vr);
    expect(ir).toBeGreaterThan(ig);
    expect(PREVIEW_PALETTES.invalid.hatch).toBeDefined();
    expect(PREVIEW_PALETTES.valid.hatch).toBeUndefined();
  });
});

describe('preview cell — the frame over a footprint', () => {
  it('bounds a cell list and a span list alike', () => {
    expect(boundsOfCells(CELLS_3X3)).toEqual({ x: 10, y: 20, w: 3, h: 3 });
    expect(boundsOfSpans([{ x: 4, y: 7, w: 5 }, { x: 6, y: 8, w: 2 }])).toEqual({ x: 4, y: 7, w: 5, h: 2 });
    expect(boundsOfCells([])).toBeNull();
    expect(boundsOfSpans([])).toBeNull();
  });

  it('knows a footprint that fills its bounds from one that does not', () => {
    const b = boundsOfCells(CELLS_3X3)!;
    expect(isSolidRect(9, b)).toBe(true);
    expect(isSolidRect(8, b)).toBe(false);
    expect(isSolidRect(1, null)).toBe(false);
  });

  it('puts the four dots at the footprint corners, at the 1x1 inset whatever the size', () => {
    const inset = PREVIEW_CELL_ART.dotInset;
    for (const b of [{ x: 0, y: 0, w: 1, h: 1 }, { x: 10, y: 20, w: 3, h: 3 }, { x: -2, y: 5, w: 7, h: 2 }] as CellBounds[]) {
      const dots = previewDots(b);
      expect(dots).toHaveLength(4);
      for (const d of dots) {
        expect(Math.min(d.x - b.x, b.x + b.w - d.x)).toBeCloseTo(inset, 6);
        expect(Math.min(d.y - b.y, b.y + b.h - d.y)).toBeCloseTo(inset, 6);
        expect(d.r).toBeCloseTo(PREVIEW_CELL_ART.dotRadius, 6);
      }
      // one dot per corner, never two on a side
      expect(new Set(dots.map((d) => `${d.x},${d.y}`)).size).toBe(4);
    }
  });

  it('keeps the icon at its own size, centred, however big the footprint', () => {
    const art = PREVIEW_ICON_ART.mountain;
    const one = previewIconRect({ x: 3, y: 4, w: 1, h: 1 }, 'mountain');
    const many = previewIconRect({ x: 3, y: 4, w: 6, h: 2 }, 'mountain');
    expect(one.w).toBeCloseTo(art.w, 6);
    expect(many.w).toBeCloseTo(art.w, 6);
    expect(many.h).toBeCloseTo(art.h, 6);
    expect(one.x + one.w / 2).toBeCloseTo(3.5, 6);
    expect(many.x + many.w / 2).toBeCloseTo(6, 6);
    expect(many.y + many.h / 2).toBeCloseTo(5, 6);
  });

  it('draws every icon smaller than a cell, so it never overruns the frame it sits in', () => {
    for (const [id, art] of Object.entries(PREVIEW_ICON_ART)) {
      expect(art.parts.length, id).toBeGreaterThan(0);
      expect(art.w, id).toBeGreaterThan(0.2);
      expect(art.w, id).toBeLessThan(1 - 2 * PREVIEW_CELL_ART.dotInset + 0.4);
      expect(art.h, id).toBeLessThan(1);
      for (const part of art.parts) expect(part.d.startsWith('M'), id).toBe(true);
    }
  });

  it('keeps the eraser and trim glyphs cut out (the design subtracts their inner shapes)', () => {
    expect(PREVIEW_ICON_ART.eraser.parts.some((p) => p.hole)).toBe(true);
    expect(PREVIEW_ICON_ART.trim.parts.some((p) => p.hole)).toBe(true);
  });
});

describe('preview cell — the refused state stripes', () => {
  it('measures its bars along the diagonal', () => {
    expect(HATCH_STEP).toBeCloseTo(PREVIEW_CELL_ART.hatchPeriod * Math.SQRT2, 6);
    expect(HATCH_BAR).toBeLessThan(HATCH_STEP);
  });

  it('clips every bar inside the footprint', () => {
    const rect = { x: 2, y: 3, w: 2, h: 2 };
    const bars = hatchBars([rect]);
    expect(bars.length).toBeGreaterThan(3);
    for (const bar of bars) {
      expect(bar.length % 2).toBe(0);
      for (let i = 0; i < bar.length; i += 2) {
        expect(bar[i]!).toBeGreaterThanOrEqual(rect.x - 1e-9);
        expect(bar[i]!).toBeLessThanOrEqual(rect.x + rect.w + 1e-9);
        expect(bar[i + 1]!).toBeGreaterThanOrEqual(rect.y - 1e-9);
        expect(bar[i + 1]!).toBeLessThanOrEqual(rect.y + rect.h + 1e-9);
      }
    }
  });

  it('anchors the bars to the map, so a travelling ghost does not drag its stripes along', () => {
    const here = hatchBars([{ x: 0, y: 0, w: 1, h: 1 }]);
    const step = hatchBars([{ x: HATCH_STEP, y: 0, w: 1, h: 1 }]);
    // one whole step to the right reproduces the same phase, shifted
    const shifted = step.map((bar) => bar.map((v, i) => (i % 2 === 0 ? v - HATCH_STEP : v)));
    expect(shifted.length).toBe(here.length);
    for (let b = 0; b < here.length; b++) {
      for (let i = 0; i < here[b]!.length; i++) expect(shifted[b]![i]!).toBeCloseTo(here[b]![i]!, 6);
    }
  });

  it('gives up on a footprint too big for stripes to read, rather than tessellating it', () => {
    expect(hatchBars([{ x: 0, y: 0, w: 100, h: 100 }])).toEqual([]);
    expect(hatchBars([{ x: 0, y: 0, w: 4, h: 4 }]).length).toBeGreaterThan(0);
  });
});
