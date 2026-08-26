import { describe, it, expect } from 'vitest';
import { applyOptionalSections } from '../../io/import-sections';
import { encodeHistory } from '../../io/history-codec';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { makeState } from '../rules/_helpers';
import { CommandType, TerrainType } from '../../core/model/types';
import { roadLookup } from '../../state/object-index';

function deps(state = makeState(8, 8)) {
  const locked: number[] = [];
  let camera: unknown = null;
  const executor = new CommandExecutor(state, new EventBus(), createDefaultRegistry(), roadLookup(state));
  return { state, executor, locked, cameraRef: () => camera, d: {
    executor, state,
    setLayerLocked: (l: number) => locked.push(l),
    setCamera: (c: unknown) => { camera = c; },
  } };
}

describe('applyOptionalSections', () => {
  it('restores generation, session (layers + camera), and history', () => {
    const src = makeState(8, 8);
    const srcExec = new CommandExecutor(src, new EventBus(), createDefaultRegistry(), roadLookup(src));
    srcExec.execute({ type: CommandType.PaintTerrain, timestamp: 0, cells: [{ x: 1, y: 1 }], terrainType: TerrainType.Mountain, elevation: 1 });
    srcExec.commitStroke(0);
    const raw = {
      generation: { algorithm: 'designed', seed: 42, mode: 'mixed', corridorWidth: 1, maxElevation: 8, region: null },
      session: { v: 1, lockedLayers: [3, 5], camera: { x: 10, y: 20, zoom: 2 } },
      history: JSON.parse(JSON.stringify(encodeHistory(srcExec.getUndoEntries(), 'all'))),
    };
    const t = deps(src);
    const res = applyOptionalSections(raw, t.d);
    expect(res.restored.sort()).toEqual(['generation', 'history', 'session']);
    expect(t.state.generation?.seed).toBe(42);
    expect(t.locked).toEqual([3, 5]);
    expect(t.cameraRef()).toEqual({ x: 10, y: 20, zoom: 2 });
    expect(t.executor.canUndo()).toBe(true);
  });
  it('drops a future-version history but keeps the rest', () => {
    const t = deps();
    const res = applyOptionalSections({ history: { v: 99, totalSteps: 1, entries: [] }, session: { v: 1, lockedLayers: [] } }, t.d);
    expect(res.dropped).toEqual(['history']);
    expect(res.restored).toContain('session');
    expect(t.executor.canUndo()).toBe(false);
  });
  it('no sections → nothing restored, nothing dropped', () => {
    const t = deps();
    const res = applyOptionalSections({ version: 1, cells: '', objects: [] }, t.d);
    expect(res.restored).toEqual([]);
    expect(res.dropped).toEqual([]);
  });
});
