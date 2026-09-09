import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerrainType } from '../../../core/model/types';
import { MacroTool } from '../../../tools/macros/macro-tool';
import { buildMacroRun, installMacroBuildRunner, type MacroBuild } from '../../../tools/macros/run';
import { mapFingerprint } from '../../../tools/macros/scratch';
import { endCurveSession, getCurveSession, moveCurveAnchor, setCurveHandle } from '../../../tools/paint/curve-session';
import { makeToolCtx } from '../_tool-ctx';
import { makeExecutor, makeState } from '../../rules/_helpers';

function setup(id = 'stream') {
  const state = makeState(48, 48), executor = makeExecutor(state);
  const ctx = makeToolCtx(state, executor, 2, 4, { armedMacro: id, armingEpoch: 1, layerPinned: true });
  const tool = new MacroTool();
  const down = (x: number, y: number) => tool.onPointerDown({ x, y }, { x: x * 2, y: y * 2 }, ctx);
  const move = (x: number, y: number) => tool.onPointerMove({ x, y }, { x: x * 2, y: y * 2 }, ctx);
  const up = (x: number, y: number) => tool.onPointerUp({ x, y }, { x: x * 2, y: y * 2 }, ctx);
  return { state, executor, ctx, tool, down, move, up };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
afterEach(() => { endCurveSession(); installMacroBuildRunner(null); });

describe('Smart Build drag lifecycle', () => {
  it.each(['stream', 'road-link'])('%s previews during dragging and builds only on release', async id => {
    const s = setup(id), before = mapFingerprint(s.state);
    const ghost = vi.spyOn(s.ctx.overlay, 'showGhost');
    s.down(16, 22); s.move(25, 29);
    expect(mapFingerprint(s.state)).toBe(before);
    await flush(); expect(ghost).toHaveBeenCalled();
    s.up(25, 29); expect(s.executor.getUndoStackSize()).toBe(1);
    const after = mapFingerprint(s.state);
    expect(after).not.toBe(before); s.executor.undo(); expect(mapFingerprint(s.state)).toBe(before);
    s.executor.redo(); expect(mapFingerprint(s.state)).toBe(after);
  });

  it.each(['stream', 'road-link'])('Escape cancels %s before release', id => {
    const s = setup(id), before = mapFingerprint(s.state);
    s.down(16, 22); s.move(25, 29); expect(s.tool.cancelPending(s.ctx)).toBe(true); s.up(25, 29);
    expect(mapFingerprint(s.state)).toBe(before); expect(s.executor.getUndoStackSize()).toBe(0);
  });

  it.each(['stream', 'road-link'])('%s adjustments are separate undo steps and remain available', id => {
    const s = setup(id), before = mapFingerprint(s.state);
    s.down(12, 24); s.up(35, 24);
    const initial = mapFingerprint(s.state);
    const last = getCurveSession()!.anchors.length - 1;
    moveCurveAnchor(last, 35, 34, true);
    expect(s.executor.getUndoStackSize()).toBe(2);
    const adjusted = mapFingerprint(s.state); expect(adjusted).not.toBe(initial);
    s.executor.undo(); expect(mapFingerprint(s.state)).toBe(initial);
    s.executor.undo(); expect(mapFingerprint(s.state)).toBe(before);
    s.executor.redo(); s.executor.redo(); expect(mapFingerprint(s.state)).toBe(adjusted);
    expect(getCurveSession()).not.toBeNull();
  });

  it('moves a river bend and preserves the existing river on invalid adjustment', () => {
    const s = setup(); s.down(12, 24); s.up(35, 24);
    const original = mapFingerprint(s.state);
    moveCurveAnchor(1, 24, 32, true);
    expect(mapFingerprint(s.state)).not.toBe(original);
    expect(s.state.cells[32]![24]!.terrain?.type).toBe(TerrainType.Water);
    const bent = mapFingerprint(s.state), anchors = getCurveSession()!.anchors.map(a => ({ ...a }));
    moveCurveAnchor(2, -20, -20, true);
    expect(mapFingerprint(s.state)).toBe(bent); expect(getCurveSession()!.anchors).toEqual(anchors);
  });

  it('lets a river direction handle steer the channel', () => {
    const s = setup(); s.down(12, 24); s.up(35, 24);
    const original = mapFingerprint(s.state);
    setCurveHandle(1, 'out', 0, 8, { commit: true, mirror: true });
    expect(mapFingerprint(s.state)).not.toBe(original);
    expect(s.executor.getUndoStackSize()).toBe(2);
  });

  it('a map click dismisses adjustment without drawing another feature', () => {
    const s = setup(); s.down(12, 24); s.up(35, 24);
    const initial = mapFingerprint(s.state);
    s.down(18, 15); s.move(30, 15); s.up(30, 15);
    expect(getCurveSession()).toBeNull(); expect(mapFingerprint(s.state)).toBe(initial);
  });

  it('switching macro cards abandons an unfinished gesture', () => {
    const s = setup(), before = mapFingerprint(s.state);
    s.down(12, 24); s.ctx.armingEpoch += 2; s.move(35, 24); s.up(35, 24);
    expect(mapFingerprint(s.state)).toBe(before);
  });
});

describe('worker-backed Smart Build', () => {
  it.each(['stream', 'road-link'])('keeps %s visible until a worker adjustment lands', async id => {
    const s = setup(id); s.down(12, 24); s.up(35, 24);
    const before = mapFingerprint(s.state);
    let answer: (built: MacroBuild | null) => void = () => {};
    let built: MacroBuild | null = null;
    installMacroBuildRunner((state, macro, opts) => {
      built = buildMacroRun({ ...s.ctx.macroContext, state }, macro, opts);
      return new Promise(resolve => { answer = resolve; });
    });
    moveCurveAnchor(getCurveSession()!.anchors.length - 1, 35, 34, true);
    expect(mapFingerprint(s.state)).toBe(before); expect(s.executor.getUndoStackSize()).toBe(1);
    answer(built); await flush();
    expect(mapFingerprint(s.state)).not.toBe(before); expect(s.executor.getUndoStackSize()).toBe(2);
    s.executor.undo(); expect(mapFingerprint(s.state)).toBe(before);
  });

  it.each(['cancel', 'deactivate', 'rearm', 'map edit', 'map replacement'])('discards an outstanding creation after %s', async action => {
    const s = setup();
    let answer: (built: MacroBuild | null) => void = () => {};
    let built: MacroBuild | null = null;
    installMacroBuildRunner((state, macro, opts) => {
      built = buildMacroRun({ ...s.ctx.macroContext, state }, macro, opts);
      return new Promise(resolve => { answer = resolve; });
    });
    s.down(12, 24); s.up(35, 24);
    if (action === 'cancel') s.tool.cancelPending(s.ctx);
    if (action === 'deactivate') s.tool.onDeactivate(s.ctx);
    if (action === 'rearm') s.ctx.armingEpoch++;
    if (action === 'map edit') s.state.lockedLayers.add(0);
    if (action === 'map replacement') s.ctx.gridState = makeState(48, 48);
    const before = mapFingerprint(s.state);
    answer(built); await flush();
    expect(mapFingerprint(s.state)).toBe(before); expect(s.executor.getUndoStackSize()).toBe(0);
    expect(getCurveSession()).toBeNull();
  });
});
