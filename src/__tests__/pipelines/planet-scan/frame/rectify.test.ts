import { describe, expect, it } from 'vitest';
import { MAP_VIEW_RECTIFICATION as CAL, SCAN_PROFILE } from '../../../../pipelines/planet-scan/profile';
import {
  buildSampleMap,
  groundToScreen,
  rectifyGrey,
  rectifyRgba,
  rgbaToGrey,
  screenToGround,
  tileToGround,
} from '../../../../pipelines/planet-scan/frame/rectify';

const { tile, trustedRegion: roi } = SCAN_PROFILE;
const FW = CAL.frame.width;
const FH = CAL.frame.height;

describe('map-view calibration', () => {
  it('inverts itself across the tile to a millionth of a pixel', () => {
    for (let y = -tile.originY; y < tile.height - tile.originY; y += 10) {
      for (let x = -tile.originX; x < tile.width - tile.originX; x += 10) {
        const s = groundToScreen(CAL, x, y);
        const g = screenToGround(CAL, s.u, s.v);
        expect(Math.hypot(g.x - x, g.y - y)).toBeLessThan(1e-6);
      }
    }
  });

  it('lays the tile inside the trusted region, as wide and as tall as it fits there', () => {
    const corner = (tx: number, ty: number) => groundToScreen(CAL, tx - tile.originX, ty - tile.originY);
    const inside = (p: { u: number; v: number }) => p.u >= roi.x0 && p.u <= roi.x1 && p.v >= roi.y0 && p.v <= roi.y1;
    for (const [tx, ty] of [[0, 0], [tile.width, 0], [0, tile.height], [tile.width, tile.height]] as const) expect(inside(corner(tx, ty))).toBe(true);
    // Two ground pixels more on any side leave the region.
    expect(inside(corner(-2, 0)) && inside(corner(-2, tile.height))).toBe(false);
    expect(inside(corner(tile.width + 2, 0)) && inside(corner(tile.width + 2, tile.height))).toBe(false);
    expect(inside(corner(0, -2)) && inside(corner(tile.width, -2))).toBe(false);
    expect(inside(corner(0, tile.height + 2)) && inside(corner(tile.width, tile.height + 2))).toBe(false);
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
    expect(vs.data[tile.originY * tile.width + tile.originX]).toBeCloseTo(groundToScreen(CAL, 0, 0).u, 1);
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

describe('a world drawn smaller in a window wider than the frame', () => {
  it('samples each ground point where the zoomed world puts it, about the frame\'s centre', () => {
    const zoom = 0.75;
    const full = buildSampleMap(CAL, tile, 2);
    const small = buildSampleMap(CAL, tile, 2, zoom);
    const at = (map: ReturnType<typeof buildSampleMap>, p: number) => ({
      u: (map.index[p]! % FW) + map.fx[p]!, v: Math.floor(map.index[p]! / FW) + map.fy[p]!,
    });
    for (const p of [0, 1234, Math.floor(full.index.length / 2), full.index.length - 1]) {
      const a = at(full, p);
      const b = at(small, p);
      expect(b.u).toBeCloseTo(FW / 2 + (a.u - FW / 2) * zoom, 3);
      expect(b.v).toBeCloseTo(FH / 2 + (a.v - FH / 2) * zoom, 3);
    }
    expect(Array.from(buildSampleMap(CAL, tile, 2, 1).index)).toEqual(Array.from(full.index));
  });
});
