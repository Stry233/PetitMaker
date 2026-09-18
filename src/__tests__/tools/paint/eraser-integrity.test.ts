import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { cloneGridState } from '../../../core/model/grid-model';
import { TerrainType, type EditorEvents, type GridState, type Command } from '../../../core/model/types';
import { createDefaultRegistry } from '../../../rules';
import { roadLookup } from '../../../state/object-index';
import { EraserTool } from '../../../tools/paint/eraser';
import { applyAutoEdgeCut } from '../../../tools/edge-cut/auto-edge-cut';
import { __resetCurveSession, getCurveSession, moveCurveAnchor, setCurveHandle } from '../../../tools/paint/curve-session';
import { mapFingerprint } from '../../../tools/macros/scratch';
import { makeState, setTerrain } from '../../rules/_helpers';
import { makeToolCtx } from '../_tool-ctx';

function setup(state: GridState) {
  const registry = createDefaultRegistry();
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), registry, roadLookup(state));
  const ctx = makeToolCtx(state, executor, 1, 1, { eraserShape: 'curve' });
  const tool = new EraserTool();
  const click = (x: number, y: number) => {
    const p = { x, y };
    tool.onPointerDown(p, p, ctx); tool.onPointerUp(p, p, ctx);
  };
  const drag = (a: [number, number], b: [number, number], finish = true) => {
    const from = { x: a[0], y: a[1] }, to = { x: b[0], y: b[1] };
    tool.onPointerDown(from, from, ctx); tool.onPointerMove(to, to, ctx); tool.onPointerUp(to, to, ctx);
    if (finish) { click(to.x, to.y); click(to.x, to.y); }
  };
  return { ctx, tool, executor, registry, click, drag };
}
afterEach(__resetCurveSession);

describe('eraser curve integrity', () => {
  it('collects multiple anchors without erasing until the finishing double click', () => {
    const { state, click, executor } = flatWorld();
    const baseline = mapFingerprint(state);
    click(3, 3); click(8, 10); click(15, 5);
    expect(mapFingerprint(state)).toBe(baseline);
    expect(executor.getUndoStackSize()).toBe(0);
    click(15, 5);
    expect(getCurveSession()?.anchors).toHaveLength(3);
    expect(state.cells[10]![8]!.terrain?.elevation).toBe(1);
    expect(executor.getUndoStackSize()).toBe(1);
  });

  it.each(['round', 'rect'] as const)('restores cut terrain through repeated %s curve adjustments', mode => {
    const state = makeState(24, 24), cells = [];
    for (let y = 3; y < 20; y++) for (let x = 3; x < 20; x++) {
      if (x > 12 && y < 9) continue;
      setTerrain(state, x, y, TerrainType.Mountain, x < 8 ? 2 : 1); cells.push({ x, y });
    }
    const { ctx, executor, registry, drag } = setup(state);
    applyAutoEdgeCut(ctx, mode, cells, []);
    executor.commitStroke(0);
    expect(registry.validatePostStroke(state)).toEqual([]);
    const baseline = cloneGridState(state);
    drag([4, 6], [17, 16]);
    const original = mapFingerprint(state);
    for (const [x, y] of [[16, 12], [6, 18], [17, 16]] as const) {
      moveCurveAnchor(1, x, y, true);
      expect(getCurveSession()?.anchors[1]).toMatchObject({ x, y });
      expect(registry.validatePostStroke(state)).toEqual([]);
    }
    expect(mapFingerprint(state)).toBe(original);
    for (let i = 0; i < 4; i++) executor.undo();
    expect(state.cells).toEqual(baseline.cells);
  });
});

