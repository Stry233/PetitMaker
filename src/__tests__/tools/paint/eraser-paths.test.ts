import { afterEach, describe, expect, it } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { TerrainType, type EditorEvents, type EraserShape } from '../../../core/model/types';
import { createDefaultRegistry } from '../../../rules';
import { roadLookup } from '../../../state/object-index';
import { EraserTool } from '../../../tools/paint/eraser';
import { DrawingTool } from '../../../tools/paint/drawing-tool';
import { __resetCurveSession, getCurveSession, moveCurveAnchor } from '../../../tools/paint/curve-session';
import { mapFingerprint } from '../../../tools/macros/scratch';
import { placeTileCell } from '../../../tools/paint/tile-coating';
import { makeState, setTerrain } from '../../rules/_helpers';
import { makeToolCtx } from '../_tool-ctx';

function world(shape: EraserShape, width = 1, elevation = 1) {
  const state = makeState(24, 24);
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) setTerrain(state, x, y, TerrainType.Mountain, elevation);
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  const ctx = makeToolCtx(state, executor, width, elevation, { eraserShape: shape });
  const tool = new EraserTool();
  const drag = (x1 = 4, y1 = 8, x2 = 16, y2 = 8) => {
    tool.onPointerDown({ x: x1, y: y1 }, { x: 0, y: 0 }, ctx);
    tool.onPointerMove({ x: x2, y: y2 }, { x: 0, y: 0 }, ctx);
    tool.onPointerUp({ x: x2, y: y2 }, { x: 0, y: 0 }, ctx);
    if (shape === 'curve') {
      const end = { x: x2, y: y2 };
      for (let i = 0; i < 2; i++) { tool.onPointerDown(end, end, ctx); tool.onPointerUp(end, end, ctx); }
    }
  };
  const height = (x: number, y: number) => state.cells[y]![x]!.terrain?.elevation ?? 0;
  return { state, executor, ctx, tool, drag, height };
}

afterEach(__resetCurveSession);

describe('eraser paths', () => {
  it('erases a line with the selected width in one undoable stroke', () => {
    const { state, executor, drag, height } = world('line', 3);
    const before = mapFingerprint(state);
    drag();
    expect(height(10, 7)).toBe(0);
    expect(height(10, 9)).toBe(0);
    expect(height(10, 6)).toBe(1);
    const after = mapFingerprint(state);
    expect(executor.getUndoStackSize()).toBe(1);
    executor.undo(); expect(mapFingerprint(state)).toBe(before);
    executor.redo(); expect(mapFingerprint(state)).toBe(after);
  });

  it('connects sparse freehand samples and lowers overlapping cells once', () => {
    const { tool, ctx, height } = world('dot', 1, 2);
    tool.onPointerDown({ x: 4, y: 8 }, { x: 0, y: 0 }, ctx);
    tool.onPointerMove({ x: 16, y: 8 }, { x: 0, y: 0 }, ctx);
    tool.onPointerUp({ x: 4, y: 8 }, { x: 0, y: 0 }, ctx);
    for (let x = 4; x <= 16; x++) expect(height(x, 8)).toBe(1);
  });

  it('rolls back an interrupted freehand gesture', () => {
    const { tool, ctx, state, executor } = world('dot');
    const before = mapFingerprint(state);
    tool.onPointerDown({ x: 4, y: 8 }, { x: 0, y: 0 }, ctx);
    tool.onPointerMove({ x: 16, y: 8 }, { x: 0, y: 0 }, ctx);
    tool.onPointerCancel(ctx);
    expect(mapFingerprint(state)).toBe(before);
    expect(executor.getUndoStackSize()).toBe(0);
  });

  it.each(['line', 'curve'] as const)('%s respects hidden layers and the selected surface', shape => {
    const { state, ctx, drag } = world(shape);
    const before = mapFingerprint(state);
    ctx.layerVisibility = { 1: false }; drag();
    expect(mapFingerprint(state)).toBe(before);
    if (shape === 'curve') expect(getCurveSession()?.footprint).toBe(true);
    __resetCurveSession();
    ctx.layerVisibility = {}; ctx.contentType = 'water'; drag();
    expect(mapFingerprint(state)).toBe(before);
    if (shape === 'curve') expect(getCurveSession()?.footprint).toBe(true);
  });
});

