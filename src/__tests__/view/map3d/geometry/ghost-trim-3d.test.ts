/**
 * The 3D ghost trims where the stroke will.
 *
 * `ToolOverlay.showGhost` already carried the trim the stroke's auto-trim pass will apply — the
 * tool works it out once (`previewAutoTrim`) and hands it to whichever view is live. The 2D overlay
 * drew it; the 3D one dropped the argument, so every 3D preview promised square corners over a
 * stroke that commits rounded ones. These pin the geometry that closes it, and that the payload
 * crossing the seam is the tool's own rather than a second derivation.
 *
 * The decal builder is pure (data in, positions out), so the shape questions are answered without a
 * GPU; the one class-level pin is that OverlayLayer3D actually forwards what it is given.
 */
import { describe, it, expect } from 'vitest';
import { cellDecals, DECAL_LIFT, type DecalMesh } from '../../../../view/map3d/geometry/overlay-decals';
import { cornerPolygon } from '../../../../view/shared/terrain/quadrant-poly';
import { OverlayLayer3D } from '../../../../view/map3d/layers/overlay-layer';
import { layerToY } from '../../../../view/map3d/geometry/coords';
import { DrawingTool } from '../../../../tools/pointer/paint/drawing-tool';
import { filletOnly } from '../../../../view/shared/overlay/ghost-geometry';
import { CommandType, TerrainType, type Corners, type GridState, type MacroCoord } from '../../../../core/model/types';
import type { TrimmedCell } from '../../../../tools/trim/trim-preview';
import { makeState, setTerrain, makeExecutor } from '../../../_support/map-state';
import { makeToolCtx, arm } from '../../../_support/tool-ctx';
import { cell, point } from '../../../_support/grid';
import { mixedCellSet } from '../../../../core/grid/grids';

/** Total XZ area the decal mesh covers, summed over its triangles — a square cell is 1. */
function area(m: DecalMesh): number {
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
}

/** Every vertex, rounded to a comparable key. */
const verts = (m: DecalMesh): Set<string> => {
  const out = new Set<string>();
  for (let i = 0; i < m.positions.length; i += 3) {
    out.add(`${m.positions[i]!.toFixed(6)},${m.positions[i + 2]!.toFixed(6)}`);
  }
  return out;
};

const heights = (m: DecalMesh): number[] => {
  const ys = new Set<number>();
  for (let i = 1; i < m.positions.length; i += 3) ys.add(Number(m.positions[i]!.toFixed(6)));
  return [...ys];
};

const trimOf = (x: number, y: number, corners: Corners, patch = false): TrimmedCell => ({ x, y, corners, patch });
const SQUARE: Corners = ['square', 'square', 'square', 'square'];

