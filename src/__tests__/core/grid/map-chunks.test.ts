import { describe, expect, it } from 'vitest';
import { cellsCaptureFrame, mapCaptureFrame, mapChunkAt, mapChunkAxes, mapFrame } from '../../../core/grid/map-chunks';

const shifted = { width: 169, height: 140, chunkGrid: { origin: { x: -15, y: -23 }, columns: 13, rows: 12 } };

describe('map reference chunks', () => {
  it('keeps zero-aligned regions for templates without a chunk origin', () => {
    const template = { width: 33, height: 16 };
    expect(mapChunkAxes(template).columns).toEqual([
      { start: 0, end: 16, center: 8 },
      { start: 16, end: 32, center: 24 },
      { start: 32, end: 33, center: 32.5 },
    ]);
    expect(mapChunkAt({}, 16, 37)).toEqual({ cx: 1, cy: 2 });
  });

  it('keeps all 13 by 12 chunks complete, including sea outside the saved cell rectangle', () => {
    const { columns, rows } = mapChunkAxes(shifted);
    expect(columns).toHaveLength(13);
    expect(rows).toHaveLength(12);
    expect([...columns, ...rows].every((span) => span.end - span.start === 16)).toBe(true);
    expect(columns[0]).toEqual({ start: -15, end: 1, center: -7 });
    expect(columns[12]).toEqual({ start: 177, end: 193, center: 185 });
    expect(rows[0]).toEqual({ start: -23, end: -7, center: -15 });
    expect(rows[11]).toEqual({ start: 153, end: 169, center: 161 });
    expect(mapFrame(shifted)).toEqual({ x: -15, y: -23, width: 208, height: 192 });
    expect(mapCaptureFrame(shifted)).toEqual(mapFrame(shifted));
    expect(mapCaptureFrame({ width: 10, height: 20 })).toEqual({ x: -0.5, y: -0.5, width: 10.5, height: 20.5 });
  });

  it('captures a box of cells with its first column and row of terrain and ends where the box ends', () => {
    // A crop of cells 12 to 19 by 30 to 34 takes the half cell its first terrain shows up and left.
    expect(cellsCaptureFrame({ x: 12, y: 30, width: 8, height: 5 })).toEqual({ x: 11.5, y: 29.5, width: 8.5, height: 5.5 });
    expect(cellsCaptureFrame({ x: 0, y: 0, width: 10, height: 20 })).toEqual(mapCaptureFrame({ width: 10, height: 20 }));
    expect(cellsCaptureFrame({ x: -15, y: -23, width: 208, height: 192 })).toEqual({ x: -15, y: -23, width: 208, height: 192 });
  });

  it('assigns each cell to the span containing it, with a boundary in the following region', () => {
    const axes = mapChunkAxes(shifted);
    for (let y = -23; y < 169; y++) {
      for (let x = -15; x < 193; x++) {
        const { cx, cy } = mapChunkAt(shifted, x, y);
        expect(x >= axes.columns[cx]!.start && x < axes.columns[cx]!.end).toBe(true);
        expect(y >= axes.rows[cy]!.start && y < axes.rows[cy]!.end).toBe(true);
      }
    }
    expect(mapChunkAt(shifted, 16.5, 24.5)).toEqual({ cx: 1, cy: 2 });
    expect(mapChunkAt(shifted, 17, 25)).toEqual({ cx: 2, cy: 3 });
  });
});