describe.each([1, 3, 5])('width %i curve restoration', width => {
  it.each(['off', 'round', 'rect'] as const)('matches a fresh erase on 24 varied maps with %s auto trim', autoEdgeCut => {
    for (let seed = 1; seed <= 24; seed++) {
      __resetCurveSession();
      let random = seed;
      const next = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random; };
      const baseline = makeState(16, 16), cells = [];
      for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) {
        const n = next() % 5;
        if (n) { setTerrain(baseline, x, y, TerrainType.Mountain, n % 3 + 1); cells.push({ x, y }); }
      }
      const source = setup(baseline);
      applyAutoEdgeCut(source.ctx, seed % 2 ? 'round' : 'rect', cells, []);
      source.executor.commitStroke(0);
      expect(source.registry.validatePostStroke(baseline)).toEqual([]);
      const fresh = cloneGridState(baseline), expected = setup(fresh);
      Object.assign(expected.ctx, { brushSize: width, autoEdgeCut });
      expected.drag([3, 3], [12, 6]);
      __resetCurveSession();
      const original = cloneGridState(baseline), actual = setup(original);
      Object.assign(actual.ctx, { brushSize: width, autoEdgeCut });
      actual.drag([3, 3], [12, 10]);
      expect(getCurveSession()).not.toBeNull();
      const first = cloneGridState(original);
      moveCurveAnchor(1, 12, 6, true);
      expect(getCurveSession()?.anchors[1]).toMatchObject({ x: 12, y: 6 });
      expect(mapFingerprint(original), `seed ${seed}`).toBe(mapFingerprint(fresh));
      expect(actual.registry.validatePostStroke(original)).toEqual([]);
      actual.executor.undo(); expect(original.cells).toEqual(first.cells);
      actual.executor.undo(); expect(original.cells).toEqual(baseline.cells);
      actual.executor.redo(); actual.executor.redo();
      expect(original.cells).toEqual(fresh.cells);
      expect(actual.registry.validatePostStroke(original)).toEqual([]);
    }
  });
});

function flatWorld() {
  const state = makeState(20, 20);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) setTerrain(state, x, y, TerrainType.Mountain, 2);
  return { state, ...setup(state) };
}

describe('curve draft lifecycle', () => {
  it('keeps the first dragged segment pending so more anchors can be added before double-clicking', () => {
    const { state, tool, ctx, executor, click } = flatWorld();
    const baseline = cloneGridState(state);
    const from = { x: 3, y: 3 }, to = { x: 8, y: 10 };
    tool.onPointerDown(from, from, ctx);
    tool.onPointerMove(to, to, ctx);
    tool.onPointerUp(to, to, ctx);
    expect(tool.hasPending(ctx)).toBe(true);
    expect(getCurveSession()).toBeNull();
    expect(state.cells).toEqual(baseline.cells);
    expect(executor.getUndoStackSize()).toBe(0);
    click(15, 5); click(16, 12);
    expect(state.cells).toEqual(baseline.cells);
    click(16, 12);
    expect(getCurveSession()?.anchors).toEqual([from, to, { x: 15, y: 5 }, { x: 16, y: 12 }]);
    expect(executor.getUndoStackSize()).toBe(1);
    executor.undo(); expect(state.cells).toEqual(baseline.cells);
  });

  it('moves and removes draft anchors before erasing, then cancels without changing history', () => {
    const { state, tool, ctx, executor, click, drag } = flatWorld();
    const baseline = cloneGridState(state);
    click(3, 3); click(8, 10); click(15, 5);
    drag([8, 10], [9, 12], false);
    expect(tool.undoPendingStep(ctx)).toBe(true);
    click(16, 6); click(16, 6);
    expect(getCurveSession()?.anchors).toEqual([{ x: 3, y: 3 }, { x: 9, y: 12 }, { x: 16, y: 6 }]);
    expect(tool.cancelPending(ctx)).toBe(true);
    const completed = cloneGridState(state);
    click(4, 4); click(12, 12);
    tool.onPointerCancel(ctx);
    expect(state.cells).toEqual(completed.cells);
    expect(executor.getUndoStackSize()).toBe(1);
    executor.undo(); expect(state.cells).toEqual(baseline.cells);
  });

  it.each(['shape', 'surface', 'map'] as const)('abandons pending anchors on a %s change', change => {
    const { state, tool, ctx, click } = flatWorld();
    const baseline = cloneGridState(state);
    click(3, 3); click(8, 10);
    if (change === 'shape') ctx.eraserShape = 'line';
    else if (change === 'surface') ctx.contentType = 'water';
    else ctx.gridState = cloneGridState(state);
    expect(tool.hasPending(ctx)).toBe(false);
    expect(state.cells).toEqual(baseline.cells);
  });

  it('requires two clicks within the finishing interval', () => {
    const clock = vi.spyOn(performance, 'now');
    try {
      const { click, executor } = flatWorld();
      clock.mockReturnValue(0); click(3, 3);
      clock.mockReturnValue(500); click(12, 10);
      clock.mockReturnValue(1000); click(12, 10);
      expect(executor.getUndoStackSize()).toBe(0);
      clock.mockReturnValue(1250); click(12, 10);
      expect(getCurveSession()?.anchors).toHaveLength(2);
    } finally { clock.mockRestore(); }
  });
});

