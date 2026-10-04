import { describe, it, expect } from 'vitest';
import { CellZone, CommandType, TerrainType, type MacroCoord } from '../../../core/model/types';
import { isLowGround, planPaint } from '../../../tools/paint/paint-plan';
import { peelCommand } from '../../../tools/paint/terrain-peel';
import { DrawingTool, brushCells } from '../../../tools/paint/drawing-tool';
import { EraserTool } from '../../../tools/paint/eraser';
import { makeState, makeExecutor, setTerrain, setZone } from '../../rules/_helpers';
import { createPlanetRegistry } from '../../../rules/index';
import { makeToolCtx } from '../_tool-ctx';
import type { ToolContext } from '../../../tools/runtime/types';
import { PLANET_PROFILE, ELEVATION_MAX } from '../../../core/model/game-profile';
import { planetPlazaObject, refreshBoundary } from '../../../core/model/planet';

/** Runs `body` with the profile's ground ceiling at `layer`, as turning stacking back on would. */
function withMaxLayer(layer: number, body: () => void): void {
  const profile = PLANET_PROFILE as { maxLayer: number };
  const was = profile.maxLayer;
  profile.maxLayer = layer;
  try { body(); } finally { profile.maxLayer = was; }
}

function session(w = 12, h = 12) {
  const state = makeState(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setZone(state, x, y, CellZone.Void);
  const ex = makeExecutor(state, createPlanetRegistry());
  return { state, ex, ctx: makeToolCtx(state, ex, 1, 1, { groundEditable: true, planetMaterial: 'mountain' }) };
}

const m = (x: number, y: number): MacroCoord => ({ x, y });

/** Grass over the inclusive rectangle, with the shore rim derived around it. */
function land(state: ReturnType<typeof makeState>, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setZone(state, x, y, CellZone.Grass);
  refreshBoundary(state.cells, state.cells.flatMap((row, y) => row.map((_, x) => m(x, y))));
}

function waterBrush(): DrawingTool {
  const brush = new DrawingTool();
  brush.contentType = 'water';
  brush.mode = 'brush';
  return brush;
}

const waterCtx = (ctx: ToolContext): ToolContext => ({ ...ctx, contentType: 'water' });

/** `ctx` counting the commands the rules refuse, each of which the editor would report. */
function countingRefusals(ctx: ToolContext): { ctx: ToolContext; refusals: () => number } {
  let n = 0;
  return {
    ctx: { ...ctx, executeCommand: (cmd) => { const r = ctx.executeCommand(cmd); if (!r.success) n++; return r; } },
    refusals: () => n,
  };
}

function stroke(tool: DrawingTool | EraserTool, ctx: ToolContext, path: MacroCoord[]): void {
  tool.onPointerDown(path[0]!, path[0]!, ctx);
  for (const c of path.slice(1)) tool.onPointerMove(c, c, ctx);
  const last = path[path.length - 1]!;
  tool.onPointerUp(last, last, ctx);
}

describe('planet session plans', () => {
  it('mountain on sea lays ground first, then stacks one layer per stroke once the profile lets it', () => withMaxLayer(ELEVATION_MAX, () => {
    const { state, ctx } = session();
    const first = planPaint([{ x: 5, y: 5 }], ctx, 'mountain', new Set());
    expect(first.commands).toEqual([expect.objectContaining({ type: CommandType.PaintTerrain, elevation: 0, ground: CellZone.Grass })]);
    for (const c of first.commands) ctx.executeCommand(c);
    expect(state.cells[5]![5]!.zone).toBe(CellZone.Grass);
    const second = planPaint([{ x: 5, y: 5 }], ctx, 'mountain', new Set());
    expect(second.commands.map((c) => (c as { elevation: number }).elevation)).toEqual([1]);
  }));

  it('mountain on grass stays at layer 0 at the profile ceiling of 0', () => withMaxLayer(0, () => {
    const { state, ctx } = session(); setZone(state, 5, 5, CellZone.Grass);
    expect(planPaint([m(5, 5)], { ...ctx, elevation: 3 }, 'mountain', new Set()).commands).toEqual([]);
  }));

  it('never raises a layer the planet already holds above the ceiling', () => withMaxLayer(0, () => {
    const { state, ctx } = session(); setZone(state, 5, 5, CellZone.Grass); setTerrain(state, 5, 5, TerrainType.Mountain, 2);
    expect(planPaint([m(5, 5)], ctx, 'mountain', new Set()).commands).toEqual([]);
  }));

  it('the profile ceiling is the one switch: raising it restores stacking to that layer', () => {
    const { state, ctx } = session(); setZone(state, 5, 5, CellZone.Grass);
    expect(PLANET_PROFILE.maxLayer).toBe(0);
    expect(planPaint([m(5, 5)], ctx, 'mountain', new Set()).commands).toEqual([]);
    withMaxLayer(2, () => {
      const up = planPaint([m(5, 5)], ctx, 'mountain', new Set());
      expect(up.commands.map((c) => (c as { elevation: number }).elevation)).toEqual([1]);
      setTerrain(state, 5, 5, TerrainType.Mountain, 2);
      expect(planPaint([m(5, 5)], ctx, 'mountain', new Set()).commands).toEqual([]);
    });
  });

  it('a higher build floor still lays only the ground on sea', () => {
    const { ctx } = session();
    const plan = planPaint([{ x: 5, y: 5 }], { ...ctx, elevation: 3 }, 'mountain', new Set());
    expect(plan.commands).toEqual([expect.objectContaining({ elevation: 0, ground: CellZone.Grass })]);
  });

  it('mountain on sand turns it to grass first', () => {
    const { state, ctx } = session(); setZone(state, 4, 4, CellZone.Beach);
    expect(planPaint([{ x: 4, y: 4 }], ctx, 'mountain', new Set()).commands[0]).toMatchObject({ elevation: 0, ground: CellZone.Grass });
  });

  it('sand lays one flat layer on sea or grass and never stacks', () => {
    const { state, ctx } = session(); setZone(state, 3, 3, CellZone.Grass); setTerrain(state, 6, 6, TerrainType.Mountain, 2); setZone(state, 6, 6, CellZone.Grass);
    const sand = { ...ctx, planetMaterial: 'sand' as const };
    const plan = planPaint([{ x: 2, y: 2 }, { x: 3, y: 3 }, { x: 6, y: 6 }], sand, 'mountain', new Set());
    expect(plan.commands).toHaveLength(1);
    expect(plan.commands[0]).toMatchObject({ elevation: 0, ground: CellZone.Beach, cells: [{ x: 2, y: 2 }, { x: 3, y: 3 }] });
    for (const c of plan.commands) ctx.executeCommand(c);
    expect(planPaint([{ x: 2, y: 2 }], sand, 'mountain', new Set()).commands).toEqual([]);
  });

  it('the water brush lays a pond on grass at the ground layer without touching the zone', () => {
    const { state, ctx } = session(); land(state, 2, 2, 6, 6);
    const plan = planPaint([m(4, 4), m(5, 4)], ctx, 'water', new Set());
    expect(plan.commands).toEqual([{ type: CommandType.PaintTerrain, timestamp: expect.any(Number), cells: [m(4, 4), m(5, 4)], terrainType: TerrainType.Water, elevation: 0 }]);
    expect(plan.clipped).toBeFalsy();
  });

  it('a pinned layer never lifts a pond above the ground ceiling', () => {
    const { state, ctx } = session(); land(state, 2, 2, 6, 6);
    expect(planPaint([m(4, 4)], { ...ctx, layerPinned: true, elevation: 3 }, 'water', new Set()).commands).toEqual([expect.objectContaining({ elevation: 0 })]);
  });

  it('the eraser peels bare ground to sea, and the water eraser has nothing to take on bare ground or sea', () => {
    const { state } = session(); setZone(state, 1, 1, CellZone.Grass);
    expect(peelCommand(1, 1, state.cells[1]![1]!, false, true)).toMatchObject({ type: CommandType.EraseTerrain, ground: CellZone.Void });
    expect(peelCommand(1, 1, state.cells[1]![1]!, true, true)).toBeNull();
    expect(peelCommand(2, 2, state.cells[2]![2]!, true, true)).toBeNull();
  });

  it('a shore rim cell plans as the sea it stands on for every layer-0 tool', () => {
    const { state, ctx } = session(); setZone(state, 5, 5, CellZone.Boundary);
    expect(isLowGround(state.cells[5]![5]!, ctx)).toBe(true);
    expect(planPaint([m(5, 5)], ctx, 'mountain', new Set()).commands).toEqual([expect.objectContaining({ elevation: 0, ground: CellZone.Grass })]);
    expect(planPaint([m(5, 5)], { ...ctx, planetMaterial: 'sand' }, 'mountain', new Set()).commands).toEqual([expect.objectContaining({ ground: CellZone.Beach })]);
    expect(planPaint([m(5, 5)], ctx, 'water', new Set()).commands).toEqual([]);
    expect(peelCommand(5, 5, state.cells[5]![5]!, true, true)).toBeNull();
    expect(peelCommand(5, 5, state.cells[5]![5]!, false, true)).toBeNull();
  });

  it('a shore rim cell over sand plans as the sand under it for every layer-0 tool', () => {
    const { state, ctx } = session(); setZone(state, 5, 5, CellZone.Boundary);
    state.cells[5]![5]!.under = CellZone.Beach;
    const cell = state.cells[5]![5]!;
    expect(isLowGround(cell, ctx)).toBe(true);
    expect(planPaint([m(5, 5)], ctx, 'mountain', new Set()).commands).toEqual([expect.objectContaining({ elevation: 0, ground: CellZone.Grass })]);
    expect(planPaint([m(5, 5)], { ...ctx, planetMaterial: 'sand' }, 'mountain', new Set()).commands).toEqual([]);
    expect(planPaint([m(5, 5)], ctx, 'water', new Set()).commands).toEqual([]);
    expect(peelCommand(5, 5, cell, true, true)).toBeNull();
    expect(peelCommand(5, 5, cell, false, true)).toMatchObject({ type: CommandType.EraseTerrain, ground: CellZone.Void });
  });

  it('a ground command on a rim cell drops the sand the rim kept', () => {
    const { state, ctx } = session(); setZone(state, 5, 5, CellZone.Boundary);
    state.cells[5]![5]!.under = CellZone.Beach;
    const erase = peelCommand(5, 5, state.cells[5]![5]!, false, true)!;
    expect(ctx.executeCommand(erase).success).toBe(true);
    expect(state.cells[5]![5]).toEqual({ zone: CellZone.Void, terrain: null });
  });

  it('reports ground a stroke asked for beyond the canvas edge', () => {
    const { ctx } = session();
    expect(planPaint([m(11, 5), m(12, 5)], ctx, 'mountain', new Set()).clipped).toBe(true);
    expect(planPaint([m(-1, 5)], { ...ctx, planetMaterial: 'sand' }, 'mountain', new Set()).clipped).toBe(true);
    expect(planPaint([m(11, 5)], ctx, 'mountain', new Set()).clipped).toBeFalsy();
    expect(planPaint([m(12, 5)], ctx, 'water', new Set()).clipped).toBeFalsy();
  });

  it('with the lock on, the same inputs plan exactly as before', () => {
    const state = makeState(12, 12); const ex = makeExecutor(state);
    const ctx = makeToolCtx(state, ex);
    expect(planPaint([{ x: 5, y: 5 }], ctx, 'mountain', new Set()).commands.every((c) => !('ground' in c) || c.ground === undefined)).toBe(true);
    expect(planPaint([{ x: 5, y: 5 }], ctx, 'mountain', new Set()).commands).toEqual([expect.objectContaining({ elevation: 1 })]);
    expect(peelCommand(1, 1, state.cells[1]![1]!, false)).toBeNull();
    // The session material is ignored outside the session.
    const sandOff = { ...ctx, planetMaterial: 'sand' as const };
    expect(planPaint([{ x: 5, y: 5 }], sandOff, 'mountain', new Set()).commands).toEqual([expect.objectContaining({ elevation: 1 })]);
    expect(planPaint([{ x: 5, y: 5 }], ctx, 'water', new Set()).commands).toEqual([expect.objectContaining({ type: CommandType.PaintTerrain, terrainType: TerrainType.Water })]);
  });
});

describe('planet session tools', () => {
  it('one mountain stroke on sea yields ground only, and a second stroke stacks layer 1 once the profile lets it', () => withMaxLayer(ELEVATION_MAX, () => {
    const { state, ctx } = session();
    const tool = new DrawingTool();
    tool.contentType = 'mountain';
    tool.mode = 'brush';
    // A drag that crosses the same cell twice is still one layer. The block's half-tile bleed
    // needs ground up, left and up-left of it, so the stroke lays those too.
    stroke(tool, ctx, [m(5, 5), m(4, 5), m(4, 4), m(5, 4), m(5, 5)]);
    for (const [x, y] of [[4, 4], [5, 4], [4, 5], [5, 5]] as const) {
      expect(state.cells[y]![x]!.zone).toBe(CellZone.Grass);
      expect(state.cells[y]![x]!.terrain).toBeNull();
    }
    stroke(tool, ctx, [m(5, 5)]);
    expect(state.cells[5]![5]!.terrain).toMatchObject({ type: TerrainType.Mountain, elevation: 1 });
  }));

  it('a session stroke over grass stays at layer 0, and repeated strokes never stack', () => {
    const { state, ex, ctx } = session();
    const tool = new DrawingTool();
    tool.contentType = 'mountain';
    tool.mode = 'brush';
    const wide = { ...ctx, brushSize: 3 };
    stroke(tool, wide, [m(5, 5)]);
    const laid = ex.getUndoStackSize();
    for (let i = 0; i < 3; i++) stroke(tool, wide, [m(5, 5)]);
    for (const row of state.cells) for (const cell of row) expect(cell.terrain).toBeNull();
    expect(state.cells[5]![5]!.zone).toBe(CellZone.Grass);
    expect(ex.getUndoStackSize()).toBe(laid);
  });

  it('highlights layer 0 over grass while the ground stays flat', () => {
    const { state, ctx } = session(); setZone(state, 5, 5, CellZone.Grass);
    const layers: (number | null)[] = [];
    const watched = { ...ctx, elevation: 2, setDisplayLayer: (l: number | null) => { layers.push(l); } };
    const tool = new DrawingTool();
    tool.contentType = 'mountain';
    tool.mode = 'brush';
    tool.onPointerDown(m(5, 5), m(5, 5), watched);
    expect(layers[0]).toBe(0);
    tool.onPointerUp(m(5, 5), m(5, 5), watched);
  });

  it('a wide dab on open sea lays ground, then raises the interior and keeps the coast ground once the profile lets it', () => withMaxLayer(ELEVATION_MAX, () => {
    const { state, ex, ctx } = session();
    const wide = { ...ctx, brushSize: 3 };
    const tool = new DrawingTool();
    tool.contentType = 'mountain';
    tool.mode = 'brush';
    const dab = brushCells(5, 5, 3);
    expect(dab.length).toBeGreaterThan(4);
    const before = ex.getUndoStackSize();
    stroke(tool, wide, [m(5, 5)]);
    expect(ex.getUndoStackSize()).toBe(before + 1);
    for (const c of dab) {
      expect(state.cells[c.y]![c.x]!.zone).toBe(CellZone.Grass);
      expect(state.cells[c.y]![c.x]!.terrain).toBeNull();
    }
    stroke(tool, wide, [m(5, 5)]);
    expect(ex.getUndoStackSize()).toBe(before + 2);
    const grass = (x: number, y: number) => state.cells[y]?.[x]?.zone === CellZone.Grass;
    let raised = 0;
    for (const c of dab) {
      const interior = grass(c.x, c.y - 1) && grass(c.x - 1, c.y) && grass(c.x - 1, c.y - 1);
      const terrain = state.cells[c.y]![c.x]!.terrain;
      if (interior) { expect(terrain).toMatchObject({ type: TerrainType.Mountain, elevation: 1 }); raised++; }
      else expect(terrain).toBeNull();
    }
    expect(raised).toBeGreaterThan(0);
    expect(raised).toBeLessThan(dab.length);
  }));

  it('a stroke reaching past the canvas edge reports the clip, and one inside it does not', () => {
    const { ctx } = session();
    let clipped = 0;
    const watched = { ...ctx, reportGroundClipped: () => { clipped++; } };
    const tool = new DrawingTool();
    tool.contentType = 'mountain';
    tool.mode = 'brush';
    stroke(tool, watched, [m(5, 5)]);
    expect(clipped).toBe(0);
    stroke(tool, watched, [m(12, 5)]);
    expect(clipped).toBe(1);
  });

  it('outside the session a mountain dab stays atomic', () => {
    const state = makeState(12, 12);
    setZone(state, 4, 4, CellZone.Beach);
    const ctx = makeToolCtx(state, makeExecutor(state), 3, 1);
    const tool = new DrawingTool();
    tool.contentType = 'mountain';
    tool.mode = 'brush';
    stroke(tool, ctx, [m(5, 5)]);
    for (const c of brushCells(5, 5, 3)) expect(state.cells[c.y]![c.x]!.terrain).toBeNull();
  });

  it('highlights layer 0 while a session stroke lays ground on sea', () => {
    const { state, ctx } = session();
    const layers: (number | null)[] = [];
    const watched = { ...ctx, elevation: 2, setDisplayLayer: (l: number | null) => { layers.push(l); } };
    const tool = new DrawingTool();
    tool.contentType = 'mountain';
    tool.mode = 'brush';
    tool.onPointerDown(m(5, 5), m(5, 5), watched);
    expect(layers[0]).toBe(0);
    tool.onPointerUp(m(5, 5), m(5, 5), watched);
    expect(state.cells[5]![5]!.zone).toBe(CellZone.Grass);
  });

  it('the eraser peels layer 1 then bare ground to sea, one layer per stroke', () => {
    const { state, ctx } = session();
    for (const [x, y] of [[3, 3], [4, 3], [3, 4], [4, 4]] as const) setZone(state, x, y, CellZone.Grass);
    setTerrain(state, 4, 4, TerrainType.Mountain, 1);
    const eraser = new EraserTool();
    stroke(eraser, ctx, [m(4, 4)]);
    expect(state.cells[4]![4]!.terrain).toBeNull();
    expect(state.cells[4]![4]!.zone).toBe(CellZone.Grass);
    stroke(eraser, ctx, [m(4, 4)]);
    expect(state.cells[4]![4]!.zone).toBe(CellZone.Void);
  });

  it('one eraser dab peels a layer-1 block and clears the ground above and left of it', () => {
    const { state, ex, ctx } = session();
    for (let y = 2; y <= 6; y++) for (let x = 2; x <= 6; x++) setZone(state, x, y, CellZone.Grass);
    setTerrain(state, 4, 4, TerrainType.Mountain, 1);
    const before = ex.getUndoStackSize();
    stroke(new EraserTool(), { ...ctx, brushSize: 3 }, [m(4, 4)]);
    expect(ex.getUndoStackSize()).toBe(before + 1);
    expect(state.cells[4]![4]!.terrain).toBeNull();
    expect(state.cells[4]![4]!.zone).toBe(CellZone.Grass);
    for (const [x, y] of [[3, 3], [4, 3], [3, 4], [5, 5]] as const) expect(state.cells[y]![x]!.zone).toBe(CellZone.Void);
  });

  it('beside a layer-2 block the dab peels one layer and leaves the ground the block still bleeds onto', () => {
    const { state, ctx } = session();
    for (let y = 2; y <= 6; y++) for (let x = 2; x <= 6; x++) setZone(state, x, y, CellZone.Grass);
    setTerrain(state, 4, 4, TerrainType.Mountain, 2);
    stroke(new EraserTool(), { ...ctx, brushSize: 3 }, [m(4, 4)]);
    expect(state.cells[4]![4]!.terrain).toMatchObject({ type: TerrainType.Mountain, elevation: 1 });
    for (const [x, y] of [[3, 3], [4, 3], [3, 4]] as const) expect(state.cells[y]![x]!.zone).toBe(CellZone.Grass);
    expect(state.cells[5]![5]!.zone).toBe(CellZone.Void);
    expect(ctx.gridState.cells.flat().every((c) => !c.terrain || c.zone === CellZone.Grass)).toBe(true);
  });

  it('a water stroke over grass lays a pond, keeps the zone grass and adds no rim', () => {
    const { state, ctx } = session(); land(state, 2, 2, 8, 8);
    const zones = () => state.cells.map((row) => row.map((c) => c.zone));
    const before = zones();
    stroke(waterBrush(), waterCtx(ctx), [m(4, 4), m(5, 4), m(6, 4)]);
    for (const x of [4, 5, 6]) expect(state.cells[4]![x]!.terrain).toMatchObject({ type: TerrainType.Water, elevation: 0 });
    expect(refreshBoundary(state.cells, [m(5, 4)])).toEqual([]);
    expect(zones()).toEqual(before);
  });

  it('a water stroke leaves sand, the shore rim, sea, the landmark and grass that would bleed onto the coast untouched and paints the rest without a refusal', () => {
    const { state, ctx: base } = session(); land(state, 2, 2, 9, 9);
    for (let y = 2; y <= 9; y++) setZone(state, 6, y, CellZone.Beach);
    refreshBoundary(state.cells, state.cells.flatMap((row, y) => row.map((_, x) => m(x, y))));
    const plaza = planetPlazaObject(m(3, 7), 0);
    state.objects.set(plaza.id, { ...plaza, width: 1, height: 1 });
    const { ctx, refusals } = countingRefusals(base);
    const cells = [m(0, 4), m(1, 4), m(4, 4), m(5, 4), m(6, 4), m(7, 4), m(3, 7), m(11, 4)];
    const plan = planPaint(cells, waterCtx(ctx), 'water', new Set());
    expect(plan.commands.flatMap((c) => (c as { cells: MacroCoord[] }).cells)).toEqual([m(4, 4), m(5, 4)]);
    stroke(waterBrush(), waterCtx(ctx), cells);
    expect(refusals()).toBe(0);
    for (const [x, y] of [[4, 4], [5, 4]] as const) expect(state.cells[y]![x]!.terrain).toMatchObject({ type: TerrainType.Water });
    for (const [x, y] of [[0, 4], [1, 4], [6, 4], [7, 4], [3, 7], [11, 4]] as const) expect(state.cells[y]![x]!.terrain ?? null).toBeNull();
    expect(state.cells[4]![6]).toMatchObject({ zone: CellZone.Boundary, under: CellZone.Beach });
    expect(state.cells[4]![1]!.zone).toBe(CellZone.Boundary);
  });

  it('a water stroke leaves raised ground alone, as it does sand', () => {
    const { state, ctx } = session(); land(state, 2, 2, 9, 9);
    setTerrain(state, 6, 5, TerrainType.Mountain, 2);
    stroke(waterBrush(), waterCtx(ctx), [m(4, 5), m(5, 5), m(6, 5), m(7, 5)]);
    expect([4, 5, 6, 7].map((x) => state.cells[5]![x]!.terrain)).toEqual([
      { type: TerrainType.Water, elevation: 0 }, { type: TerrainType.Water, elevation: 0 },
      { type: TerrainType.Mountain, elevation: 2 }, { type: TerrainType.Water, elevation: 0 },
    ]);
  });

  it('Ground over a pond turns it back to grass, as the ordinary ladder converts water to the layer it paints', () => {
    const { state, ctx } = session(); land(state, 2, 2, 8, 8);
    stroke(waterBrush(), waterCtx(ctx), [m(5, 5)]);
    const plan = planPaint([m(5, 5)], ctx, 'mountain', new Set());
    expect(plan.commands).toEqual([expect.objectContaining({ terrainType: TerrainType.Mountain, elevation: 0, ground: CellZone.Grass })]);
    const brush = new DrawingTool();
    brush.contentType = 'mountain';
    brush.mode = 'brush';
    stroke(brush, ctx, [m(5, 5)]);
    expect(state.cells[5]![5]).toMatchObject({ zone: CellZone.Grass, terrain: null });
  });

  it('a stroke spanning grass and sand paints only the grass', () => {
    const { state, ctx } = session(); land(state, 2, 2, 9, 9);
    for (let y = 2; y <= 9; y++) for (let x = 6; x <= 9; x++) setZone(state, x, y, CellZone.Beach);
    stroke(waterBrush(), waterCtx(ctx), [m(3, 5), m(4, 5), m(5, 5), m(6, 5), m(7, 5), m(8, 5)]);
    expect([3, 4, 5, 6, 7, 8].map((x) => state.cells[5]![x]!.terrain?.type ?? null))
      .toEqual([TerrainType.Water, TerrainType.Water, TerrainType.Water, null, null, null]);
  });

  it('the eraser takes a pond back to grass, then the ground to sea', () => {
    const { state, ctx } = session(); land(state, 2, 2, 8, 8);
    stroke(waterBrush(), waterCtx(ctx), [m(5, 5)]);
    const eraser = new EraserTool();
    stroke(eraser, ctx, [m(5, 5)]);
    expect(state.cells[5]![5]).toMatchObject({ zone: CellZone.Grass, terrain: null });
    stroke(eraser, ctx, [m(5, 5)]);
    expect(state.cells[5]![5]!.zone).toBe(CellZone.Void);
  });

  it('the water eraser takes a pond back to grass and leaves ground and sea alone', () => {
    const { state, ex, ctx } = session(); land(state, 2, 2, 8, 8);
    stroke(waterBrush(), waterCtx(ctx), [m(5, 5)]);
    stroke(new EraserTool(), waterCtx(ctx), [m(5, 5)]);
    expect(state.cells[5]![5]).toMatchObject({ zone: CellZone.Grass, terrain: null });
    const settled = ex.getUndoStackSize();
    stroke(new EraserTool(), waterCtx(ctx), [m(5, 5)]);
    stroke(new EraserTool(), waterCtx(ctx), [m(0, 0)]);
    expect(ex.getUndoStackSize()).toBe(settled);
    expect([state.cells[5]![5]!.zone, state.cells[0]![0]!.zone]).toEqual([CellZone.Grass, CellZone.Void]);
  });

  it('outside the session the eraser leaves bare ground alone', () => {
    const state = makeState(12, 12); const ex = makeExecutor(state);
    const ctx = makeToolCtx(state, ex);
    stroke(new EraserTool(), ctx, [m(4, 4)]);
    expect(state.cells[4]![4]!.zone).toBe(CellZone.Grass);
    expect(ex.getUndoStackSize()).toBe(0);
  });
});
