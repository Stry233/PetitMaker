/**
 * The drawn shape of a trimmed road, pinned to LITERAL coordinates.
 *
 * `core/edge-cut/road-shape.ts` is the one implementation behind 2D's `drawRoadShape`, 3D's
 * `buildRoadTrimMesh` and both ghost previews. Before it existed each view carried its own copy, so
 * a drift in one had a chance of showing up as the two views disagreeing; now nothing downstream
 * can notice, and a test that derives its expectation from the function it is testing notices even
 * less. So every number below is worked out by hand from the canonical states and the four
 * connection-side mappings, and compared as a number.
 *
 * Two things in particular have no other guard: the arc RADIUS (the fans are quarter circles of
 * canonical radius 2, i.e. a full cell half-extent — a shrunken one is a subtly wrong curve
 * everywhere at once) and the 'top'/'bottom' mappings (the end-to-end tool pins only ever produce
 * 'left' and 'right', because a road stroke laid along x connects along x).
 */
import { describe, it, expect } from 'vitest';
import {
  ROAD_ARC_STEPS, hasRoadTrimShape, roadCanonicalPoly, roadShapePoints, roadTxPt, type RoadPt,
} from '../../core/edge-cut/road-shape';
import { CANONICAL_ROAD_STATES, type RoadConnSide } from '../../core/edge-cut/road-cut-states';
import type { Corners } from '../../core/model/types';

const SIDES: RoadConnSide[] = ['left', 'right', 'top', 'bottom'];
const state = (i: number): Corners => [...CANONICAL_ROAD_STATES[i]!] as Corners;

/** A unit cell at the origin, so a coordinate IS the fraction of the cell it sits at. */
const pts = (corners: Corners, side: RoadConnSide): RoadPt[] => roadShapePoints(corners, side, 0, 0, 1, 1)!;
const near = (p: RoadPt, x: number, y: number): void => {
  expect(p[0]).toBeCloseTo(x, 9);
  expect(p[1]).toBeCloseTo(y, 9);
};
/** √2/2 and 1−√2/2: where a quarter circle of radius 1 crosses its own 45°. */
const D = Math.SQRT1_2;          // 0.7071067811865476
const E = 1 - Math.SQRT1_2;      // 0.2928932188134524

describe('roadTxPt: the four connection-side frames', () => {
  // The canonical cell is (u,v) ∈ [0,2]²; a unit cell at the origin halves it. Each side is a
  // different rigid placement of that square, and these are its three defining corners.
  const CORNERS: Record<RoadConnSide, [RoadPt, RoadPt, RoadPt]> = {
    //          (0,0)        (2,0)        (0,2)
    left: [[0, 0], [1, 0], [0, 1]],
    right: [[1, 0], [0, 0], [1, 1]],
    top: [[0, 0], [0, 1], [1, 0]],
    bottom: [[1, 1], [1, 0], [0, 1]],
  };
  for (const side of SIDES) {
    it(`places the canonical square for '${side}'`, () => {
      const [a, b, c] = CORNERS[side];
      near(roadTxPt(0, 0, side, 0, 0, 0.5, 0.5), a[0], a[1]);
      near(roadTxPt(2, 0, side, 0, 0, 0.5, 0.5), b[0], b[1]);
      near(roadTxPt(0, 2, side, 0, 0, 0.5, 0.5), c[0], c[1]);
      // The centre is the centre in every frame — a mapping that is not a rigid placement of the
      // square would move it.
      near(roadTxPt(1, 1, side, 0, 0, 0.5, 0.5), 0.5, 0.5);
    });
  }

  it('offsets and scales with the cell it is given', () => {
    // The canonical frame is 2 wide, so a half-extent of 16 makes the far corner 32 from the near.
    near(roadTxPt(2, 2, 'left', 10, -4, 16, 16), 10 + 32, -4 + 32);
  });
});