describe('curve eraser adjustment', () => {
  it('restores the old path and lowers the new path once, with undo and redo', () => {
    const { state, executor, drag, height } = world('curve', 1, 2);
    const baseline = mapFingerprint(state);
    drag();
    const first = mapFingerprint(state);
    expect(getCurveSession()?.anchors).toHaveLength(2);
    moveCurveAnchor(1, 16, 16, false);
    expect(mapFingerprint(state)).toBe(first);
    moveCurveAnchor(1, 16, 16, true);
    expect(height(16, 8)).toBe(2);
    expect(height(16, 16)).toBe(1);
    expect(height(4, 8)).toBe(1);
    const adjusted = mapFingerprint(state);
    executor.undo(); expect(mapFingerprint(state)).toBe(first);
    executor.undo(); expect(mapFingerprint(state)).toBe(baseline);
    executor.redo(); executor.redo(); expect(mapFingerprint(state)).toBe(adjusted);
  });

  it('closes the session when layer locks change', () => {
    const { state, executor, drag } = world('curve', 1, 2);
    drag();
    state.lockedLayers.add(2);
    const before = mapFingerprint(state), history = executor.getUndoStackSize();
    moveCurveAnchor(1, 16, 16, true);
    expect(mapFingerprint(state)).toBe(before);
    expect(executor.getUndoStackSize()).toBe(history);
    expect(getCurveSession()).toBeNull();
  });

  it('closes the session without restoring hidden terrain when visibility changes', () => {
    const { state, executor, ctx, drag } = world('curve');
    const visibility: Record<number, boolean> = {};
    ctx.layerVisibility = visibility;
    drag();
    const before = mapFingerprint(state), history = executor.getUndoStackSize();
    visibility[1] = false;
    moveCurveAnchor(1, 16, 16, true);
    expect(mapFingerprint(state)).toBe(before);
    expect(executor.getUndoStackSize()).toBe(history);
    expect(getCurveSession()).toBeNull();
  });

  it('restores erased paving with its original object identity', () => {
    const { state, ctx, drag } = world('curve');
    ctx.contentType = 'tile';
    placeTileCell({ x: 14, y: 8 }, ctx, new Set());
    const original = [...state.objects.values()].map(obj => structuredClone(obj));
    expect(original).toHaveLength(1);
    placeTileCell({ x: 16, y: 16 }, ctx, new Set());
    drag();
    expect(state.objects.has(original[0]!.id)).toBe(false);
    moveCurveAnchor(1, 16, 16, true);
    expect(state.objects.get(original[0]!.id)).toEqual(original[0]);
    expect(state.objects.size).toBe(1);
  });

  it('closes the session after an unrelated map change', () => {
    const { state, drag } = world('curve');
    drag();
    setTerrain(state, 22, 22, TerrainType.Water, 1);
    const before = mapFingerprint(state);
    moveCurveAnchor(1, 16, 16, true);
    expect(getCurveSession()).toBeNull();
    expect(mapFingerprint(state)).toBe(before);
  });

  it('keeps a dragged brush curve open for more points until double-clicking', () => {
    const state = makeState(24, 24);
    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const ctx = makeToolCtx(state, executor);
    const tool = new DrawingTool(); tool.mode = 'curve'; tool.contentType = 'mountain'; tool.onActivate(ctx);
    tool.onPointerDown({ x: 4, y: 8 }, { x: 0, y: 0 }, ctx);
    tool.onPointerMove({ x: 16, y: 8 }, { x: 0, y: 0 }, ctx);
    tool.onPointerUp({ x: 16, y: 8 }, { x: 0, y: 0 }, ctx);
    expect(getCurveSession()).toBeNull();
    expect(executor.getUndoStackSize()).toBe(0);
    const third = { x: 18, y: 16 };
    tool.onPointerDown(third, third, ctx); tool.onPointerUp(third, third, ctx);
    expect(executor.getUndoStackSize()).toBe(0);
    tool.onPointerDown(third, third, ctx); tool.onPointerUp(third, third, ctx);
    expect(getCurveSession()?.anchors).toMatchObject([{ x: 4, y: 8 }, { x: 16, y: 8 }, third]);
    expect(state.cells[8]![10]!.terrain?.type).toBe(TerrainType.Mountain);
    expect(executor.getUndoStackSize()).toBe(1);
  });
});
