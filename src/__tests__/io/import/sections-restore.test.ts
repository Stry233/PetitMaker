import { describe, it, expect } from 'vitest';
import { applyOptionalSections } from '../../../io/import/sections-restore';
import { encodeHistory } from '../../../io/save/history-codec';
import { makeState, makeExecutor } from '../../_support/map-state';
import { CommandType, TerrainType } from '../../../core/model/types';
import { defaultConfig } from '../../../tools/generation/recipe';

function deps(state = makeState(8, 8)) {
  const locked: number[] = [];
  let camera: unknown = null;
  const executor = makeExecutor(state);
  return { state, executor, locked, cameraRef: () => camera, d: {
    executor, state,
    setLayerLocked: (l: number) => locked.push(l),
    setCamera: (c: unknown) => { camera = c; },
  } };
}

describe('applyOptionalSections', () => {
  it('restores generation, session (layers + camera), and history', () => {
    const src = makeState(8, 8);
    const srcExec = makeExecutor(src);
    const whole = srcExec.beginStroke();
    srcExec.execute({ type: CommandType.PaintTerrain, cells: [{ x: 1, y: 1 }], terrainType: TerrainType.Mountain, elevation: 1 });
    whole.commit();
    const raw = {
      generation: defaultConfig('designed', { seed: 42, maxElevation: 8 }),
      session: { v: 1, lockedLayers: [3, 5], camera: { x: 10, y: 20, zoom: 2 } },
      history: JSON.parse(JSON.stringify(encodeHistory(srcExec.getUndoEntries(), 'all'))),
    };
    const t = deps(src);
    const res = applyOptionalSections(raw, t.d);
    expect(res.restored.sort()).toEqual(['generation', 'history', 'session']);
    expect(t.state.generation?.seed).toBe(42);
    expect(t.locked).toEqual([3, 5]);
    expect(t.cameraRef()).toEqual({ view2d: { x: 10, y: 20, zoom: 2 } });
    expect(t.executor.canUndo()).toBe(true);
  });
  it('restores both views from the camera an export writes beside the session, ahead of an older 2D pose', () => {
    const t = deps();
    const camera = { view2d: { x: 4, y: 5, zoom: 1.25 }, view3d: { az: 30, el: 40, dist: 1.5, tx: 2 } };
    applyOptionalSections({ session: { v: 1, lockedLayers: [], camera: { x: 9, y: 9, zoom: 9 } }, camera }, t.d);
    expect(t.cameraRef()).toEqual(camera);
  });
  it('reads a malformed camera as none', () => {
    const t = deps();
    applyOptionalSections({ session: { v: 1, lockedLayers: [], camera: { x: 'far', y: 2, zoom: 1 } } }, t.d);
    expect(t.cameraRef()).toBeNull();
  });
  it('drops a future-version history but keeps the rest', () => {
    const t = deps();
    const res = applyOptionalSections({ history: { v: 99, totalSteps: 1, entries: [] }, session: { v: 1, lockedLayers: [] } }, t.d);
    expect(res.dropped).toEqual(['history']);
    expect(res.restored).toContain('session');
    expect(t.executor.canUndo()).toBe(false);
  });
  it('locks only whole layers and hands the view the saved zoom', () => {
    const t = deps();
    applyOptionalSections({ session: { v: 1, lockedLayers: [1.5, 2, 0, 99], camera: { x: 1, y: 2, zoom: 1e6 } } }, t.d);
    expect(t.locked).toEqual([2]);
    expect(t.cameraRef()).toEqual({ view2d: { x: 1, y: 2, zoom: 1e6 } });
  });
  it('no sections → nothing restored, nothing dropped', () => {
    const t = deps();
    const res = applyOptionalSections({ version: 1, cells: '', objects: [] }, t.d);
    expect(res.restored).toEqual([]);
    expect(res.dropped).toEqual([]);
  });
});

