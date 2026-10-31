/**
 * The road ghost wears the cuts the lay will make. A road's cut depends on its connected sides and on
 * what its neighbours took first, so each case drives the real DrawingTool, keeps the ghost it
 * emitted, commits, and compares the map's road corners and connections with the ghost's promise.
 */
import { describe, it, expect } from 'vitest';
import { DrawingTool } from '../../../tools/pointer/paint/drawing-tool';
import { getObjectIndex, roadLookup } from '../../../state/object-index';
import { CANONICAL_ROAD_STATES, cornersMatch, detectRoadConn } from '../../../core/domain/edge-cut/road-cut-states';
import { roadShapePoints } from '../../../view/shared/road/shape';
import { applyAutoEdgeCut } from '../../../tools/trim/auto-edge-cut';
import { roadTrimmedOutline } from '../../../view/shared/overlay/ghost-geometry';
import { cellDecals } from '../../../view/map3d/geometry/overlay-decals';
import { mapCenterOffset } from '../../../view/map3d/geometry/coords';
import { CommandType, TerrainType, type Corners, type GridState, type MacroCoord } from '../../../core/model/types';
import { type AutoEdgeCut } from '../../../state/editing/vocabulary';
import type { RowSpan } from '../../../core/grid/cell-spans';
import type { TrimmedCell } from '../../../tools/trim/trim-preview';
import { makeState, setTerrain, makeExecutor } from '../../_support/map-state';
import { makeToolCtx, arm } from '../../_support/tool-ctx';
import { cell, point } from '../../_support/grid';

type Ghost = { cells: MacroCoord[]; trim: readonly TrimmedCell[] };

function world(autoEdgeCut: AutoEdgeCut, mode: 'line' | 'rect' | 'free' = 'line') {
  const state = makeState(30, 30) as GridState;
  const executor = makeExecutor(state);
  const ghosts: Ghost[] = [];
  const ctx = {
    ...makeToolCtx(state, executor, 1, 1, { autoEdgeCut, contentType: 'road', tileMaterial: 'path-overgrown-dirt' }),
    overlay: {
      showGhost({ cells }: { cells: MacroCoord[] }, _c: number, trim?: readonly TrimmedCell[]) {
        ghosts.push({ cells, trim: trim ?? [] });
      },
      showGhostSpans(spans: RowSpan[], _c: number, _t?: boolean, trim?: readonly TrimmedCell[]) {
        const cells: MacroCoord[] = [];
        for (const s of spans) for (let x = s.x; x < s.x + s.w; x++) cells.push({ x, y: s.y });
        ghosts.push({ cells, trim: trim ?? [] });
      },
      clearGhost() {}, flashCommit() {},
    } as never,
  };
  const tool = new DrawingTool();
  arm(ctx, { contentType: 'road', shape: mode });
  tool.onActivate(ctx);
  return { state, executor, ctx, tool, ghosts };
}

/** Pave these cells outright, as an already-built road on the map. */
function pave(w: ReturnType<typeof world>, cells: MacroCoord[]): void {
  for (const c of cells) {
    w.executor.execute({
      type: CommandType.PlaceObject,       object: { id: `built-${c.x}-${c.y}`, catalogId: 'path-overgrown-dirt', position: c, rotation: 0, elevation: 0 },
    });
  }
}

/** Every cut road on the map, as "x,y conn corners": the committed truth. */
function laid(state: GridState, only?: Set<string>): string[] {
  const roads = roadLookup(state);
  const out: string[] = [];
  for (const obj of state.objects.values()) {
    if (!obj.corners || obj.corners.every((c) => c === 'square')) continue;
    const k = `${obj.position.x},${obj.position.y}`;
    if (only && !only.has(k)) continue;
    out.push(`${k} ${detectRoadConn(roads, obj)} ${obj.corners.join('|')}`);
  }
  return out.sort();
}

/** The ghost's promise in the same shape. */
function promised(trim: readonly TrimmedCell[]): string[] {
  return trim.map((t) => `${t.x},${t.y} ${t.road} ${t.corners.join('|')}`).sort();
}

/** Draw the shape, keep the last ghost, then commit it. */
function drawAndCommit(w: ReturnType<typeof world>, from: MacroCoord, to: MacroCoord): Ghost {
  w.tool.onPointerDown(cell(from), point({ x: 0, y: 0 }), w.ctx);
  w.tool.onPointerMove(cell(to), point({ x: 0, y: 0 }), w.ctx);
  const last = w.ghosts[w.ghosts.length - 1]!;
  w.tool.onPointerUp(cell(to), point({ x: 0, y: 0 }), w.ctx);
  getObjectIndex(w.state);   // settle the index after the stroke, as the renderer's read would
  return last;
}

