/**
 * The ghost outline when auto-trim will change the shape: it has to be the silhouette of what the
 * click leaves, or it contradicts the fill drawn under it.
 *
 * Everything here is in cell units, and a quadrant is half a cell.
 */
import { describe, it, expect } from 'vitest';
import { filletOnly, trimmedOutline, type EdgeSegment, type TrimmedGhostCell } from '../../canvas/map2d/layers/ghost-geometry';

const SQUARE = ['square', 'square', 'square', 'square'] as const;
const cell = [{ x: 2, y: 3 }];

/** Is this point an endpoint of any segment? */
const at = (edges: EdgeSegment[], x: number, y: number, r = 1e-9) =>
  edges.some((e) => Math.hypot(e.ax - x, e.ay - y) < r || Math.hypot(e.bx - x, e.by - y) < r);
/** Total outline length — a cut shape is shorter round the corner than a square one. */
const length = (edges: EdgeSegment[]) =>
  edges.reduce((n, e) => n + Math.hypot(e.bx - e.ax, e.by - e.ay), 0);

describe('an untrimmed ghost', () => {
  it('is its own square footprint', () => {
    const edges = trimmedOutline(cell, [{ x: 2, y: 3, corners: [...SQUARE], patch: false }]);
    expect(length(edges)).toBeCloseTo(4, 6);
    for (const [x, y] of [[2, 3], [3, 3], [2, 4], [3, 4]]) expect(at(edges, x!, y!)).toBe(true);
  });
});

describe('a cut corner', () => {
  const bevel: TrimmedGhostCell = { x: 2, y: 3, corners: ['tri-SE', ...SQUARE.slice(1)], patch: false };
  const round: TrimmedGhostCell = { x: 2, y: 3, corners: ['fan', ...SQUARE.slice(1)], patch: false };

  it('is gone from the outline, which picks up half a cell along each edge', () => {
    const edges = trimmedOutline(cell, [bevel]);
    expect(at(edges, 2, 3), 'the corner itself').toBe(false);
    expect(at(edges, 2.5, 3)).toBe(true);
    expect(at(edges, 2, 3.5)).toBe(true);
  });

  it('crosses straight over for a bevel', () => {
    const edges = trimmedOutline(cell, [bevel]);
    expect(edges.some((e) =>
      (Math.hypot(e.ax - 2.5, e.ay - 3) < 1e-9 && Math.hypot(e.bx - 2, e.by - 3.5) < 1e-9)
      || (Math.hypot(e.bx - 2.5, e.by - 3) < 1e-9 && Math.hypot(e.ax - 2, e.ay - 3.5) < 1e-9))).toBe(true);
    expect(length(edges)).toBeCloseTo(3 + Math.SQRT1_2, 6);
  });

  it('and curves for a round one, outside the chord it would cut', () => {
    const edges = trimmedOutline(cell, [round]);
    const mid = { x: 2.5 - Math.SQRT1_2 / 2, y: 3.5 - Math.SQRT1_2 / 2 };
    expect(at(edges, mid.x, mid.y, 0.02), 'a point of the quarter circle').toBe(true);
    expect(at(edges, 2.25, 3.25, 0.02), 'and not the chord').toBe(false);
    expect(length(edges)).toBeCloseTo(3 + Math.PI / 4, 2);
  });

  it('takes every corner off a lone cell', () => {
    const edges = trimmedOutline(cell, [{ x: 2, y: 3, corners: ['fan', 'fan', 'fan', 'fan'], patch: false }]);
    for (const [x, y] of [[2, 3], [3, 3], [2, 4], [3, 4]]) expect(at(edges, x!, y!)).toBe(false);
    expect(length(edges), 'a circle of radius 1/2').toBeCloseTo(Math.PI, 1);
  });
});