describe('the straight canonical states, per connection side', () => {
  // Worked out by hand: canonical vertices through the mapping above.
  const EXPECTED: Record<number, Record<RoadConnSide, RoadPt[]>> = {
    3: { // diagonal \ : (0,0)-(0,2)-(2,2)
      left: [[0, 0], [0, 1], [1, 1]],
      right: [[1, 0], [1, 1], [0, 1]],
      top: [[0, 0], [1, 0], [1, 1]],
      bottom: [[1, 1], [0, 1], [0, 0]],
    },
    4: { // diagonal / : (0,0)-(2,0)-(0,2)
      left: [[0, 0], [1, 0], [0, 1]],
      right: [[1, 0], [0, 0], [1, 1]],
      top: [[0, 0], [0, 1], [1, 0]],
      bottom: [[1, 1], [1, 0], [0, 1]],
    },
    5: { // wedge : (0,0)-(1,1)-(0,2)
      left: [[0, 0], [0.5, 0.5], [0, 1]],
      right: [[1, 0], [0.5, 0.5], [1, 1]],
      top: [[0, 0], [0.5, 0.5], [1, 0]],
      bottom: [[1, 1], [0.5, 0.5], [0, 1]],
    },
  };
  for (const idx of [3, 4, 5]) {
    for (const side of SIDES) {
      it(`state ${idx} on '${side}'`, () => {
        const got = pts(state(idx), side);
        const want = EXPECTED[idx]![side];
        expect(got.length).toBe(3);
        got.forEach((p, i) => near(p, want[i]![0], want[i]![1]));
      });
    }
  }
});

describe('the fan states, per connection side', () => {
  // Apex, then the arc from its first point to its last, and the 45° point in between. The arc is a
  // quarter circle of canonical radius 2 — half a cell in each direction — so in a unit cell every
  // arc point is exactly 1 away from the apex, and the 45° one sits at √2/2 along both axes from it.
  const EXPECTED: Record<number, Record<RoadConnSide, { apex: RoadPt; first: RoadPt; mid: RoadPt; last: RoadPt }>> = {
    1: { // BR fan: apex (0,0), arc (2,0) → (0,2)
      left: { apex: [0, 0], first: [1, 0], mid: [D, D], last: [0, 1] },
      right: { apex: [1, 0], first: [0, 0], mid: [E, D], last: [1, 1] },
      top: { apex: [0, 0], first: [0, 1], mid: [D, D], last: [1, 0] },
      bottom: { apex: [1, 1], first: [1, 0], mid: [E, E], last: [0, 1] },
    },
    2: { // TR fan: apex (0,2), arc (2,2) → (0,0)
      left: { apex: [0, 1], first: [1, 1], mid: [D, E], last: [0, 0] },
      right: { apex: [1, 1], first: [0, 1], mid: [E, E], last: [1, 0] },
      top: { apex: [1, 0], first: [1, 1], mid: [E, D], last: [0, 0] },
      bottom: { apex: [0, 1], first: [0, 0], mid: [D, E], last: [1, 1] },
    },
  };
  for (const idx of [1, 2]) {
    for (const side of SIDES) {
      it(`state ${idx} on '${side}'`, () => {
        const got = pts(state(idx), side);
        const want = EXPECTED[idx]![side];
        // One apex plus a closed quarter arc: both endpoints are drawn.
        expect(got.length).toBe(ROAD_ARC_STEPS + 2);
        near(got[0]!, want.apex[0], want.apex[1]);
        near(got[1]!, want.first[0], want.first[1]);
        near(got[got.length - 1]!, want.last[0], want.last[1]);
        near(got[1 + ROAD_ARC_STEPS / 2]!, want.mid[0], want.mid[1]);
      });

      it(`state ${idx} on '${side}' is a quarter circle of the cell's own radius`, () => {
        const got = pts(state(idx), side);
        const [ax, ay] = got[0]!;
        const arc = got.slice(1);
        // RADIUS: canonical 2 over a canonical width of 2 = the full cell edge.
        for (const [x, y] of arc) expect(Math.hypot(x - ax, y - ay)).toBeCloseTo(1, 9);
        // SWEEP: a quarter turn end to end, walked in equal steps.
        const angle = ([x, y]: RoadPt): number => Math.atan2(y - ay, x - ax);
        const step = (i: number): number => {
          let d = angle(arc[i + 1]!) - angle(arc[i]!);
          if (d > Math.PI) d -= 2 * Math.PI;
          if (d < -Math.PI) d += 2 * Math.PI;
          return d;
        };
        const first = step(0);
        expect(Math.abs(first)).toBeCloseTo(Math.PI / 2 / ROAD_ARC_STEPS, 9);
        for (let i = 1; i < arc.length - 1; i++) expect(step(i)).toBeCloseTo(first, 9);
      });
    }
  }
});

