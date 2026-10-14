import { afterEach, describe, expect, it } from 'vitest';
import { cloneGridState } from '../../../../core/model/grid-model';
import { surfaceElevation } from '../../../../core/domain/terrain/terrain-surface';
import { classifyRoadKind } from '../../../../core/domain/edge-cut/road-cut-states';
import { TerrainType, type GridState } from '../../../../core/model/types';
import { type AutoEdgeCut, type EraserShape } from '../../../../state/editing/vocabulary';
import { createDefaultRegistry } from '../../../../rules';
import { roadLookup } from '../../../../state/object-index';
import { EraserTool } from '../../../../tools/pointer/paint/eraser';
import { placeTileCell } from '../../../../tools/pointer/paint/tile-coating';
import { __resetCurveSession, getCurveSession } from '../../../_support/curve-session';
import { makeState, setTerrain, makeExecutor } from '../../../_support/map-state';
import { makeToolCtx, arm } from '../../../_support/tool-ctx';
import { cell, point } from '../../../_support/grid';

function setup(state: GridState, eraserShape: EraserShape, autoEdgeCut: AutoEdgeCut) {
  const registry = createDefaultRegistry();
  const executor = makeExecutor(state, registry);
  const whole = executor.beginStroke();
  const ctx = makeToolCtx(state, executor, 1, 1, { eraserShape, autoEdgeCut });
  const tool = new EraserTool();
  const drag = (x1 = eraserShape === 'circle' ? 6 : 5, y1 = 4, x2 = eraserShape === 'circle' ? 6 : 5, y2 = 5) => {
    const from = { x: x1, y: y1 }, to = { x: x2, y: y2 };
    tool.onPointerDown(cell(from), point(from), ctx);
    tool.onPointerMove(cell(to), point(to), ctx);
    tool.onPointerUp(cell(to), point(to), ctx);
    if (eraserShape === 'curve') {
      for (let i = 0; i < 2; i++) { tool.onPointerDown(cell(to), point(to), ctx); tool.onPointerUp(cell(to), point(to), ctx); }
    }
  };
  return { registry, executor, ctx, tool, drag, whole };
}

afterEach(__resetCurveSession);

const shapes: EraserShape[] = ['free', 'line', 'curve', 'rect', 'circle'];
const modes: AutoEdgeCut[] = ['off', 'round', 'rect'];