const cellsOf = (g: Ghost): Set<string> => new Set(g.cells.map((c) => `${c.x},${c.y}`));

/** One freehand dab: the ghost is drawn for the cell under the pointer before the move paints it,
 *  so what comes back is the promise, and the map right after holds what the promise was about. */
function dab(w: ReturnType<typeof world>, at: MacroCoord): Ghost {
  w.tool.onPointerMove(cell(at), point({ x: 0, y: 0 }), w.ctx);
  getObjectIndex(w.state);
  return w.ghosts[w.ghosts.length - 1]!;
}

describe('the road ghost predicts exactly what the lay commits', () => {
  const strokes: { name: string; from: MacroCoord; to: MacroCoord; mode?: 'line' | 'rect' }[] = [
    { name: 'a short horizontal run', from: { x: 5, y: 5 }, to: { x: 9, y: 5 } },
    { name: 'a single tile', from: { x: 7, y: 7 }, to: { x: 7, y: 7 } },
    { name: 'a vertical run', from: { x: 12, y: 4 }, to: { x: 12, y: 11 } },
    { name: 'a diagonal, which line4 walks as a staircase of bends', from: { x: 3, y: 3 }, to: { x: 10, y: 10 } },
    { name: 'a paved rectangle', from: { x: 4, y: 14 }, to: { x: 9, y: 19 }, mode: 'rect' },
  ];

  for (const mode of ['round', 'rect'] as const) {
    for (const s of strokes) {
      it(`${s.name} (${mode})`, () => {
        const w = world(mode, s.mode ?? 'line');
        const ghost = drawAndCommit(w, s.from, s.to);
        expect(promised(ghost.trim)).toEqual(laid(w.state, cellsOf(ghost)));
        expect(ghost.trim.length, 'a road stroke has ends, so it has cuts').toBeGreaterThan(0);
      });
    }
  }

  it('an L bend, where each leg decides the other end\'s cut', () => {
    const w = world('round');
    drawAndCommit(w, { x: 5, y: 5 }, { x: 11, y: 5 });
    // The second leg lands against the first: its cuts, and the corner tile's, depend on it.
    const ghost = drawAndCommit(w, { x: 11, y: 5 }, { x: 11, y: 12 });
    expect(promised(ghost.trim)).toEqual(laid(w.state, cellsOf(ghost)));
  });

  it('a stroke reaching an existing road: the tile that meets it is no end-cap', () => {
    const w = world('round');
    pave(w, [{ x: 20, y: 5 }, { x: 21, y: 5 }, { x: 22, y: 5 }]);
    const ghost = drawAndCommit(w, { x: 16, y: 5 }, { x: 19, y: 5 });
    expect(promised(ghost.trim)).toEqual(laid(w.state, cellsOf(ghost)));
    // The end that touches the built road connects, so only the far end is capped.
    expect(ghost.trim.some((t) => t.x === 19)).toBe(false);
    expect(ghost.trim.some((t) => t.x === 16)).toBe(true);
  });

  it('a cell the rules refuse is previewed as the end it actually leaves', () => {
    const w = world('round');
    // The flat trait also refuses the tile whose extended footprint reaches the water, so the run
    // breaks at x=7 and x=8 and both sides of the break are end-caps.
    setTerrain(w.state, 8, 5, TerrainType.Water, 0);
    const ghost = drawAndCommit(w, { x: 4, y: 5 }, { x: 11, y: 5 });
    expect(promised(ghost.trim)).toEqual(laid(w.state, cellsOf(ghost)));
    expect(ghost.trim.map((t) => t.x).sort((a, b) => a - b)).toEqual([4, 6, 9, 11]);
  });

  it('a cut it makes to a road already on the map is not drawn as part of the ghost', () => {
    const w = world('round');
    // Paving beside a lone built tile lets the trim cut it, a change to the map rather than to the
    // shape being placed.
    pave(w, [{ x: 20, y: 20 }]);
    const ghost = drawAndCommit(w, { x: 20, y: 21 }, { x: 20, y: 24 });
    expect(ghost.trim.some((t) => t.x === 20 && t.y === 20)).toBe(false);
    expect(promised(ghost.trim)).toEqual(laid(w.state, cellsOf(ghost)));
  });

  it('promises nothing with auto-trim off, and the lay leaves nothing', () => {
    const w = world('off');
    const ghost = drawAndCommit(w, { x: 5, y: 5 }, { x: 9, y: 5 });
    expect(ghost.trim.length).toBe(0);
    expect(laid(w.state)).toEqual([]);
  });

  it('promises only states the road painter can draw', () => {
    const w = world('round');
    const ghost = drawAndCommit(w, { x: 3, y: 3 }, { x: 10, y: 10 });
    for (const t of ghost.trim) {
      expect(CANONICAL_ROAD_STATES.some((s) => s && cornersMatch(s, t.corners))).toBe(true);
      expect(roadShapePoints(t.corners, t.road!, { x: t.x, y: t.y, w: 1, h: 1 })).not.toBeNull();
    }
  });
});

