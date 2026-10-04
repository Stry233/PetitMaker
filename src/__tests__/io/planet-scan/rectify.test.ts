import { describe, expect, it } from 'vitest';
import { MAP_VIEW_RECTIFICATION as CAL, SCAN_PROFILE } from '../../../io/planet-scan/profile';
import {
  buildSampleMap,
  groundToScreen,
  rectifyGrey,
  rectifyRgba,
  rgbaToGrey,
  screenToGround,
  tileToGround,
} from '../../../io/planet-scan/rectify';

const { tile, trustedRegion: roi } = SCAN_PROFILE;
const FW = CAL.frame.width;
const FH = CAL.frame.height;

describe('map-view calibration', () => {
  // Values of the measured polynomials evaluated where they were fitted.
  it('maps ground points to the measured screen points', () => {
    const cases: [number, number, number, number][] = [
      [-340, -170, 171.97279757843648, 90.08611508810017],
      [339, 129, 812.1776218681437, 372.35397180105394],
      [0, 0, 480.0054201944468, 220.04502093742084],
      [200, -100, 669.355730686524, 134.19253187206718],
      [-150, 80, 330.1165772324539, 306.93092519536174],
    ];
    for (const [x, y, u, v] of cases) {
      const s = groundToScreen(CAL, x, y);
      expect(s.u).toBeCloseTo(u, 6);
      expect(s.v).toBeCloseTo(v, 6);
    }
  });

  it('maps screen points to the measured ground points', () => {
    const cases: [number, number, number, number][] = [
      [146, 369, -340.15517198069415, 126.30659408746972],
      [810, 66, 371.5416020791652, -207.70667913905123],
      [300, 250, -182.90871038210287, 23.980984632092152],
    ];
    for (const [u, v, x, y] of cases) {
      const g = screenToGround(CAL, u, v);
      expect(g.x).toBeCloseTo(x, 6);
      expect(g.y).toBeCloseTo(y, 6);
    }
  });

  it('inverts itself across the tile to a tenth of a pixel', () => {
    for (let y = -tile.originY; y < tile.height - tile.originY; y += 10) {
      for (let x = -tile.originX; x < tile.width - tile.originX; x += 10) {
        const s = groundToScreen(CAL, x, y);
        const g = screenToGround(CAL, s.u, s.v);
        expect(Math.hypot(g.x - x, g.y - y)).toBeLessThan(0.1);
      }
    }
  });

  it('spans the trusted region: the tile bottom corners land on its corners', () => {
    const bl = groundToScreen(CAL, -tile.originX, tile.height - 1 - tile.originY);
    const br = groundToScreen(CAL, tile.width - 1 - tile.originX, tile.height - 1 - tile.originY);
    expect(Math.hypot(bl.u - roi.x0, bl.v - roi.y1)).toBeLessThan(4);
    expect(Math.hypot(br.u - roi.x1, br.v - roi.y1)).toBeLessThan(4);
    const top = groundToScreen(CAL, 0, -tile.originY);
    expect(top.v).toBeCloseTo(roi.y0, 0);
  });

  it('has a chunk period within the spread a comb search measured on sea-only lines', () => {
    // Independent of the still-run fit the cell size comes from: 122.0 to 123.5 px in x over six
    // recordings, 105.6 px in y on the two with enough horizontal lines.
    expect(SCAN_PROFILE.chunk.width).toBeGreaterThanOrEqual(122.0);
    expect(SCAN_PROFILE.chunk.width).toBeLessThanOrEqual(123.5);
    expect(Math.abs(SCAN_PROFILE.chunk.height - 105.6)).toBeLessThan(0.5);
  });

  it('keeps unit scale at the view centre, so tile pixels are screen pixels there', () => {
    const c = groundToScreen(CAL, 0, 0);
    const right = groundToScreen(CAL, 10, 0);
    const down = groundToScreen(CAL, 0, 10);
    expect(Math.abs(right.u - c.u - 10)).toBeLessThan(0.5);
    expect(Math.abs(down.v - c.v - 10)).toBeLessThan(0.5);
  });
});

describe('rectify', () => {
  const map = buildSampleMap(CAL, tile);

  /** A frame whose grey level is a linear function of the screen pixel, which bilinear sampling
   *  reproduces exactly. */
  function ramp(f: (u: number, v: number) => number): Float32Array {
    const out = new Float32Array(FW * FH);
    for (let v = 0; v < FH; v++) for (let u = 0; u < FW; u++) out[v * FW + u] = f(u, v);
    return out;
  }

  it('samples each tile pixel at its calibrated screen point', () => {
    const us = rectifyGrey(map, { width: FW, height: FH, data: ramp((u) => u) });
    const vs = rectifyGrey(map, { width: FW, height: FH, data: ramp((_, v) => v) });
    expect([us.width, us.height]).toEqual([tile.width, tile.height]);
    for (let row = 0; row < tile.height; row += 7) {
      for (let col = 0; col < tile.width; col += 7) {
        const g = tileToGround(tile, 1, col, row);
        const s = groundToScreen(CAL, g.x, g.y);
        const p = row * tile.width + col;
        if (map.index[p]! < 0) continue;
        expect(us.data[p]).toBeCloseTo(s.u, 2);
        expect(vs.data[p]).toBeCloseTo(s.v, 2);
      }
    }
  });

  it('puts the calibration origin at the tile origin', () => {
    const vs = rectifyGrey(map, { width: FW, height: FH, data: ramp((u) => u) });
    expect(vs.data[tile.originY * tile.width + tile.originX]).toBeCloseTo(CAL.origin.u, 1);
  });

  it('samples every tile pixel inside the frame', () => {
    expect(map.index.every((i) => i >= 0)).toBe(true);
  });

  it('builds half-resolution maps on the same ground', () => {
    const half = buildSampleMap(CAL, tile, 2);
    expect([half.width, half.height]).toEqual([tile.width / 2, tile.height / 2]);
    const full = rectifyGrey(map, { width: FW, height: FH, data: ramp((u, v) => u + v) });
    const halved = rectifyGrey(half, { width: FW, height: FH, data: ramp((u, v) => u + v) });
    expect(halved.data[20 * half.width + 30]).toBeCloseTo(full.data[40 * tile.width + 60]!, 3);
  });

  it('remaps RGBA frames and their grey levels consistently', () => {
    const rgba = new Uint8Array(FW * FH * 4);
    for (let i = 0; i < FW * FH; i++) rgba.set([200, 120, 40, 255], i * 4);
    const out = rectifyRgba(map, { width: FW, height: FH, data: rgba });
    expect(Array.from(out.data.subarray(0, 4))).toEqual([200, 120, 40, 255]);
    const grey = rectifyGrey(map, rgbaToGrey({ width: FW, height: FH, data: rgba }));
    expect(grey.data[1234]).toBeCloseTo(0.299 * 200 + 0.587 * 120 + 0.114 * 40, 3);
  });

  it('rejects frames of another size', () => {
    expect(() => rectifyGrey(map, { width: 1920, height: 1080, data: new Float32Array(1920 * 1080) })).toThrow();
  });
});