describe.each(shapes)('%s eraser auto trim', shape => {
  it.each(modes)('exposes and trims a mountain edge with %s in one undo step', mode => {
    const state = makeState(12, 12);
    for (let y = 4; y <= 5; y++) for (let x = 4; x <= 5; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
    const baseline = cloneGridState(state);
    const { drag, executor, registry } = setup(state, shape, mode);
    drag();
    expect(surfaceElevation(state.cells[4]![5]!.terrain)).toBe(0);
    const corner = state.cells[4]![4]!.terrain?.corners?.[1] ?? 'square';
    expect(corner).toBe(mode === 'off' ? 'square' : mode === 'round' ? 'fan' : 'tri-SW');
    expect(registry.validatePostStroke(state)).toEqual([]);
    const result = cloneGridState(state);
    expect(executor.historyDepth()).toBe(1);
    executor.undo(); expect(state.cells).toEqual(baseline.cells);
    executor.redo(); expect(state.cells).toEqual(result.cells);
    expect(registry.validatePostStroke(state)).toEqual([]);
  });

  it.each(modes)('trims the remaining water shore with %s', mode => {
    const state = makeState(12, 12);
    for (let y = 4; y <= 5; y++) for (let x = 4; x <= 5; x++) setTerrain(state, x, y, TerrainType.Water, 0);
    const baseline = cloneGridState(state);
    const { ctx, drag, executor, registry } = setup(state, shape, mode);
    arm(ctx, { contentType: 'water' });
    drag();
    expect(state.cells[4]![5]!.terrain).toBeNull();
    const corner = state.cells[4]![4]!.terrain?.corners?.[1] ?? 'square';
    expect(corner).toBe(mode === 'off' ? 'square' : mode === 'round' ? 'fan' : 'tri-SW');
    expect(registry.validatePostStroke(state)).toEqual([]);
    executor.undo(); expect(state.cells).toEqual(baseline.cells);
  });

  it.each(modes)('trims a remaining road endpoint with %s and preserves road identities on undo', mode => {
    const state = makeState(12, 12);
    const { ctx, drag, executor, registry, whole } = setup(state, shape, mode);
    arm(ctx, { contentType: 'road' });
    for (let x = 3; x <= 6; x++) expect(placeTileCell({ x, y: 4 }, ctx, new Set())).toBe(true);
    whole.commit();
    const baseline = cloneGridState(state);
    if (shape === 'circle') drag(6, 4, 6, 5); else drag(5, 4, 6, 4);
    const road = roadLookup(state)(4, 4)!;
    expect(road).toBeTruthy();
    expect(classifyRoadKind(road.corners)).toBe(mode === 'off' ? null : mode === 'round' ? 'round' : 'direct');
    expect(registry.validatePostStroke(state)).toEqual([]);
    const result = cloneGridState(state);
    expect(executor.historyDepth()).toBe(2);
    executor.undo(); expect(state.objects).toEqual(baseline.objects);
    executor.redo(); expect(state.objects).toEqual(result.objects);
  });
});

describe('eraser trim boundaries', () => {
  it.each(['round', 'rect'] as const)('keeps unrelated and manual cuts with %s', mode => {
    const state = makeState(12, 12);
    setTerrain(state, 4, 4, TerrainType.Mountain, 1);
    setTerrain(state, 5, 4, TerrainType.Mountain, 1);
    setTerrain(state, 9, 9, TerrainType.Mountain, 1);
    state.cells[4]![4]!.terrain!.corners = ['tri-SE', 'square', 'square', 'square'];
    const { drag } = setup(state, 'free', mode);
    drag(5, 4, 5, 4);
    expect(state.cells[4]![4]!.terrain!.corners![0]).toBe('tri-SE');
    expect(state.cells[9]![9]!.terrain!.corners).toBeUndefined();
  });

  it.each(['hidden', 'locked', 'empty'] as const)('does not trim or add undo history for a %s erasure', kind => {
    const state = makeState(12, 12);
    setTerrain(state, 4, 4, TerrainType.Mountain, 1);
    if (kind !== 'empty') setTerrain(state, 5, 4, TerrainType.Mountain, 1);
    const { ctx, drag, executor } = setup(state, 'free', 'round');
    if (kind === 'hidden') arm(ctx, { layerVisibility: { 1: false } });
    if (kind === 'locked') state.lockedLayers.add(1);
    const baseline = cloneGridState(state);
    drag(5, 4, 5, 4);
    expect(state.cells).toEqual(baseline.cells);
    expect(executor.historyDepth()).toBe(0);
  });

  it.each(['hidden', 'locked'] as const)('leaves a %s neighbouring tier untrimmed', kind => {
    const state = makeState(12, 12);
    setTerrain(state, 4, 4, TerrainType.Mountain, 2);
    setTerrain(state, 5, 4, TerrainType.Mountain, 1);
    const { ctx, drag } = setup(state, 'free', 'round');
    if (kind === 'hidden') arm(ctx, { layerVisibility: { 2: false } });
    else state.lockedLayers.add(2);
    const neighbour = structuredClone(state.cells[4]![4]!.terrain);
    drag(5, 4, 5, 4);
    expect(state.cells[4]![5]!.terrain).toBeNull();
    expect(state.cells[4]![4]!.terrain).toEqual(neighbour);
  });

  it.each(modes)('rejects an unsupported curve atomically with %s and leaves nothing to redo', mode => {
    const state = makeState(12, 12);
    for (let y = 3; y <= 7; y++) for (let x = 3; x <= 7; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
    setTerrain(state, 5, 5, TerrainType.Mountain, 4);
    const baseline = cloneGridState(state);
    const { drag, executor, registry } = setup(state, 'curve', mode);
    expect(registry.validatePostStroke(state)).toEqual([]);
    drag(3, 4, 7, 4);
    expect(state.cells).toEqual(baseline.cells);
    expect(executor.historyDepth()).toBe(0);
    expect(executor.canRedo()).toBe(false);
    expect(getCurveSession()).toBeNull();
    expect(registry.validatePostStroke(state)).toEqual([]);
  });

  it.each(modes)('preserves waterfall containment and its receiving row with %s', mode => {
    const state = makeState(12, 12);
    for (let x = 4; x <= 6; x++) {
      setTerrain(state, x, 2, TerrainType.Mountain, 2);
      setTerrain(state, x, 3, x === 5 ? TerrainType.Water : TerrainType.Mountain, 2);
      setTerrain(state, x, 4, TerrainType.Mountain, 1);
    }
    const { ctx, drag, executor, registry } = setup(state, 'line', mode);
    expect(registry.validatePostStroke(state)).toEqual([]);
    const baseline = cloneGridState(state);
    drag(4, 4, 5, 4);
    expect(state.cells).toEqual(baseline.cells);
    expect(executor.canRedo()).toBe(false);
    arm(ctx, { contentType: 'water' });
    drag(5, 3, 5, 3);
    expect(state.cells[3]![5]!.terrain).toMatchObject({ type: TerrainType.Mountain, elevation: 2 });
    expect(registry.validatePostStroke(state)).toEqual([]);
    executor.undo(); expect(state.cells).toEqual(baseline.cells);
  });

  it('rolls back rejected trim commands while retaining a legal freehand erasure', () => {
    const state = makeState(12, 12);
    setTerrain(state, 4, 4, TerrainType.Mountain, 1);
    setTerrain(state, 5, 4, TerrainType.Mountain, 1);
    const { drag, executor, registry } = setup(state, 'free', 'round');
    registry.register({
      id: 'TEST-TRIM', phase: 'post-stroke',
      validate: grid => grid.cells.some(row => row.some(cell => cell.terrain?.corners))
        ? [{ ruleId: 'TEST-TRIM', message: 'trim refused', grid: 'object', cells: [] }] : [],
    });
    const baseline = cloneGridState(state);
    drag(5, 4, 5, 4);
    expect(state.cells[4]![5]!.terrain).toBeNull();
    expect(state.cells[4]![4]!.terrain?.corners).toBeUndefined();
    expect(registry.validatePostStroke(state)).toEqual([]);
    const result = cloneGridState(state);
    expect(executor.historyDepth()).toBe(1);
    executor.undo(); expect(state.cells).toEqual(baseline.cells);
    executor.redo(); expect(state.cells).toEqual(result.cells);
  });

  it('erases a cosmetic mountain fillet back to its actual base', () => {
    const state = makeState(12, 12);
    for (const [x, y] of [[3, 3], [4, 3], [3, 4]]) setTerrain(state, x!, y!, TerrainType.Mountain, 3);
    state.cells[4]![4]!.terrain = { type: TerrainType.Mountain, elevation: 3, patchOnly: true, patchBase: 1, corners: ['fan', 'square', 'square', 'square'] };
    const { drag, executor } = setup(state, 'free', 'off');
    const baseline = cloneGridState(state);
    drag(4, 4, 4, 4);
    expect(surfaceElevation(state.cells[4]![4]!.terrain)).toBe(1);
    executor.undo(); expect(state.cells).toEqual(baseline.cells);
  });
});