describe('3D ghost decals: the trimmed shape', () => {
  it('is the square footprint when nothing is trimmed', () => {
    const s = makeState(20, 20) as GridState;
    const cells = [{ x: 5, y: 5 }, { x: 6, y: 5 }];
    const plain = cellDecals(s, cells, 'terrain');
    expect(area(plain)).toBeCloseTo(2, 6);
    // An empty trim list is the same request, not a different one.
    expect(cellDecals(s, cells, 'terrain', []).positions).toEqual(plain.positions);
  });

  it('takes the cut quadrant off the cell instead of drawing a square over it', () => {
    const s = makeState(20, 20) as GridState;
    const cells = [{ x: 5, y: 5 }];
    const square = area(cellDecals(s, cells, 'terrain'));
    const rounded = area(cellDecals(s, cells, 'terrain', [trimOf(5, 5, ['fan', 'square', 'square', 'square'])]));
    // A rounded corner keeps π/4 of its quadrant (approximated by the fan's straight steps), so the
    // cell loses a little under a sixteenth of itself — and loses it exactly once: a leftover square
    // under the trimmed cell would have kept the area at 1.
    expect(rounded).toBeLessThan(square);
    expect(rounded).toBeGreaterThan(square - 0.25);
    expect(square - rounded).toBeCloseTo(0.25 - Math.PI / 16, 2);

    const gone = area(cellDecals(s, cells, 'terrain', [trimOf(5, 5, ['empty', 'square', 'square', 'square'])]));
    expect(gone).toBeCloseTo(0.75, 6);
  });

  it('draws each quadrant as the terrain mesher does — the shared cornerPolygon, not a second derivation', () => {
    const s = makeState(20, 20) as GridState;
    const corners: Corners = ['tri-NW', 'empty', 'square', 'fan'];
    const m = cellDecals(s, [{ x: 5, y: 5 }], 'terrain', [trimOf(5, 5, corners)]);
    // The cell's world origin, read back off the mesh rather than recomputed.
    const xs = [...verts(m)].map((k) => k.split(',').map(Number) as [number, number]);
    const x0 = Math.min(...xs.map((p) => p[0])), z0 = Math.min(...xs.map((p) => p[1]));

    const expected = new Set<string>();
    const quad: [number, number][] = [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]];
    const pos = ['TL', 'TR', 'BL', 'BR'] as const;
    for (let i = 0; i < 4; i++) {
      const poly = cornerPolygon(corners[i]!, { x: x0 + quad[i]![0], z: z0 + quad[i]![1], s: 0.5, pos: pos[i]! }, false);
      for (const [px, pz] of poly ?? []) expected.add(`${px.toFixed(6)},${pz.toFixed(6)}`);
    }
    expect(verts(m)).toEqual(expected);
  });

  it('drapes every quadrant of a cell on that cell\'s own surface', () => {
    const s = makeState(20, 20) as GridState;
    setTerrain(s, 5, 5, TerrainType.Mountain, 3);
    const m = cellDecals(s, [{ x: 5, y: 5 }], 'terrain', [trimOf(5, 5, ['fan', 'square', 'tri-NE', 'square'])]);
    // An edge cut is silhouette-only: the cell's standable surface is the same under all four.
    expect(heights(m)).toEqual([Number((layerToY(3) + DECAL_LIFT).toFixed(6))]);
  });

  it('draws a Γ patch the stroke does not paint', () => {
    const s = makeState(20, 20) as GridState;
    // The notch-fill lands on a cell the stroke never lists; the ghost still has to show it.
    const m = cellDecals(s, [{ x: 5, y: 5 }], 'terrain', [trimOf(9, 9, ['fan', 'empty', 'empty', 'empty'], true)]);
    const xs = [...verts(m)].map((k) => Number(k.split(',')[0]));
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(3);   // two cells apart, both drawn
    expect(area(m)).toBeGreaterThan(1);
  });

  it('gives a Γ patch the inner fan winding the fillet is committed with', () => {
    const s = makeState(20, 20) as GridState;
    const corners: Corners = ['fan', 'empty', 'empty', 'empty'];
    const patch = cellDecals(s, [], 'terrain', [trimOf(5, 5, corners, true)]);
    const outer = cellDecals(s, [], 'terrain', [trimOf(5, 5, corners, false)]);
    // Same area (both are a quarter disc), opposite anchor: the fillet's arc bulges into the notch
    // it fills, so the two share only the quadrant's diagonal endpoints.
    expect(area(patch)).toBeCloseTo(area(outer), 6);
    expect(verts(patch)).not.toEqual(verts(outer));
  });

  it('skips a trimmed cell that is far off the map, like an untrimmed one', () => {
    const s = makeState(20, 20) as GridState;
    expect(cellDecals(s, [], 'terrain', [trimOf(-10_000, -10_000, SQUARE)]).positions.length).toBe(0);
  });
});

/** A flat map with a layer-1 plain, and a mountain brush armed a layer above it — the stroke whose
 *  corners auto-trim rounds. Returns the ghost payloads the tool issues. */
