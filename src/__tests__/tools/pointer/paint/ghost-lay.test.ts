/**
 * The build brush's ghost carries what its click lays: each block at the layer and with the cuts the
 * commit leaves, and each road tile of the armed material.
 */
import { describe, expect, afterEach } from 'vitest';
import { spec } from '../../../_support/spec';
import { DrawingTool } from '../../../../tools/pointer/paint/drawing-tool';
import { __resetCurveSession } from '../../../_support/curve-session';
import { applyAutoEdgeCut } from '../../../../tools/trim/auto-edge-cut';
import { CommandType, TerrainType, type MacroCoord, type TerrainCell } from '../../../../core/model/types';
import type { PlacementPaint } from '../../../../tools/pointer/runtime';
import { makeState, makeExecutor } from '../../../_support/map-state';
import { makeToolCtx, arm } from '../../../_support/tool-ctx';
import { getCell } from '../../../../core/model/grid-model';
import { cell, point } from '../../../_support/grid';
import { HEADLESS_OVERLAY } from '../../../../tools/pointer/runtime/host';
import { setZone } from '../../../_support/map-state';
import { CellZone, SAND_ZONE } from '../../../../core/game/zones';
import { createPlanetRegistry } from '../../../../rules/index';
import type { MixedCellSet } from '../../../../core/grid/grids';
import { PLACEMENT_GRID } from '../../../../core/game/profile';

const MICRO = { x: 0, y: 0 };

/** A map holding a trimmed layer-1 plain, and a build brush whose ghosts are recorded. */
function world() {
  const state = makeState(50, 50);
  const executor = makeExecutor(state);
  const paints: PlacementPaint[] = [];
  const ctx = makeToolCtx(state, executor, 3, { autoEdgeCut: 'round' });
  ctx.overlay = { ...HEADLESS_OVERLAY, showGhost: (_c: unknown, paint: PlacementPaint) => { paints.push(paint); } } as never;
  const plain: MacroCoord[] = [];
  for (let y = 8; y <= 30; y++) for (let x = 8; x <= 30; x++) plain.push({ x, y });
  const start = executor.beginStroke();
  executor.execute({ type: CommandType.PaintTerrain, cells: plain, terrainType: TerrainType.Mountain, elevation: 1 });
  applyAutoEdgeCut({ state, execute: (c) => executor.execute(c) }, 'round', plain, []);
  start.commit();
  const tool = new DrawingTool();
  return { state, ctx, tool, paints };
}

const shape = (t: TerrainCell | null | undefined) =>
  t ? { type: t.type, elevation: t.elevation, corners: (t.corners ?? ['square', 'square', 'square', 'square']).join('|'), patch: !!t.patchOnly } : null;

afterEach(() => { __resetCurveSession(); });

describe('the build brush ghost', () => {
  spec('UI-69', 'a mountain curve promises every block at the layer and with the cuts the click leaves', () => {
    const w = world();
    arm(w.ctx, { shape: 'curve', contentType: 'mountain' });
    w.tool.onActivate(w.ctx);
    const click = (c: MacroCoord) => { w.tool.onPointerDown(cell(c), point(MICRO), w.ctx); w.tool.onPointerUp(cell(c), point(MICRO), w.ctx); };
    const anchors = [{ x: 12, y: 14 }, { x: 19, y: 22 }, { x: 26, y: 14 }];
    click(anchors[0]!); click(anchors[1]!);
    w.paints.length = 0;
    w.tool.onPointerMove(cell(anchors[2]!), point(MICRO), w.ctx);
    const promised = w.paints.at(-1)!;
    click(anchors[2]!); click(anchors[2]!);

    expect(promised.placement).toBe(true);
    expect(promised.blocks!.length).toBeGreaterThan(10);
    // Stacked on the layer-1 plain, the curve rises to layer 2, and the trim rounds some of it.
    expect(promised.blocks!.every((b) => b.terrain.elevation === 2)).toBe(true);
    expect(promised.blocks!.some((b) => b.terrain.corners?.some((c) => c !== 'square'))).toBe(true);
    for (const b of promised.blocks!) {
      expect(shape(b.terrain), `${b.x},${b.y}`).toEqual(shape(getCell(w.state.cells, b.x, b.y)?.terrain));
    }
  });

  spec('UI-69', 'a road stroke promises a tile of the armed material on each cell it paves', () => {
    const w = world();
    arm(w.ctx, { shape: 'free', contentType: 'road', brushSize: 1 });
    w.tool.onActivate(w.ctx);
    w.tool.onPointerMove(cell({ x: 40, y: 40 }), point(MICRO), w.ctx);
    const promised = w.paints.at(-1)!;
    expect(promised.tiles).toHaveLength(1);
    expect(promised.tiles![0]).toMatchObject({ catalogId: w.ctx.arming.tileMaterial, position: { x: 40, y: 40 } });
  });

  spec('UI-69', 'a planet session ground stroke promises its cells turned to the ground it lays', () => {
    const state = makeState(12, 12);
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) setZone(state, x, y, CellZone.Void);
    const executor = makeExecutor(state, createPlanetRegistry());
    const paints: PlacementPaint[] = [];
    const outlines: MixedCellSet[] = [];
    const ctx = makeToolCtx(state, executor, 3, { groundEditable: true, planetMaterial: 'sand' });
    ctx.overlay = {
      ...HEADLESS_OVERLAY, showGhost: (set: MixedCellSet, paint: PlacementPaint) => { outlines.push(set); paints.push(paint); },
    } as never;
    arm(ctx, { shape: 'free', contentType: 'mountain' });
    const tool = new DrawingTool();
    tool.onActivate(ctx);
    tool.onPointerMove(cell({ x: 5, y: 5 }), point(MICRO), ctx);
    const promised = paints.at(-1)!;
    expect(promised.blocks ?? []).toEqual([]);
    expect(promised.ground!.length).toBe(9);
    expect(promised.ground!.every((g) => g.zone === SAND_ZONE)).toBe(true);
    // The outline is drawn round the very cells the ground fills, on the grid ground lies on.
    const outline = outlines.at(-1)!;
    expect(outline.grid).toBe(PLACEMENT_GRID);
    expect(outline.cells.map(({ x, y }) => `${x},${y}`).sort()).toEqual(promised.ground!.map(({ x, y }) => `${x},${y}`).sort());
  });
});
