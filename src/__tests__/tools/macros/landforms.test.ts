import { describe, expect, it } from 'vitest';
import { TerrainType, type MacroCoord, type AutoEdgeCut } from '../../../core/model/types';
import { detectWaterfalls } from '../../../core/model/waterfall-geometry';
import { mapFingerprint } from '../../../tools/macros/scratch';
import { applyMacro } from '../../../tools/macros/run';
import { TerrainDraft } from '../../../tools/macros/terrain-draft';
import { circleCells, rectCells } from '../../../tools/paint/shapes';
import { makeExecutor, makeState, setTerrain } from '../../rules/_helpers';

function kit() {
  const state = makeState(48, 48), executor = makeExecutor(state);
  return { state, executor, registry: executor.getRegistry() };
}
function pond(ctx: ReturnType<typeof kit>, at: MacroCoord, rx: number, ry: number, elevation: number, trim: AutoEdgeCut = 'off'): void {
  const mark = ctx.executor.getUndoStackSize(), draft = new TerrainDraft(ctx);
  for (const c of circleCells(at, rx - 1, ry - 1)) expect(draft.set(c, TerrainType.Water, elevation)).toBe(true);
  expect(draft.contain() && draft.commit(trim)).toBe(true);
  expect(ctx.executor.commitStrokeGroup(mark)).toEqual([]);
}
const at = { x: 24, y: 24 };
const top = circleCells(at, 4, 4);

describe('complete mountain fill areas', () => {
  it.each([1, 3, 4, 6, 8])('keeps the complete requested fill area at layer %i with legal support', elevation => {
    const ctx = kit(), before = mapFingerprint(ctx.state);
    const result = applyMacro(ctx, 'raise', { seed: 1, at, area: top, elevation });
    expect(result.changes, JSON.stringify(result)).toBeGreaterThanOrEqual(top.length);
    for (const c of top) expect(ctx.state.cells[c.y]![c.x]!.terrain?.elevation).toBe(elevation);
    expect(ctx.registry.validatePostStroke(ctx.state)).toEqual([]);
    expect(ctx.executor.getUndoStackSize()).toBe(1);
    const after = mapFingerprint(ctx.state);
    ctx.executor.undo(); expect(mapFingerprint(ctx.state)).toBe(before);
    ctx.executor.redo(); expect(mapFingerprint(ctx.state)).toBe(after);
  });

  it('refuses a blocked mountain fill without reducing its top or leaving support behind', () => {
    const ctx = kit();
    ctx.state.objects.set('home', { id: 'home', catalogId: 'building-myhouse', position: at, rotation: 0, elevation: 0 });
    const before = mapFingerprint(ctx.state);
    const result = applyMacro(ctx, 'raise', { seed: 1, at, area: top, elevation: 8 });
    expect(result.changes).toBe(0); expect(result.code).toBe('terrain-blocked');
    expect(mapFingerprint(ctx.state)).toBe(before); expect(ctx.executor.getUndoStackSize()).toBe(0);
  });

  it('fills existing corner cuts in the requested fill area', () => {
    const ctx = kit();
    setTerrain(ctx.state, at.x, at.y, TerrainType.Mountain, 2);
    ctx.state.cells[at.y]![at.x]!.terrain!.corners = ['fan', 'square', 'square', 'square'];
    const before = mapFingerprint(ctx.state);
    expect(applyMacro(ctx, 'raise', { seed: 1, at, area: [at], elevation: 2 }).changes).toBeGreaterThan(0);
    expect(ctx.state.cells[at.y]![at.x]!.terrain?.corners).toBeUndefined();
    ctx.executor.undo(); expect(mapFingerprint(ctx.state)).toBe(before);
  });

  it('does not put support outside a painted region', () => {
    const ctx = kit(), before = mapFingerprint(ctx.state);
    const result = applyMacro(ctx, 'raise', { seed: 1, at, area: top, region: top, elevation: 8 });
    expect(result.changes).toBe(0); expect(mapFingerprint(ctx.state)).toBe(before);
  });

});

