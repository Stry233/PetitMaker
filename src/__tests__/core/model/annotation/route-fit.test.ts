import { describe, expect, it } from 'vitest';
import { extendRouteFit, fitRoutePath, routeFitAnchors, startRouteFit } from '../../../../core/model/annotation/route-fit';
import type { MacroCoord } from '../../../../core/model/types';

/** A pointer path in screen px: `steps` samples along each leg of a polyline. */
function screenPath(corners: Array<[number, number]>, steps = 40): Array<[number, number]> {
  const out: Array<[number, number]> = [corners[0]!];
  for (let i = 1; i < corners.length; i++) {
    const [ax, ay] = corners[i - 1]!, [bx, by] = corners[i]!;
    for (let k = 1; k <= steps; k++) out.push([ax + (bx - ax) * k / steps, ay + (by - ay) * k / steps]);
  }
  return out;
}

/** A fixed pseudo-random wobble of up to `px` screen px, the same on every run. */
function jitter(path: Array<[number, number]>, px: number): Array<[number, number]> {
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * 2 - 1; };
  return path.map(([x, y], i) => (i === 0 || i === path.length - 1 ? [x, y] : [x + rand() * px, y + rand() * px]));
}

const toCells = (path: Array<[number, number]>, cellPx: number): MacroCoord[] => path.map(([x, y]) => ({ x: x / cellPx, y: y / cellPx }));

/** The number of real turns in a fitted route: interior anchors whose heading changes by more
 *  than 20 degrees. */
function turns(anchors: readonly MacroCoord[]): number {
  let n = 0;
  for (let i = 1; i < anchors.length - 1; i++) {
    const a = anchors[i - 1]!, b = anchors[i]!, c = anchors[i + 1]!;
    const h1 = Math.atan2(b.y - a.y, b.x - a.x), h2 = Math.atan2(c.y - b.y, c.x - b.x);
    let d = Math.abs(h2 - h1);
    if (d > Math.PI) d = 2 * Math.PI - d;
    if (d > Math.PI / 9) n++;
  }
  return n;
}

const CORNERS: Array<[number, number]> = [[0, 0], [400, 0], [400, 300], [700, 120]];

describe('the route fit', () => {
  it('releases exactly the route its last live frame drew', () => {
    const samples = toCells(jitter(screenPath(CORNERS), 2), 16);
    const fit = startRouteFit(samples[0]!, 16);
    let live: MacroCoord[] = routeFitAnchors(fit);
    for (const p of samples.slice(1)) if (extendRouteFit(fit, p)) live = routeFitAnchors(fit);
    expect(routeFitAnchors(fit)).toEqual(live);
    expect(fitRoutePath(samples, 16)).toEqual(live);
  });

  it('keeps the line behind the pointer still while the drag goes on', () => {
    const samples = toCells(screenPath(CORNERS), 16);
    const fit = startRouteFit(samples[0]!, 16);
    let previous: MacroCoord[] = [];
    let settled = 0;
    for (const p of samples.slice(1)) {
      if (!extendRouteFit(fit, p)) continue;
      const now = routeFitAnchors(fit);
      expect(now.slice(0, settled)).toEqual(previous.slice(0, settled));
      previous = now;
      settled = fit.committed.length;
    }
  });

  it('turns where the hand turns, however much the pointer jitters', () => {
    const clean = fitRoutePath(toCells(screenPath(CORNERS), 16), 16);
    expect(turns(clean)).toBe(2);
    for (const px of [1, 2, 3]) {
      expect(turns(fitRoutePath(toCells(jitter(screenPath(CORNERS, 120), px), 16), 16))).toBe(turns(clean));
    }
  });

  it('meets a deliberate corner straight and leaves a gentle bend smooth', () => {
    const corner = fitRoutePath(toCells(screenPath(CORNERS), 16), 16);
    for (const a of corner.slice(1, -1)) expect(a).toMatchObject({ hx: 0, hy: 0, ihx: 0, ihy: 0 });
    const arc = Array.from({ length: 200 }, (_, i): [number, number] => [i * 3, 120 * Math.sin(i / 200 * Math.PI)]);
    const bend = fitRoutePath(toCells(arc, 16), 16);
    expect(bend.length).toBeGreaterThan(2);
    for (const a of bend) expect(a.hx).toBeUndefined();
  });

  it('fits one gesture to the same line at every zoom', () => {
    const gesture = jitter(screenPath(CORNERS, 80), 2);
    const shapes = [6, 16, 48, 120].map((cellPx) => fitRoutePath(toCells(gesture, cellPx), cellPx).map((p) => ({ x: p.x * cellPx, y: p.y * cellPx })));
    for (const shape of shapes.slice(1)) {
      expect(shape).toHaveLength(shapes[0]!.length);
      shape.forEach((p, i) => { expect(p.x).toBeCloseTo(shapes[0]![i]!.x, 6); expect(p.y).toBeCloseTo(shapes[0]![i]!.y, 6); });
    }
  });

  it('drops samples closer than a screen spacing that holds at every zoom', () => {
    /** The least whole css px of travel that adds a sample to a fit pressed at `cellPx`. */
    const spacingPx = (cellPx: number): number => {
      for (let px = 1; px < 64; px++) if (extendRouteFit(startRouteFit({ x: 0, y: 0 }, cellPx), { x: px / cellPx, y: 0 })) return px;
      return Infinity;
    };
    const spacing = spacingPx(16);
    expect(spacing).toBeGreaterThan(1);
    expect(spacing).toBeLessThan(16);
    for (const cellPx of [6, 48, 120]) expect(spacingPx(cellPx)).toBe(spacing);
    const fit = startRouteFit({ x: 0, y: 0 }, 16);
    expect(extendRouteFit(fit, { x: (spacing - 1) / 16, y: 0 })).toBe(false);
    expect(extendRouteFit(fit, { x: (spacing + 1) / 16, y: 0 })).toBe(true);
  });
});
