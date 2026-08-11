/**
 * The ROAD ghost wears the cuts the lay will make.
 *
 * A road's cut is connection-aware: which canonical state a tile takes depends on which sides it
 * connects on, and on what its neighbours took first. So the only pin worth having is EQUALITY with
 * the real thing — drive the actual DrawingTool, keep the ghost payload it emitted, then let the
 * stroke commit and compare the map's own road corners (and connection sides) against what the
 * ghost promised for those same cells.
 *
 * The preview does not re-derive any of that geometry: it runs `applyAutoEdgeCut` itself, over a
 * coating LOOKUP shadowing the tiles the stroke has not laid yet.
 */
import { describe, it, expect } from 'vitest';
import { DrawingTool } from '../../tools/paint/drawing-tool';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { getObjectIndex, roadLookup } from '../../state/object-index';
import { CANONICAL_ROAD_STATES, cornersMatch, detectRoadConn } from '../../core/edge-cut/road-cut-states';
import { roadShapePoints } from '../../core/edge-cut/road-shape';
import { applyAutoEdgeCut } from '../../tools/edge-cut/auto-edge-cut';
import { roadTrimmedOutline } from '../../canvas/map2d/layers/ghost-geometry';
import { cellDecals } from '../../canvas/map3d/build/overlay-decals';
import { mapCenterOffset } from '../../canvas/map3d/core/coords';
import {
  CommandType, TerrainType,
  type AutoEdgeCut, type Corners, type EditorEvents, type GridState, type MacroCoord,
} from '../../core/model/types';
import type { RowSpan } from '../../canvas/map2d/layers/ghost-geometry';
import type { TrimmedCell } from '../../tools/edge-cut/trim-preview';
import { makeState, setTerrain } from '../rules/_helpers';
import { makeToolCtx } from './_tool-ctx';

type Ghost = { cells: MacroCoord[]; trim: readonly TrimmedCell[] };

function world(autoEdgeCut: AutoEdgeCut, mode: 'line' | 'rect' | 'brush' = 'line') {
  const state = makeState(30, 30) as GridState;
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  const ghosts: Ghost[] = [];
  const ctx = {
    ...makeToolCtx(state, executor, 1, 1, { autoEdgeCut, contentType: 'tile', tileMaterial: 'road-dirt' }),
    overlay: {
      showGhost(cells: MacroCoord[], _c: number, _t?: boolean, trim?: readonly TrimmedCell[]) {
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
  tool.contentType = 'tile';
  tool.mode = mode;
  tool.onActivate(ctx);
  return { state, executor, ctx, tool, ghosts };
}

/** Pave these cells outright, as an already-built road on the map. */
function pave(w: ReturnType<typeof world>, cells: MacroCoord[]): void {
  for (const c of cells) {
    w.executor.execute({
      type: CommandType.PlaceObject, timestamp: 1,
      object: { id: `built-${c.x}-${c.y}`, catalogId: 'road-dirt', position: c, rotation: 0, elevation: 0 },
      loadValue: 0,
    });
  }
}

/** Every cut road on the map, as "x,y conn corners" — the committed truth. */
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
  w.tool.onPointerDown(from, { x: 0, y: 0 }, w.ctx);
  w.tool.onPointerMove(to, { x: 0, y: 0 }, w.ctx);
  const last = w.ghosts[w.ghosts.length - 1]!;
  w.tool.onPointerUp(to, { x: 0, y: 0 }, w.ctx);
  getObjectIndex(w.state);   // settle the index after the stroke, as the renderer's read would
  return last;
}

const cellsOf = (g: Ghost): Set<string> => new Set(g.cells.map((c) => `${c.x},${c.y}`));

/** One freehand dab: the ghost is drawn for the cell under the pointer BEFORE the move paints it,
 *  so what comes back is the promise, and the map right after holds what the promise was about. */
function dab(w: ReturnType<typeof world>, at: MacroCoord): Ghost {
  w.tool.onPointerMove(at, { x: 0, y: 0 }, w.ctx);
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
    // A road cannot be laid on water, and the flat trait also refuses the tile whose extended
    // footprint reaches it — so a run crossing one breaks two cells short, and both sides of the
    // break are end-caps the ghost has to show rather than a through-road.
    setTerrain(w.state, 8, 5, TerrainType.Water, 0);
    const ghost = drawAndCommit(w, { x: 4, y: 5 }, { x: 11, y: 5 });
    expect(promised(ghost.trim)).toEqual(laid(w.state, cellsOf(ghost)));
    expect(ghost.trim.map((t) => t.x).sort((a, b) => a - b)).toEqual([4, 6, 9, 11]);
  });

  it('a cut it makes to a road already on the map is not drawn as part of the ghost', () => {
    const w = world('round');
    // A lone built tile, square. Paving beside it makes it a bend the trim can cut — a change to
    // the MAP, not to the shape being placed, so the ghost must not draw over it.
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
      expect(roadShapePoints(t.corners, t.road!, t.x, t.y, 1, 1)).not.toBeNull();
    }
  });
});

