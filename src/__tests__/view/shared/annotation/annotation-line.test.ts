import { describe, expect, it } from 'vitest';
import { ANNOTATION_LINE, annotationDashes, annotationLineCells, annotationLineColor, dashRuns, zoneBorderPaths } from '../../../../view/shared/annotation/annotation-line';
import { ANNOTATION_COLORS, isAnnotationInk } from '../../../../config/annotation-palette';
import { TILE_SIZE, ZOOM_MAX, ZOOM_MIN } from '../../../../view/map2d/geometry/world';

describe('annotation line width', () => {
  const onScreen = (cellPx: number) => annotationLineCells(cellPx) * cellPx;

  it('stays within the readable css-px band from the farthest to the nearest zoom', () => {
    for (const zoom of [ZOOM_MIN, 0.1, 0.25, 1, 2, ZOOM_MAX]) {
      const px = onScreen(TILE_SIZE * zoom);
      expect(px).toBeGreaterThanOrEqual(ANNOTATION_LINE.minPx);
      expect(px).toBeLessThanOrEqual(ANNOTATION_LINE.maxPx);
    }
  });

  it('grows gently on screen and thins in world units as the view nears', () => {
    const far = TILE_SIZE * 0.1, near = TILE_SIZE * 0.8;
    expect(onScreen(near)).toBeGreaterThan(onScreen(far));
    expect(onScreen(near) / onScreen(far)).toBeLessThan(near / far / 2);
    expect(annotationLineCells(near)).toBeLessThan(annotationLineCells(far));
  });

  it('draws cream notes in the light line colour and others in their own', () => {
    for (const color of ANNOTATION_COLORS) {
      expect(annotationLineColor(color)).toBe(isAnnotationInk(color) ? ANNOTATION_LINE.inkLine : color);
    }
  });
});

describe('zone border paths', () => {
  const rect = (x0: number, y0: number, x1: number, y1: number) => {
    const out: Array<{ x: number; y: number }> = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ x, y });
    return out;
  };

  it('closes one continuous path per outline, inside the drawn cells of the zone', () => {
    const paths = zoneBorderPaths(rect(2, 2, 6, 4), 0.1);
    expect(paths).toHaveLength(1);
    const path = paths[0]!;
    expect(path[0]).toEqual(path[path.length - 1]);
    for (const [x, y] of path) {
      expect(x).toBeGreaterThan(2);
      expect(x).toBeLessThan(7);
      expect(y).toBeGreaterThan(2);
      expect(y).toBeLessThan(5);
    }
  });

  it('draws a half-grid zone in map cells, half a cell over from its whole-cell twin', () => {
    const whole = zoneBorderPaths(rect(2, 2, 3, 2), 0.1, 'object')[0]!;
    const halves = rect(5, 4, 8, 5);
    const half = zoneBorderPaths(halves, 0.1, 'half')[0]!;
    const sorted = (path: Array<[number, number]>) => path.map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`).sort();
    expect(sorted(half)).toEqual(sorted(whole.map(([x, y]) => [x + 0.5, y] as [number, number])));
  });

  it('keeps a hole as its own closed path', () => {
    const ring = rect(0, 0, 4, 4).filter((c) => !(c.x === 2 && c.y === 2));
    expect(zoneBorderPaths(ring, 0.1)).toHaveLength(2);
  });
});

describe('dashed runs', () => {
  it('cuts a path into dash-long runs and keeps a solid one whole', () => {
    const line: Array<[number, number]> = [[0, 0], [10, 0]];
    expect(dashRuns(line, null)).toEqual([line]);
    const runs = dashRuns(line, { dash: 1, gap: 1 });
    expect(runs).toHaveLength(5);
    expect(runs[1]).toEqual([[2, 0], [3, 0]]);
  });

  it('reads 3D points in their ground plane', () => {
    const runs = dashRuns<[number, number, number]>([[0, 5, 0], [0, 9, 4]], { dash: 1, gap: 1 });
    expect(runs).toHaveLength(2);
    expect(runs[0]![1]![2]).toBeCloseTo(1);
  });
});

describe('the dashed variant', () => {
  const FAR = TILE_SIZE * ZOOM_MIN, DEFAULT = 7, NEAR = 40;

  it.each([['far', FAR], ['default', DEFAULT], ['near', NEAR]] as const)('keeps a clear gap between dashes on screen at %s zoom', (_name, cellPx) => {
    const w = annotationLineCells(cellPx) * cellPx;
    const { dash, gap } = annotationDashes(w);
    // Each round cap of the halo reaches half a halo width past its run.
    const clear = gap - ANNOTATION_LINE.halo.scale * w;
    expect(clear).toBeGreaterThanOrEqual(1.5 * w - 1e-9);
    expect(clear).toBeGreaterThanOrEqual(1.5);
    expect(dash).toBeGreaterThanOrEqual(2 * w);
  });

  it('cuts dashes in widths of the line, so a wider or nearer line keeps the same rhythm', () => {
    const a = annotationDashes(2), b = annotationDashes(6);
    expect(b.dash / a.dash).toBeCloseTo(3);
    expect(b.gap / a.gap).toBeCloseTo(3);
  });

  it('carries the dash phase across the joins of one path', () => {
    const { dash, gap } = annotationDashes(1);
    const runs = dashRuns<[number, number]>([[0, 0], [dash + gap / 2, 0], [dash + gap / 2, 10]], { dash, gap });
    // The gap that straddles the corner is one gap long, measured along the path.
    const [, second] = runs;
    expect(second![0]![0]).toBeCloseTo(dash + gap / 2);
    expect(second![0]![1]).toBeCloseTo(gap / 2);
  });
});