describe('what has no drawn shape', () => {
  it('a full square is the whole cell, not a polygon', () => {
    expect(roadCanonicalPoly(['square', 'square', 'square', 'square'])).toBeNull();
    expect(hasRoadTrimShape(['square', 'square', 'square', 'square'])).toBe(false);
    expect(roadShapePoints(['square', 'square', 'square', 'square'], 'left', 0, 0, 1, 1)).toBeNull();
  });

  it('undefined corners, and a corner set matching no canonical state, fall back the same way', () => {
    expect(roadCanonicalPoly(undefined)).toBeNull();
    expect(hasRoadTrimShape(undefined)).toBe(false);
    // A terrain-style Γ fillet is not a road state: nothing must try to draw it as one.
    expect(roadCanonicalPoly(['fan', 'empty', 'empty', 'empty'])).toBeNull();
    expect(roadCanonicalPoly(['tri-NW', 'square', 'square', 'square'])).toBeNull();
  });

  it('every canonical state except the untrimmed one HAS a shape', () => {
    expect(hasRoadTrimShape(CANONICAL_ROAD_STATES[0])).toBe(false);
    for (let i = 1; i < CANONICAL_ROAD_STATES.length; i++) {
      expect(hasRoadTrimShape(state(i)), `state ${i}`).toBe(true);
    }
  });
});

describe('the polygon covers the fraction of the cell its state claims', () => {
  /** Shoelace area of the drawn polygon in a unit cell. */
  const area = (p: RoadPt[]): number => {
    let a = 0;
    for (let i = 0; i < p.length; i++) {
      const [x1, y1] = p[i]!, [x2, y2] = p[(i + 1) % p.length]!;
      a += x1 * y2 - x2 * y1;
    }
    return Math.abs(a) / 2;
  };
  // A fan keeps a quarter DISC of radius 1 (area π/4), drawn as ROAD_ARC_STEPS chords — an
  // inscribed fan of n triangles, so exactly (n/2)·sin(θ/n) and a hair under π/4. Stating it
  // exactly rather than approximately is what makes this sensitive to the radius: the area goes
  // with its square, so a 1.5% shrink of the curve is a 3% miss here.
  const QUARTER_DISC = (ROAD_ARC_STEPS / 2) * Math.sin(Math.PI / 2 / ROAD_ARC_STEPS);
  const WANT: Record<number, number> = { 1: QUARTER_DISC, 2: QUARTER_DISC, 3: 0.5, 4: 0.5, 5: 0.25 };
  for (const idx of [1, 2, 3, 4, 5]) {
    for (const side of SIDES) {
      it(`state ${idx} on '${side}'`, () => {
        expect(area(pts(state(idx), side))).toBeCloseTo(WANT[idx]!, 9);
      });
    }
  }
  it('and the fans are within a fraction of a percent of the true quarter disc', () => {
    expect(QUARTER_DISC).toBeCloseTo(Math.PI / 4, 2);
    expect(QUARTER_DISC).toBeLessThan(Math.PI / 4);
  });
});