/**
 * The BRUSH is every road item's placementMode, and it is the one mode that previews a dab against
 * a map the same stroke has already been editing: it lays as it moves and trims what it has laid,
 * so the cut standing on the tile beside this dab is provisional — the click takes it back and
 * derives the pair together. A preview reading that cut as settled finds no state its neighbour
 * will accept and promises nothing where the click cuts a wedge.
 */
describe('the road ghost sees its own stroke', () => {
  /** The stroke that produced the divergence: three dabs in a row, each reconnecting to the last. */
  const RUN: MacroCoord[] = [{ x: 20, y: 22 }, { x: 21, y: 22 }, { x: 22, y: 22 }];

  it('a dab reconnecting to a tile an earlier dab of the same stroke cut', () => {
    const w = world('round', 'brush');
    w.tool.onPointerDown(RUN[0]!, { x: 0, y: 0 }, w.ctx);
    getObjectIndex(w.state);

    const second = dab(w, RUN[1]!);
    expect(promised(second.trim)).toEqual(laid(w.state, cellsOf(second)));

    // The third is the one that used to come back empty: (21,22) was carrying the end-cap it was
    // given while it still WAS the end.
    const third = dab(w, RUN[2]!);
    expect(third.trim.length, 'the dab is the new end, so it is capped').toBeGreaterThan(0);
    expect(promised(third.trim)).toEqual(laid(w.state, cellsOf(third)));

    w.tool.onPointerUp(RUN[2]!, { x: 0, y: 0 }, w.ctx);
    getObjectIndex(w.state);
    // And the finished stroke agrees with the last thing the ghost said about that cell.
    expect(promised(third.trim)).toEqual(laid(w.state, cellsOf(third)));
  });

  it('every dab of a longer run, and of one that turns a corner', () => {
    for (const path of [
      [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }, { x: 9, y: 5 }],
      [{ x: 5, y: 12 }, { x: 6, y: 12 }, { x: 7, y: 12 }, { x: 7, y: 13 }, { x: 7, y: 14 }],
    ] as MacroCoord[][]) {
      const w = world('round', 'brush');
      w.tool.onPointerDown(path[0]!, { x: 0, y: 0 }, w.ctx);
      getObjectIndex(w.state);
      for (const at of path.slice(1)) {
        const g = dab(w, at);
        expect(promised(g.trim), `dab at ${at.x},${at.y}`).toEqual(laid(w.state, cellsOf(g)));
      }
      w.tool.onPointerUp(path[path.length - 1]!, { x: 0, y: 0 }, w.ctx);
    }
  });

  it('leaves a cut that is NOT this stroke\'s alone, exactly as the click does', () => {
    const w = world('round', 'brush');
    // A built road with a real cut on it. The click squares only the tiles THIS stroke laid, and
    // skips a road that is already trimmed — so the dab beside it is derived against that cut, and
    // the preview has to read it rather than assume it away.
    pave(w, [{ x: 15, y: 15 }, { x: 16, y: 15 }]);
    applyAutoEdgeCut({ gridState: w.state, executeCommand: (cmd) => w.executor.execute(cmd) },
      'round', [], [{ x: 15, y: 15 }, { x: 16, y: 15 }]);
    getObjectIndex(w.state);
    const before = laid(w.state).slice();
    expect(before.length, 'the built pair is cut at both ends').toBe(2);

    w.tool.onPointerDown({ x: 17, y: 15 }, { x: 0, y: 0 }, w.ctx);
    getObjectIndex(w.state);
    const g = dab(w, { x: 18, y: 15 });
    expect(promised(g.trim)).toEqual(laid(w.state, cellsOf(g)));
    // The built road's own cut is untouched by a stroke that never laid it.
    expect(laid(w.state, new Set(['15,15']))).toEqual(before.filter((s) => s.startsWith('15,15')));
    w.tool.onPointerUp({ x: 18, y: 15 }, { x: 0, y: 0 }, w.ctx);
  });

  it('a brush stroke over an L, dab by dab, in both trim kinds', () => {
    for (const kind of ['round', 'rect'] as const) {
      const w = world(kind, 'brush');
      const path: MacroCoord[] = [
        { x: 24, y: 4 }, { x: 24, y: 5 }, { x: 24, y: 6 }, { x: 23, y: 6 }, { x: 22, y: 6 },
      ];
      w.tool.onPointerDown(path[0]!, { x: 0, y: 0 }, w.ctx);
      getObjectIndex(w.state);
      for (const at of path.slice(1)) {
        const g = dab(w, at);
        expect(promised(g.trim), `${kind} dab at ${at.x},${at.y}`).toEqual(laid(w.state, cellsOf(g)));
      }
      w.tool.onPointerUp(path[path.length - 1]!, { x: 0, y: 0 }, w.ctx);
    }
  });
});