describe('curve adjustment transactions', () => {
  it('accepts an entirely empty adjusted path, restores the old erasure, and can return to it', () => {
    const state = makeState(20, 20);
    setTerrain(state, 8, 8, TerrainType.Mountain, 1);
    const { executor, drag } = setup(state);
    const baseline = cloneGridState(state);
    drag([4, 8], [16, 8]);
    expect(state.cells[8]![8]!.terrain).toBeNull();
    const erased = cloneGridState(state);
    moveCurveAnchor(1, 16, 16, true);
    expect(getCurveSession()?.anchors[1]).toMatchObject({ x: 16, y: 16 });
    expect(getCurveSession()?.footprint).toBe(true);
    expect(state.cells).toEqual(baseline.cells);
    expect(executor.getUndoStackSize()).toBe(2);
    moveCurveAnchor(1, 16, 17, true);
    expect(getCurveSession()?.anchors[1]).toMatchObject({ x: 16, y: 17 });
    expect(executor.getUndoStackSize()).toBe(2);
    moveCurveAnchor(1, 16, 8, true);
    expect(state.cells).toEqual(erased.cells);
    executor.undo(); expect(state.cells).toEqual(baseline.cells);
    executor.undo(); expect(state.cells).toEqual(erased.cells);
    executor.undo(); expect(state.cells).toEqual(baseline.cells);
  });

  it('keeps an initially empty curve editable without adding map history', () => {
    const state = makeState(20, 20);
    const { executor, drag } = setup(state);
    drag([3, 3], [12, 10]);
    expect(getCurveSession()?.anchors).toHaveLength(2);
    expect(getCurveSession()?.footprint).toBe(true);
    expect(executor.getUndoStackSize()).toBe(0);
  });

  it.each(['off', 'round', 'rect'] as const)('keeps the previous curve when a %s adjustment would remove high-tier support', mode => {
    const { state, ctx, executor, registry, drag } = flatWorld();
    for (const row of state.cells) for (const cell of row) cell.terrain!.elevation = 1;
    setTerrain(state, 10, 10, TerrainType.Mountain, 4);
    ctx.autoEdgeCut = mode;
    expect(registry.validatePostStroke(state)).toEqual([]);
    drag([3, 3], [3, 12]);
    const first = cloneGridState(state), anchors = structuredClone(getCurveSession()!.anchors);
    moveCurveAnchor(1, 9, 9, true);
    expect(state.cells).toEqual(first.cells);
    expect(getCurveSession()?.anchors).toEqual(anchors);
    expect(executor.getUndoStackSize()).toBe(1);
    expect(executor.canRedo()).toBe(false);
    expect(registry.validatePostStroke(state)).toEqual([]);
  });

  it('rolls back a partially refused baseline restoration and resets the handles', () => {
    const { state, ctx, executor, drag } = flatWorld();
    setTerrain(state, 3, 3, TerrainType.Mountain, 3);
    let refuse = false, calls = 0;
    ctx.executeCommand = (command: Command) => {
      if (refuse && ++calls === 2) return { success: false, errors: [] };
      return executor.execute(command);
    };
    drag([3, 3], [12, 10]);
    const held = cloneGridState(state), anchors = structuredClone(getCurveSession()!.anchors);
    refuse = true;
    moveCurveAnchor(1, 12, 6, true);
    expect(calls).toBe(2);
    expect(state.cells).toEqual(held.cells);
    expect(getCurveSession()?.anchors).toEqual(anchors);
    expect(executor.getUndoStackSize()).toBe(1);
    expect(executor.canRedo()).toBe(false);
  });

  it('keeps tangent edits legal and exactly undoable', () => {
    const { state, ctx, executor, registry, drag } = flatWorld();
    ctx.autoEdgeCut = 'round';
    drag([3, 3], [15, 10]);
    const first = cloneGridState(state);
    setCurveHandle(0, 'out', 2, 5, { commit: true, mirror: true });
    expect(registry.validatePostStroke(state)).toEqual([]);
    const adjusted = cloneGridState(state);
    expect(adjusted.cells).not.toEqual(first.cells);
    executor.undo(); expect(state.cells).toEqual(first.cells);
    executor.redo(); expect(state.cells).toEqual(adjusted.cells);
  });
});