/**
 * The brush, every road item's placement mode, lays and trims as it moves, so the cut on the tile
 * beside a dab is provisional: the click re-derives the pair together, and the preview must too.
 */
describe('the road ghost sees its own stroke', () => {
  /** Three dabs in a row, each reconnecting to the last. */
  const RUN: MacroCoord[] = [{ x: 20, y: 22 }, { x: 21, y: 22 }, { x: 22, y: 22 }];

  it('a dab reconnecting to a tile an earlier dab of the same stroke cut', () => {
    const w = world('round', 'free');
    w.tool.onPointerDown(cell(RUN[0]!), point({ x: 0, y: 0 }), w.ctx);
    getObjectIndex(w.state);

    const second = dab(w, RUN[1]!);
    expect(promised(second.trim)).toEqual(laid(w.state, cellsOf(second)));

    // (21,22) still carries the end-cap it got while it was the end; a stale read promises nothing here.
    const third = dab(w, RUN[2]!);
    expect(third.trim.length, 'the dab is the new end, so it is capped').toBeGreaterThan(0);
    expect(promised(third.trim)).toEqual(laid(w.state, cellsOf(third)));

    w.tool.onPointerUp(cell(RUN[2]!), point({ x: 0, y: 0 }), w.ctx);
    getObjectIndex(w.state);
    expect(promised(third.trim)).toEqual(laid(w.state, cellsOf(third)));
  });

  it('every dab of a longer run, and of one that turns a corner', () => {
    for (const path of [
      [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }, { x: 9, y: 5 }],
      [{ x: 5, y: 12 }, { x: 6, y: 12 }, { x: 7, y: 12 }, { x: 7, y: 13 }, { x: 7, y: 14 }],
    ] as MacroCoord[][]) {
      const w = world('round', 'free');
      w.tool.onPointerDown(cell(path[0]!), point({ x: 0, y: 0 }), w.ctx);
      getObjectIndex(w.state);
      for (const at of path.slice(1)) {
        const g = dab(w, at);
        expect(promised(g.trim), `dab at ${at.x},${at.y}`).toEqual(laid(w.state, cellsOf(g)));
      }
      w.tool.onPointerUp(cell(path[path.length - 1]!), point({ x: 0, y: 0 }), w.ctx);
    }
  });

  it('leaves a cut that is NOT this stroke\'s alone, exactly as the click does', () => {
    const w = world('round', 'free');
    // The click squares only the tiles this stroke laid and skips an already trimmed road, so the
    // dab beside it derives against that cut.
    pave(w, [{ x: 15, y: 15 }, { x: 16, y: 15 }]);
    applyAutoEdgeCut({ state: w.state, execute: (cmd) => w.executor.execute(cmd) },
      'round', [], [{ x: 15, y: 15 }, { x: 16, y: 15 }]);
    getObjectIndex(w.state);
    const before = laid(w.state).slice();
    expect(before.length, 'the built pair is cut at both ends').toBe(2);

    w.tool.onPointerDown(cell({ x: 17, y: 15 }), point({ x: 0, y: 0 }), w.ctx);
    getObjectIndex(w.state);
    const g = dab(w, { x: 18, y: 15 });
    expect(promised(g.trim)).toEqual(laid(w.state, cellsOf(g)));
    expect(laid(w.state, new Set(['15,15']))).toEqual(before.filter((s) => s.startsWith('15,15')));
    w.tool.onPointerUp(cell({ x: 18, y: 15 }), point({ x: 0, y: 0 }), w.ctx);
  });

  it('a brush stroke over an L, dab by dab, in both trim kinds', () => {
    for (const kind of ['round', 'rect'] as const) {
      const w = world(kind, 'free');
      const path: MacroCoord[] = [
        { x: 24, y: 4 }, { x: 24, y: 5 }, { x: 24, y: 6 }, { x: 23, y: 6 }, { x: 22, y: 6 },
      ];
      w.tool.onPointerDown(cell(path[0]!), point({ x: 0, y: 0 }), w.ctx);
      getObjectIndex(w.state);
      for (const at of path.slice(1)) {
        const g = dab(w, at);
        expect(promised(g.trim), `${kind} dab at ${at.x},${at.y}`).toEqual(laid(w.state, cellsOf(g)));
      }
      w.tool.onPointerUp(cell(path[path.length - 1]!), point({ x: 0, y: 0 }), w.ctx);
    }
  });
});