function world(autoEdgeCut: 'off' | 'round') {
  const state = makeState(40, 40);
  const executor = makeExecutor(state);
  const ghost: { cells: MacroCoord[]; trim: readonly TrimmedCell[] }[] = [];
  const ctx = {
    ...makeToolCtx(state, executor, 3, 2, { autoEdgeCut }),
    overlay: {
      showGhost(set: { cells: MacroCoord[] }, _c: number, trim?: readonly TrimmedCell[]) {
        ghost.push({ cells: set.cells, trim: trim ?? [] });
      },
      showGhostSpans() {}, clearGhost() {}, flashCommit() {},
    } as never,
  };
  const plain: MacroCoord[] = [];
  for (let y = 8; y <= 24; y++) for (let x = 8; x <= 24; x++) plain.push({ x, y });
  const start = executor.beginStroke();
  executor.execute({ type: CommandType.PaintTerrain, cells: plain, terrainType: TerrainType.Mountain, elevation: 1 });
  start.commit();

  const tool = new DrawingTool();
  arm(ctx, { shape: 'free', contentType: 'mountain' });
  tool.onActivate(ctx);
  return { state, ctx, tool, ghost };
}

describe('the seam: one payload, both views', () => {
  it('the trim the tool computes reaches the 3D geometry', () => {
    const w = world('round');
    w.tool.onPointerMove(cell({ x: 16, y: 16 }), point({ x: 0, y: 0 }), w.ctx);
    const promised = w.ghost[w.ghost.length - 1]!;
    expect(promised.trim.length, 'a brush dab a layer up rounds its exposed corners').toBeGreaterThan(0);

    // The same payload object the 2D overlay is handed, with no 3D-side recomputation: the tool
    // never learns which view is live.
    const trim = promised.trim.map((t) => ({ x: t.x, y: t.y, patch: t.patch, corners: filletOnly(t.corners, t.patch) as Corners }));
    const square = area(cellDecals(w.state, promised.cells, 'terrain'));
    const shaped = area(cellDecals(w.state, promised.cells, 'terrain', trim));
    expect(shaped).toBeLessThan(square);
    // Every cell the payload named lost part of itself, and none lost more than the cut it
    // describes could take (a per-cell average, so the pin survives a different mix of corners).
    const lostPerCell = (square - shaped) / promised.trim.length;
    expect(lostPerCell).toBeGreaterThan(0.01);
    expect(lostPerCell).toBeLessThan(0.75);
  });

  it('with auto-trim off the two are the same square footprint', () => {
    const w = world('off');
    w.tool.onPointerMove(cell({ x: 16, y: 16 }), point({ x: 0, y: 0 }), w.ctx);
    const promised = w.ghost[w.ghost.length - 1]!;
    expect(promised.trim.length).toBe(0);
    expect(area(cellDecals(w.state, promised.cells, 'terrain', []))).toBeCloseTo(promised.cells.length, 6);
  });

  it('OverlayLayer3D forwards the trim it is given rather than dropping the argument', () => {
    const s = makeState(20, 20) as GridState;
    const cells = [{ x: 5, y: 5 }, { x: 6, y: 5 }];
    const built = (trim?: readonly TrimmedCell[]) => {
      const o = new OverlayLayer3D({ state: () => s, requestRender: () => {} });
      o.showGhost(mixedCellSet('terrain', cells), { wash: 'placement', valid: true }, trim);
      o.flush();
      const mesh = o.group.children.find((c) => (c as { isMesh?: boolean }).isMesh) as
        { geometry: { getAttribute(n: string): { count: number } } } | undefined;
      return mesh?.geometry.getAttribute('position').count ?? 0;
    };
    // A rounded corner replaces a 4-vertex quad with the fan's arc, so the vertex count moves —
    // the argument cannot be silently ignored.
    expect(built()).toBe(8);
    expect(built([trimOf(5, 5, ['fan', 'square', 'square', 'square'])])).toBeGreaterThan(8);
  });
});
