import { describe, expect, it } from 'vitest';
import { TerrainType, type MacroCoord } from '../../../../core/model/types';
import { type AutoEdgeCut } from '../../../../state/editing/vocabulary';
import { detectWaterfalls } from '../../../../core/domain/terrain/waterfall-geometry';
import { mapFingerprint } from '../../../../core/model/fingerprint';
import { applyMacro } from '../../../../tools/macros/run';
import { TerrainDraft } from '../../../../tools/macros/terrain/terrain-draft';
import { circleCells, rectCells } from '../../../../core/grid/shapes';
import { makeExecutor, makeState, setTerrain } from '../../../_support/map-state';

function kit() {
  const state = makeState(48, 48), executor = makeExecutor(state);
  return { state, executor, registry: executor.getRegistry() };
}
function pond(ctx: ReturnType<typeof kit>, at: MacroCoord, radius: { rx: number; ry: number }, elevation: number, trim: AutoEdgeCut = 'off'): void {
  const { rx, ry } = radius;
  const mark = ctx.executor.beginStroke(), draft = new TerrainDraft(ctx);
  for (const c of circleCells(at, rx - 1, ry - 1)) expect(draft.set(c, TerrainType.Water, elevation)).toBe(true);
  expect(draft.contain() && draft.commit(trim)).toBe(true);
  expect(mark.commit()).toEqual([]);
}
/** A flat-topped mountain of `elevation` over the disc, with the support it needs, as one stroke. */
function mound(ctx: ReturnType<typeof kit>, at: MacroCoord, r: number, elevation: number, trim: AutoEdgeCut = 'off'): void {
  const mark = ctx.executor.beginStroke(), draft = new TerrainDraft(ctx);
  for (const c of circleCells(at, r, r)) draft.set(c, TerrainType.Mountain, elevation);
  expect(draft.commit(trim)).toBe(true);
  expect(mark.commit()).toEqual([]);
}
const at = { x: 24, y: 24 };

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
    mound(ctx, from, 6, 8);
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
    pond(ctx, from, { rx: 7, ry: 7 }, 6);
    pond(ctx, to, { rx: 6, ry: 6 }, 2);
    const result = applyMacro(ctx, 'stream', { seed: 1, from: reverse ? to : from, at: reverse ? from : to, width: 2 });
    expect(result.changes, JSON.stringify(result)).toBeGreaterThan(0);
    expect(ctx.state.cells[24]![24]!.terrain).toMatchObject({ type: TerrainType.Water, elevation: 2 });
    expect(ctx.registry.validatePostStroke(ctx.state)).toEqual([]);
  });

  it.each([1, 2, 3, 4, 5])('carries a diagonal width-%i river over several terraces into a raised lake', width => {
    const ctx = kit(), from = { x: 13, y: 15 }, to = { x: 34, y: 32 };
    mound(ctx, from, 6, 8);
    pond(ctx, to, { rx: 8, ry: 7 }, 2);
    const result = applyMacro(ctx, 'stream', { seed: 1, from, at: to, width });
    expect(result.changes, JSON.stringify(result)).toBeGreaterThan(0);
    expect(ctx.registry.validatePostStroke(ctx.state)).toEqual([]);
  });

  it.each(['round', 'rect'] as const)('keeps a trimmed cascade legal and undoable with %s edges', trim => {
    const ctx = kit(), from = { x: 13, y: 15 }, to = { x: 34, y: 32 };
    mound(ctx, from, 6, 8, trim);
    pond(ctx, to, { rx: 8, ry: 7 }, 2, trim);
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
    mound(ctx, at, 5, 8);
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
    mound(ctx, from, 6, 3);
    const before = mapFingerprint(ctx.state);
    const result = applyMacro(ctx, 'stream', { seed: 1, from, at: to, width: 1, region: rectCells(from, to), trim: 'round' });
    expect(result.changes).toBe(0); expect(mapFingerprint(ctx.state)).toBe(before);
  });
});