describe('the views draw the promised road shape', () => {
  const WEDGE = [...CANONICAL_ROAD_STATES[5]!] as Corners;

  it('2D outline: a kept edge between two ghost tiles is a seam, not a silhouette', () => {
    // Two tiles side by side, the left one cut as a wedge connected on its right.
    const cells = [{ x: 5, y: 5 }, { x: 6, y: 5 }];
    const edges = roadTrimmedOutline(cells, [{ x: 5, y: 5, corners: WEDGE, road: 'E' }]);
    // The shared boundary x=6 is the wedge's own kept edge; drawing it would put a bright line
    // through the middle of a continuous road.
    const seam = edges.filter((e) => e.ax === 6 && e.bx === 6 && Math.min(e.ay, e.by) >= 5 && Math.max(e.ay, e.by) <= 6);
    expect(seam).toEqual([]);
    // The wedge's diagonal cut is drawn.
    expect(edges.some((e) => e.ax !== e.bx && e.ay !== e.by)).toBe(true);
  });

  it('2D outline: an untrimmed ghost tile still gets its exposed sides', () => {
    const edges = roadTrimmedOutline([{ x: 5, y: 5 }, { x: 6, y: 5 }], [{ x: 5, y: 5, corners: WEDGE, road: 'E' }]);
    // The right tile is square, so its own far side, top and bottom are silhouette.
    expect(edges.filter((e) => e.ax === 7 && e.bx === 7).length).toBe(1);
  });

  it('3D decal: a road trim drapes the road polygon, not four quadrants', () => {
    const s = makeState(20, 20) as GridState;
    const square = cellDecals(s, [{ x: 5, y: 5 }], 'object', []);
    const wedge = cellDecals(s, [{ x: 5, y: 5 }], 'object', [{ x: 5, y: 5, corners: WEDGE, patch: false, road: 'W' }]);
    // The wedge triangle is (0,0)-(1,1)-(0,2) in the canonical [0,2]² frame: a quarter of the cell.
    const area = (m: { positions: number[]; index: number[] }): number => {
      let total = 0;
      for (let i = 0; i < m.index.length; i += 3) {
        const at = (k: number): [number, number] => {
          const v = m.index[i + k]! * 3;
          return [m.positions[v]!, m.positions[v + 2]!];
        };
        const [ax, az] = at(0), [bx, bz] = at(1), [cx, cz] = at(2);
        total += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
      }
      return total;
    };
    expect(area(square)).toBeCloseTo(1, 6);
    expect(area(wedge)).toBeCloseTo(0.25, 6);
  });

  // Wiring only: the 3D ghost uses the shared builder on the right cell. The builder's geometry is
  // pinned in `__tests__/view/shared/road/shape.test.ts`.
  it('3D decal: the polygon is the shared road shape, vertex for vertex', () => {
    const s = makeState(20, 20) as GridState;
    const fan = [...CANONICAL_ROAD_STATES[1]!] as Corners;
    const m = cellDecals(s, [], 'object', [{ x: 5, y: 5, corners: fan, patch: false, road: 'N' }]);
    const got = new Set<string>();
    for (let i = 0; i < m.positions.length; i += 3) got.add(`${m.positions[i]!.toFixed(6)},${m.positions[i + 2]!.toFixed(6)}`);
    const off = mapCenterOffset(s.template.width, s.template.height);
    const want = new Set(roadShapePoints(fan, 'N', { x: 5 - off.x, y: 5 - off.z, w: 1, h: 1 })!
      .map(([x, z]) => `${x.toFixed(6)},${z.toFixed(6)}`));
    expect(got).toEqual(want);
  });
});