describe('a Γ patch', () => {
  // The trim fills the notch of an L with ONE quadrant, anchored at the corner it fills. Drawn as a
  // square with a bite out of it — which is what a footprint-shaped outline does — it would cover
  // three quarters of a cell the stroke never touches.
  const L = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
  const patch: TrimmedGhostCell = { x: 1, y: 1, corners: ['fan', 'empty', 'empty', 'empty'], patch: true };

  it('adds only its own quadrant to the outline', () => {
    const edges = trimmedOutline(L, [patch]);
    expect(at(edges, 2, 2), 'the far corner of the patch cell is not part of the shape').toBe(false);
    expect(at(edges, 1.5, 1), 'the notch edges run half a cell in').toBe(true);
    expect(at(edges, 1, 1.5)).toBe(true);
  });

  it('curves INTO the notch rather than away from it', () => {
    const edges = trimmedOutline(L, [patch]);
    // Centred on the notch corner (1,1), so the arc's midpoint is further from it than the chord.
    const arcMid = { x: 1 + Math.SQRT1_2 / 2, y: 1 + Math.SQRT1_2 / 2 };
    expect(at(edges, arcMid.x, arcMid.y, 0.02)).toBe(true);
    expect(at(edges, 1.25, 1.25, 0.02)).toBe(false);
  });

  it('is only its fillet, even when the model calls its other quadrants square', () => {
    // How the trim actually records a Γ patch: one cut quadrant, the rest 'square' — meaning the
    // block UNDERNEATH, which the terrain layer draws in a separate pass at the lower tier. Drawn
    // as part of the new shape they hung a square box off every step of a curve laid a layer up.
    const real: TrimmedGhostCell = { x: 1, y: 1, corners: ['square', 'square', 'fan', 'square'], patch: true };
    const asDrawn = { ...real, corners: filletOnly(real.corners, real.patch) };
    expect(asDrawn.corners).toEqual(['empty', 'empty', 'fan', 'empty']);
    const edges = trimmedOutline(L, [asDrawn]);
    // The patch cell spans x 1..2, y 1..2; only its bottom-left quadrant is the fillet, so nothing
    // of the cell's right-hand or top half may reach the outline.
    expect(at(edges, 2, 2), 'the cell\'s far corner').toBe(false);
    expect(at(edges, 2, 1.5), 'its right edge').toBe(false);
    expect(length(edges), 'and the box those corners would have drawn is gone')
      .toBeLessThan(length(trimmedOutline(L, [real])));
  });

  it('is left alone when it is not a patch', () => {
    expect(filletOnly(['square', 'fan', 'square', 'square'], false)).toEqual(['square', 'fan', 'square', 'square']);
  });

  it('leaves no seam where it meets the mass it fills', () => {
    // The patch's straight sides lie against the L, so they are interior and must not be stroked.
    const edges = trimmedOutline(L, [patch]);
    const seam = edges.filter((e) => (e.ax === 1 && e.bx === 1 && Math.min(e.ay, e.by) >= 1 && Math.max(e.ay, e.by) <= 1.5)
      || (e.ay === 1 && e.by === 1 && Math.min(e.ax, e.bx) >= 1 && Math.max(e.ax, e.bx) <= 1.5));
    expect(seam).toEqual([]);
  });
});

describe('a cut inside the shape', () => {
  it('is drawn: a stroke spanning two tiers really does leave a rounded block in there', () => {
    // The raised part of a stroke rounds against the lower part beside it, and that shape is
    // visible from above — the same thing the terrain renderer draws. Leaving it out of the
    // outline made the ghost promise square steps for a curve laid a layer up, which came out
    // scalloped all the way along.
    const block = [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
      { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 },
      { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 },
    ];
    const rounded: TrimmedGhostCell = { x: 1, y: 1, corners: ['fan', 'fan', 'fan', 'fan'], patch: false };
    const edges = trimmedOutline(block, [rounded]);
    expect(length(edges)).toBeGreaterThan(12);
    const arc = edges.filter((e) => Math.abs(e.ax - e.bx) > 1e-9 && Math.abs(e.ay - e.by) > 1e-9);
    expect(arc.length, 'four quarter circles').toBeGreaterThan(20);
  });
});

describe('inside a shape', () => {
  it('draws no seam between two whole cells', () => {
    const edges = trimmedOutline([{ x: 0, y: 0 }, { x: 1, y: 0 }],
      [{ x: 0, y: 0, corners: ['fan', ...SQUARE.slice(1)], patch: false }]);
    expect(edges.some((e) => e.ax === 1 && e.bx === 1)).toBe(false);
    expect(at(edges, 2, 0), 'the far cell keeps its own corners').toBe(true);
  });
});
