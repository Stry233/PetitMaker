/*
 * core-commands.perf.test.ts — the command executor's per-operation costs.
 *
 * Covers the paths a brush stroke and its history actually pay for: a plain paint stroke laid one
 * command per cell (what a drag issues), the auto-stack ladder a mountain climb takes one rung at a
 * time, undo and redo of an already-committed stroke, a stroke landing on the dense generated map
 * (object-blocked cells and the mid-stroke road/edge-cut reconcile in the mix), collapseHistory
 * folding many undo entries into one, and the placement probe a ghost or the agent runs before every
 * candidate cell. See `_harness.ts` for the gate and methodology.
 */
import { describe, it } from 'vitest';
import { PERF, perfSuite } from './_harness';
import { cloneWorld, denseIsland, templateWorld } from './_fixtures';
import type { World } from './_fixtures';
import { getCell } from '../../core/model/grid-model';
import { surfaceElevationAt } from '../../state/object-geometry';
import { objectPlacementCommand } from '../../tools/objects/object-placer';
import { getPlaceableByCategory } from '../../state/catalog';
import {
  CellZone,
  CommandType,
  ItemCategory,
  TerrainType,
  type MacroCoord,
  type PaintTerrainCommand,
  type PlacedObject,
} from '../../core/model/types';

const s = perfSuite('core-commands');

function paintCell(world: World, coord: MacroCoord, elevation: number): boolean {
  const cmd: PaintTerrainCommand = {
    type: CommandType.PaintTerrain, timestamp: 0,
    cells: [coord], terrainType: TerrainType.Mountain, elevation,
  };
  return world.executor.execute(cmd).success;
}

// A 20x10 block of plain grass on the hexia template, clear of the plaza (76.5,58.5, 20x27) — a
// real drag's worth of cells for the stroke benches below.
const BLOCK_ORIGIN = { x: 19, y: 7 };
const BLOCK_W = 20, BLOCK_H = 10;

function block(w: number, h: number, ox = BLOCK_ORIGIN.x, oy = BLOCK_ORIGIN.y): MacroCoord[] {
  const cells: MacroCoord[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells.push({ x: ox + x, y: oy + y });
  return cells;
}

const STROKE_200 = block(BLOCK_W, BLOCK_H); // 200 cells
const LADDER_50 = block(10, 5); // 50 cells, same corner

describe.runIf(PERF)('perf: core commands', () => {
  it('paint stroke: 200 cells, one command per cell', async () => {
    let world = templateWorld();
    await s.bench('stroke/paint-200-cells', () => {
      const start = world.executor.getUndoStackSize();
      for (const c of STROKE_200) paintCell(world, c, 1);
      world.executor.commitStroke(start);
    }, {
      setup: () => { world = templateWorld(); },
      meta: { cells: STROKE_200.length },
    });
  });

  it('auto-stack ladder: climb 50 cells from elevation 1 to 3', async () => {
    let world = templateWorld();
    await s.bench('stroke/auto-stack-ladder', () => {
      const start = world.executor.getUndoStackSize();
      for (let e = 1; e <= 3; e++) for (const c of LADDER_50) paintCell(world, c, e);
      world.executor.commitStroke(start);
    }, {
      setup: () => { world = templateWorld(); },
      meta: { cells: LADDER_50.length, rungs: 3 },
    });
  });

  it('undo + redo of a committed 200-cell stroke', async () => {
    let world = templateWorld();
    function buildStroke(): void {
      const start = world.executor.getUndoStackSize();
      for (const c of STROKE_200) paintCell(world, c, 1);
      world.executor.commitStroke(start);
    }
    await s.bench('stroke/undo-redo', () => {
      world.executor.undo();
      world.executor.redo();
    }, {
      setup: () => { world = templateWorld(); buildStroke(); },
      meta: { cells: STROKE_200.length },
    });
  });

  it('stroke landing on the dense generated map', async () => {
    const island = denseIsland();
    // Eligible cells (plain grass, no object, no locked layer over it) are a structural fact of the
    // fixture itself — probed once against a scratch clone via validatePre (non-mutating), then
    // reused as a fixed set every sample paints against its own fresh clone.
    const probe = cloneWorld(island);
    const cells: MacroCoord[] = [];
    const { width, height } = probe.state.template;
    for (let y = 0; y < height && cells.length < 100; y++) {
      for (let x = 0; x < width && cells.length < 100; x++) {
        const cell = getCell(probe.state.cells, x, y);
        if (!cell || cell.terrain !== null || cell.zone !== CellZone.Grass) continue;
        const cmd: PaintTerrainCommand = {
          type: CommandType.PaintTerrain, timestamp: 0,
          cells: [{ x, y }], terrainType: TerrainType.Mountain, elevation: 1,
        };
        if (probe.executor.validatePre(cmd).length === 0) cells.push({ x, y });
      }
    }
    let world = cloneWorld(island);
    await s.bench('stroke/commit-on-dense', () => {
      const start = world.executor.getUndoStackSize();
      for (const c of cells) paintCell(world, c, 1);
      world.executor.commitStroke(start);
    }, {
      setup: () => { world = cloneWorld(island); },
      meta: { cells: cells.length },
    });
  });

  it('collapseHistory: fold 100 undo entries into one', async () => {
    let world = templateWorld();
    const cells = STROKE_200.slice(0, 100);
    function buildEntries(): void {
      for (const c of cells) paintCell(world, c, 1);
    }
    await s.bench('history/collapse', () => {
      world.executor.collapseHistory(0);
    }, {
      setup: () => { world = templateWorld(); buildEntries(); },
      meta: { entries: cells.length },
    });
  });

  it('validate: 100 placement probes over the dense map', async () => {
    const { state, executor } = denseIsland();
    const item = getPlaceableByCategory(ItemCategory.Flora)[0]!;
    const positions: MacroCoord[] = [];
    for (let y = 40; y < 50; y++) for (let x = 40; x < 50; x++) positions.push({ x, y });
    const commands = positions.map((p) => {
      const candidate: PlacedObject = {
        id: '__perf-probe__', catalogId: item.id, position: p,
        rotation: 0, elevation: surfaceElevationAt(state, p.x, p.y),
      };
      return objectPlacementCommand(candidate);
    });
    await s.bench('validate/place-probe-100', () => {
      for (const cmd of commands) executor.validatePre(cmd);
    }, {
      meta: { probes: commands.length, catalogId: item.id },
    });
  });
});
