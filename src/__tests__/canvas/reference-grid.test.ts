import { describe, expect, it } from 'vitest';
import { CELL_GRID_STYLE, cellGridRects, chunkGridRects, chunkStrokeCells } from '../../canvas/reference-grid';
import { getMapTemplate } from '../../config/maps';
import { mapFrame } from '../../core/model/map-chunks';

describe('dashed chunk boundaries', () => {
  it('keeps a screen minimum and grows with zoom', () => {
    expect([0.1, 1, 2].map((zoom) => chunkStrokeCells(64 * zoom) * 64 * zoom)).toEqual([3, 8, 16]);
  });

  it('clears white grid lines beneath every dashed stroke and restores them when chunks are hidden', () => {
    const template = getMapTemplate('hexia');
    const whites = cellGridRects(template, 1 / 8), dashes = chunkGridRects(template, 1 / 8);
    expect(whites.some((a) => dashes.some((b) => a.x < b.x + b.width && a.x + a.width > b.x
      && a.y < b.y + b.height && a.y + a.height > b.y))).toBe(false);
    expect(whites.some((r) => 1 >= r.x && 1 < r.x + r.width && -6 >= r.y && -6 < r.y + r.height)).toBe(true);
    const area = (rects: typeof whites) => rects.reduce((sum, r) => sum + r.width * r.height, 0);
    const frame = mapFrame(template);
    expect(area(whites) + area(dashes)).toBeCloseTo(frame.width * frame.height);
    expect(cellGridRects(template)).toEqual([mapFrame(template)]);
  });

  it.each([1 / 32, 1 / 16, 1 / 4])('keeps crossings at one coat of ink with a %s-cell stroke', (width) => {
    const rects = chunkGridRects(getMapTemplate('hexia'), width);
    const overlaps = rects.some((a, i) => rects.some((b, j) => j > i
      && a.x < b.x + b.width && a.x + a.width > b.x
      && a.y < b.y + b.height && a.y + a.height > b.y));
    expect(overlaps).toBe(false);
    const coats = (x: number, y: number): number => rects.filter((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height).length;
    expect(coats(1, -7)).toBe(1);
    expect(coats(1, -6)).toBe(0);
    expect(coats(-15, -23)).toBe(1);
  });

  it.each(['hexia', 'tafa'])('keeps all four dashed edges inside %s reference bounds', (id) => {
    const template = getMapTemplate(id), frame = mapFrame(template);
    const rects = chunkGridRects(template, 1 / 16);
    expect(Math.min(...rects.map((r) => r.x))).toBe(frame.x);
    expect(Math.min(...rects.map((r) => r.y))).toBe(frame.y);
    expect(Math.max(...rects.map((r) => r.x + r.width))).toBe(frame.x + frame.width);
    expect(Math.max(...rects.map((r) => r.y + r.height))).toBe(frame.y + frame.height);
  });
});

describe('cell line fades', () => {
  it('brings the 2D cell lines in only at a readable cell size, with the sub-lines after them', () => {
    const { fadePx, subFadePx } = CELL_GRID_STYLE.map2d;
    expect(fadePx[0]).toBeGreaterThanOrEqual(10);
    expect(fadePx[0]).toBeLessThan(fadePx[1]);
    expect(subFadePx[0]).toBeGreaterThanOrEqual(fadePx[1]);
    expect(subFadePx[0]).toBeLessThan(subFadePx[1]);
  });

  it('keeps the 3D fades on their own range', () => {
    expect(CELL_GRID_STYLE.map3d.fadePx).toEqual([2, 6]);
    expect(CELL_GRID_STYLE.map3d.subFadePx).toEqual([10, 20]);
  });
});