describe('the views draw the promised road shape', () => {
  const WEDGE = [...CANONICAL_ROAD_STATES[5]!] as Corners;

  it('2D outline: a kept edge between two ghost tiles is a seam, not a silhouette', () => {
    // Two tiles side by side, the left one cut as a wedge connected on its right.
    const cells = [{ x: 5, y: 5 }, { x: 6, y: 5 }];
    const edges = roadTrimmedOutline(cells, [{ x: 5, y: 5, corners: WEDGE, road: 'right' }]);
    // The shared boundary x=6 is the wedge's own kept edge; drawing it would put a bright line
    // through the middle of a continuous road.
    const seam = edges.filter((e) => e.ax === 6 && e.bx === 6 && Math.min(e.ay, e.by) >= 5 && Math.max(e.ay, e.by) <= 6);
    expect(seam).toEqual([]);
    // And the cut itself is drawn: the wedge's two diagonals are neither axis-aligned nor absent.
    expect(edges.some((e) => e.ax !== e.bx && e.ay !== e.by)).toBe(true);
  });

  it('2D outline: an untrimmed ghost tile still gets its exposed sides', () => {
    const edges = roadTrimmedOutline([{ x: 5, y: 5 }, { x: 6, y: 5 }], [{ x: 5, y: 5, corners: WEDGE, road: 'right' }]);
    // The right tile is square, so its own far side, top and bottom are silhouette.
    expect(edges.filter((e) => e.ax === 7 && e.bx === 7).length).toBe(1);
  });

  it('3D decal: a road trim drapes the road polygon, not four quadrants', () => {
    const s = makeState(20, 20) as GridState;
    const square = cellDecals(s, [{ x: 5, y: 5 }], false, []);
    const wedge = cellDecals(s, [{ x: 5, y: 5 }], false, [{ x: 5, y: 5, corners: WEDGE, patch: false, road: 'left' }]);
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

  // WIRING, not geometry: this compares the decal against the shared builder, so it pins that the
  // 3D ghost goes through it and places it on the right cell — it cannot notice a bug inside the
  // builder itself. The builder's own coordinates are pinned against hand-worked literals in
  // `__tests__/core/road-shape.test.ts`.
  it('3D decal: the polygon is the shared road shape, vertex for vertex', () => {
    const s = makeState(20, 20) as GridState;
    const fan = [...CANONICAL_ROAD_STATES[1]!] as Corners;
    const m = cellDecals(s, [], false, [{ x: 5, y: 5, corners: fan, patch: false, road: 'top' }]);
    const got = new Set<string>();
    for (let i = 0; i < m.positions.length; i += 3) got.add(`${m.positions[i]!.toFixed(6)},${m.positions[i + 2]!.toFixed(6)}`);
    const off = mapCenterOffset(s.template.width, s.template.height);
    const want = new Set(roadShapePoints(fan, 'top', 5 - off.x, 5 - off.z, 1, 1)!
      .map(([x, z]) => `${x.toFixed(6)},${z.toFixed(6)}`));
    expect(got).toEqual(want);
  });
});