describe('Smart Build rivers', () => {
  const from = { x: 12, y: 24 }, to = { x: 35, y: 24 };
  it.each([1, 2, 3, 4, 5])('builds a width-%i channel with pools at the selected dry endpoints', width => {
    const ctx = kit(), before = mapFingerprint(ctx.state);
    const result = applyMacro(ctx, 'stream', { seed: 1, from, at: to, width });
    expect(result.changes, JSON.stringify(result)).toBeGreaterThan(0);
    const crossSection = ctx.state.cells.filter(row => row[24]!.terrain?.type === TerrainType.Water);
    expect(crossSection).toHaveLength(width);
    for (const c of [from, to]) expect(ctx.state.cells[c.y]![c.x]!.terrain?.type).toBe(TerrainType.Water);
    expect(ctx.state.cells[24]![40]!.terrain).toBeNull();
    expect(ctx.registry.validatePostStroke(ctx.state)).toEqual([]);
    ctx.executor.undo(); expect(mapFingerprint(ctx.state)).toBe(before);
  });

  it('joins two existing ponds and allows a branch without draining the original', () => {
    const ctx = kit(), ponds = [...circleCells(from, 3, 3), ...circleCells(to, 3, 3)];
    for (const c of ponds) setTerrain(ctx.state, c.x, c.y, TerrainType.Water, 0);
    expect(applyMacro(ctx, 'stream', { seed: 1, from, at: to, width: 2 }).changes).toBeGreaterThan(0);
    expect(applyMacro(ctx, 'stream', { seed: 1, from: at, at: { x: 24, y: 36 }, width: 1 }).changes).toBeGreaterThan(0);
    for (const c of ponds) expect(ctx.state.cells[c.y]![c.x]!.terrain?.type).toBe(TerrainType.Water);
    expect(ctx.registry.validatePostStroke(ctx.state)).toEqual([]);
  });

  it.each([1, 3, 5])('builds a width-%i waterfall with a uniform receiving row', width => {
    const ctx = kit();
    for (const c of rectCells({ x: 4, y: 4 }, { x: 23, y: 43 })) setTerrain(ctx.state, c.x, c.y, TerrainType.Mountain, 3);
    const result = applyMacro(ctx, 'stream', { seed: 1, from, at: to, width });
    expect(result.changes, JSON.stringify(result)).toBeGreaterThan(0);
    expect(detectWaterfalls(ctx.state).length).toBeGreaterThan(0);
    expect(ctx.registry.validatePostStroke(ctx.state)).toEqual([]);
  });

  it('builds intermediate drops from layer eight to ground', () => {
    const ctx = kit();
    expect(applyMacro(ctx, 'raise', { seed: 1, at: from, area: circleCells(from, 6, 6), elevation: 8 }).changes).toBeGreaterThan(0);
    const result = applyMacro(ctx, 'stream', { seed: 1, from, at: to, width: 2 });
    expect(result.changes, JSON.stringify(result)).toBeGreaterThan(0);
    const elevations = new Set(detectWaterfalls(ctx.state).map(f => ctx.state.cells[f.cells[0]!.y]![f.cells[0]!.x]!.terrain!.elevation));
    expect(elevations.size).toBeGreaterThan(1);
    expect(ctx.registry.validatePostStroke(ctx.state)).toEqual([]);
  });

  it('refuses locked water without leaving any part of the river', () => {
    const ctx = kit(); ctx.state.lockedLayers.add(0);
    const before = mapFingerprint(ctx.state);
    expect(applyMacro(ctx, 'stream', { seed: 1, from, at: to }).changes).toBe(0);
    expect(mapFingerprint(ctx.state)).toBe(before);
  });

  it.each([false, true])('joins an upper pond to a lower elevated lake across low ground (reverse drag: %s)', reverse => {
    const ctx = kit();
    pond(ctx, from, 7, 7, 6);
    pond(ctx, to, 6, 6, 2);
    const result = applyMacro(ctx, 'stream', { seed: 1, from: reverse ? to : from, at: reverse ? from : to, width: 2 });
    expect(result.changes, JSON.stringify(result)).toBeGreaterThan(0);
    expect(ctx.state.cells[24]![24]!.terrain).toMatchObject({ type: TerrainType.Water, elevation: 2 });
    expect(ctx.registry.validatePostStroke(ctx.state)).toEqual([]);
  });

  it.each([1, 2, 3, 4, 5])('carries a diagonal width-%i river over several terraces into a raised lake', width => {
    const ctx = kit(), from = { x: 13, y: 15 }, to = { x: 34, y: 32 };
    expect(applyMacro(ctx, 'raise', { seed: 1, at: from, area: circleCells(from, 6, 6), elevation: 8 }).changes).toBeGreaterThan(0);
    pond(ctx, to, 8, 7, 2);
    const result = applyMacro(ctx, 'stream', { seed: 1, from, at: to, width });
    expect(result.changes, JSON.stringify(result)).toBeGreaterThan(0);
    expect(ctx.registry.validatePostStroke(ctx.state)).toEqual([]);
  });

  it.each(['round', 'rect'] as const)('keeps a trimmed cascade legal and undoable with %s edges', trim => {
    const ctx = kit(), from = { x: 13, y: 15 }, to = { x: 34, y: 32 };
    expect(applyMacro(ctx, 'raise', { seed: 1, at: from, area: circleCells(from, 6, 6), elevation: 8, trim }).changes).toBeGreaterThan(0);
    pond(ctx, to, 8, 7, 2, trim);
    const before = mapFingerprint(ctx.state);
    const result = applyMacro(ctx, 'stream', { seed: 1, from, at: to, width: 3, trim });
    expect(result.changes, JSON.stringify(result)).toBeGreaterThan(0);
    expect(ctx.registry.validatePostStroke(ctx.state)).toEqual([]);
    expect(detectWaterfalls(ctx.state).length).toBeGreaterThan(0);
    const after = mapFingerprint(ctx.state);
    ctx.executor.undo(); expect(mapFingerprint(ctx.state)).toBe(before);
    ctx.executor.redo(); expect(mapFingerprint(ctx.state)).toBe(after);
  });

  it.each([[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]])('builds cascades in direction (%i, %i)', (dx, dy) => {
    const ctx = kit(), to = { x: at.x + dx * 14, y: at.y + dy * 14 };
    expect(applyMacro(ctx, 'raise', { seed: 1, at, area: circleCells(at, 5, 5), elevation: 8 }).changes).toBeGreaterThan(0);
    const result = applyMacro(ctx, 'stream', { seed: 1, from: at, at: to, width: 2 });
    expect(result.changes, JSON.stringify(result)).toBeGreaterThan(0);
    expect(ctx.state.cells[to.y]![to.x]!.terrain?.type).toBe(TerrainType.Water);
    expect(detectWaterfalls(ctx.state).length).toBeGreaterThan(0);
    expect(ctx.registry.validatePostStroke(ctx.state)).toEqual([]);
  });

  it('routes around a building while preserving its footprint', () => {
    const ctx = kit();
    const object = { id: 'home', catalogId: 'building-myhouse', position: { x: 23, y: 22 }, rotation: 0 as const, elevation: 0 };
    ctx.state.objects.set(object.id, object);
    const result = applyMacro(ctx, 'stream', { seed: 1, from, at: to, width: 2 });
    expect(result.changes, JSON.stringify(result)).toBeGreaterThan(0);
    expect(ctx.state.objects.get(object.id)).toEqual(object);
    expect(ctx.registry.validatePostStroke(ctx.state)).toEqual([]);
  });

  it('refuses missing bank space without painting outside the region', () => {
    const ctx = kit();
    expect(applyMacro(ctx, 'raise', { seed: 1, at: from, area: circleCells(from, 6, 6), elevation: 3 }).changes).toBeGreaterThan(0);
    const before = mapFingerprint(ctx.state);
    const result = applyMacro(ctx, 'stream', { seed: 1, from, at: to, width: 1, region: rectCells(from, to), trim: 'round' });
    expect(result.changes).toBe(0); expect(mapFingerprint(ctx.state)).toBe(before);
  });
});
